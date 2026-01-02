/**
 * Coordinator Agent
 * Orchestrates the team and makes final decisions
 */

import OpenAI from 'openai';
import { WeexClient } from '../sdk/client.js';
import { BaseAgent, AgentDecision, Signal, Action, AgentMessage } from './base.js';
import { MarketAnalystAgent } from './market-analyst.js';
import { SentimentAgent } from './sentiment.js';
import { RiskManagerAgent } from './risk-manager.js';
import { ExecutorAgent } from './executor.js';
import chalk from 'chalk';

export interface TeamDecision {
    action: Action;
    tradeDirection: string;
    size: string;
    confidence: number;
    reasoning: string;
    agentDecisions: AgentDecision[];
    aiLogsUploaded: number;
}

export class CoordinatorAgent extends BaseAgent {
    private marketAnalyst: MarketAnalystAgent;
    private sentimentAgent: SentimentAgent;
    private riskManager: RiskManagerAgent;
    private executor: ExecutorAgent;
    private maxPositionSize: number;

    constructor(
        openai: OpenAI,
        weex: WeexClient,
        model: string = 'gpt-5.2',
        maxPositionSize: number = 0.0002
    ) {
        super('Coordinator', 'Decision Making', openai, weex, model);
        this.maxPositionSize = maxPositionSize;

        // Initialize team
        this.marketAnalyst = new MarketAnalystAgent(openai, weex, model);
        this.sentimentAgent = new SentimentAgent(openai, weex, model);
        this.riskManager = new RiskManagerAgent(openai, weex, model, maxPositionSize);
        this.executor = new ExecutorAgent(openai, weex, model);
    }

    getSystemPrompt(): string {
        return `You are the Coordinator Agent, the leader of the trading team.

Your role:
- Collect analysis from all team members
- Run consensus voting algorithm
- Make final EXECUTE, HOLD, or ALERT decision

Voting weights:
- Market Analyst: 35%
- Sentiment Agent: 25%
- Risk Manager: 40% (has veto power)

Thresholds:
- EXECUTE: weighted confidence >= 0.65
- ALERT: weighted confidence 0.45-0.65
- HOLD: weighted confidence < 0.45

If Risk Manager says REJECT, always HOLD.`;
    }

    private calculateConsensus(decisions: Record<string, AgentDecision>): {
        action: Action;
        confidence: number;
        direction: string;
        votes: Record<string, number>;
    } {
        const weights: Record<string, number> = {
            MarketAnalyst: 0.35,
            SentimentAgent: 0.25,
            RiskManager: 0.4,
        };

        // Check for risk veto
        const riskDecision = decisions.RiskManager;
        if (riskDecision && riskDecision.signal === 'reject') {
            return {
                action: 'hold',
                confidence: 0,
                direction: 'none',
                votes: { buy: 0, sell: 0, hold: 1 },
            };
        }

        // Calculate weighted score
        let totalScore = 0;
        const directionVotes = { buy: 0, sell: 0, hold: 0 };

        for (const [agentName, decision] of Object.entries(decisions)) {
            const weight = weights[agentName] || 0;
            const score = decision.confidence * weight;

            if (['buy', 'bullish', 'approve'].includes(decision.signal)) {
                totalScore += score;
                directionVotes.buy += weight;
            } else if (['sell', 'bearish'].includes(decision.signal)) {
                totalScore += score;
                directionVotes.sell += weight;
            } else {
                directionVotes.hold += weight;
            }
        }

        // Determine action
        let action: Action;
        if (totalScore >= 0.65) {
            action = 'execute';
        } else if (totalScore >= 0.45) {
            action = 'alert';
        } else {
            action = 'hold';
        }

        // Determine direction
        let direction: string;
        if (directionVotes.buy > directionVotes.sell) {
            direction = 'buy';
        } else if (directionVotes.sell > directionVotes.buy) {
            direction = 'sell';
        } else {
            direction = 'none';
        }

        return { action, confidence: totalScore, direction, votes: directionVotes };
    }

    async runTeamAnalysis(symbol: string): Promise<TeamDecision> {
        console.log(`\n${chalk.cyan('═'.repeat(60))}`);
        console.log(chalk.cyan.bold(`🤖 MULTI-AGENT TEAM ANALYSIS: ${symbol}`));
        console.log(`${chalk.cyan('═'.repeat(60))}\n`);

        const decisions: Record<string, AgentDecision> = {};
        let aiLogsUploaded = 0;

        // 1. Market Analyst
        console.log(chalk.yellow('📊 [1/4] Market Analyst analyzing...'));
        const maDecision = await this.marketAnalyst.analyze({ symbol });
        decisions.MarketAnalyst = maDecision;
        aiLogsUploaded++;
        console.log(`   Signal: ${maDecision.signal} | Confidence: ${maDecision.confidence}`);
        console.log(`   AI Log: ${chalk.green('✅')}`);

        // 2. Sentiment Agent
        console.log(chalk.yellow('\n💭 [2/4] Sentiment Agent analyzing...'));
        const saDecision = await this.sentimentAgent.analyze({ symbol });
        decisions.SentimentAgent = saDecision;
        aiLogsUploaded++;
        console.log(`   Signal: ${saDecision.signal} | Confidence: ${saDecision.confidence}`);
        console.log(`   AI Log: ${chalk.green('✅')}`);

        // 3. Risk Manager
        console.log(chalk.yellow('\n🛡️ [3/4] Risk Manager assessing...'));
        const rmContext = {
            symbol,
            proposedSignal: maDecision.signal,
            proposedConfidence: maDecision.confidence,
        };
        const rmDecision = await this.riskManager.analyze(rmContext);
        decisions.RiskManager = rmDecision;
        aiLogsUploaded++;
        console.log(`   Signal: ${rmDecision.signal} | Confidence: ${rmDecision.confidence}`);
        console.log(`   AI Log: ${chalk.green('✅')}`);

        // 4. Coordinator consensus
        console.log(chalk.yellow('\n🎯 [4/4] Coordinator calculating consensus...'));
        const consensus = this.calculateConsensus(decisions);

        // Get recommended size
        const recommendedSize = String(
            (rmDecision.data.output as any)?.recommendedSize || this.maxPositionSize
        );

        // Build coordinator reasoning
        const coordReasoning = `Consensus: ${consensus.action}. Weighted confidence: ${consensus.confidence.toFixed(2)}. Direction: ${consensus.direction}. Votes: ${JSON.stringify(consensus.votes)}`;

        const coordDecision: AgentDecision = {
            agentName: this.name,
            stage: this.stage,
            signal: consensus.direction === 'buy' ? 'buy' : consensus.direction === 'sell' ? 'sell' : 'hold',
            confidence: consensus.confidence,
            reasoning: coordReasoning,
            data: {
                input: { agentDecisions: Object.values(decisions).map((d) => d.signal) },
                output: {
                    action: consensus.action,
                    confidence: consensus.confidence,
                    direction: consensus.direction,
                    votes: consensus.votes,
                },
            },
            timestamp: new Date().toISOString(),
        };

        // Upload Coordinator AI Log
        await this.uploadAILog(coordDecision);
        aiLogsUploaded++;
        console.log(`   Decision: ${consensus.action} | Confidence: ${consensus.confidence.toFixed(2)}`);
        console.log(`   AI Log: ${chalk.green('✅')}`);

        // 5. Execute if needed
        let executionDecision: AgentDecision | null = null;
        if (consensus.action === 'execute' && ['buy', 'sell'].includes(consensus.direction)) {
            console.log(chalk.green('\n⚡ [5/5] Executor placing order...'));

            const execContext = {
                action: 'execute',
                symbol,
                size: recommendedSize,
                tradeDirection: consensus.direction,
                reasoning: coordReasoning,
                confidence: consensus.confidence,
            };

            executionDecision = await this.executor.analyze(execContext);
            aiLogsUploaded++;
            console.log(`   Order ID: ${(executionDecision.data.output as any)?.orderId || 'N/A'}`);
            console.log(`   AI Log: ${chalk.green('✅')}`);
        } else {
            console.log(chalk.gray(`\n⏸️ [5/5] No execution - ${consensus.action}`));
        }

        console.log(`\n${chalk.green('═'.repeat(60))}`);
        console.log(chalk.green.bold('✅ TEAM ANALYSIS COMPLETE'));
        console.log(`${chalk.green('═'.repeat(60))}\n`);

        return {
            action: consensus.action,
            tradeDirection: consensus.direction,
            size: recommendedSize,
            confidence: consensus.confidence,
            reasoning: coordReasoning,
            agentDecisions: [
                ...Object.values(decisions),
                ...(executionDecision ? [executionDecision] : []),
            ],
            aiLogsUploaded,
        };
    }

    async analyze(context: Record<string, unknown>): Promise<AgentDecision> {
        const symbol = (context.symbol as string) || 'cmt_btcusdt';
        const teamDecision = await this.runTeamAnalysis(symbol);

        return {
            agentName: this.name,
            stage: this.stage,
            signal:
                teamDecision.tradeDirection === 'buy'
                    ? 'buy'
                    : teamDecision.tradeDirection === 'sell'
                        ? 'sell'
                        : 'hold',
            confidence: teamDecision.confidence,
            reasoning: teamDecision.reasoning,
            data: {
                input: context,
                output: {
                    action: teamDecision.action,
                    direction: teamDecision.tradeDirection,
                    size: teamDecision.size,
                },
            },
            timestamp: new Date().toISOString(),
        };
    }
}
