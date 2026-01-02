/**
 * Fenyr v2.0 - Enhanced Coordinator
 * Full multi-agent system with Bull/Bear debate
 * Multi-pair support for all 8 WEEX assets
 */

import OpenAI from 'openai';
import chalk from 'chalk';
import { RustSDKBridge } from '../sdk/rust-bridge.js';
import { BaseAgent, AgentDecision, Signal, Action } from './base.js';
import { MarketAnalystAgent } from './market-analyst.js';
import { SentimentAgent } from './sentiment.js';
import { RiskManagerAgent } from './risk-manager.js';
import { ExecutorAgent } from './executor.js';
import { BullResearcherAgent } from './bull-researcher.js';
import { BearResearcherAgent } from './bear-researcher.js';
import { FundamentalsAnalystAgent } from './fundamentals-analyst.js';
import { calculateKellyFraction, calculatePositionSize, calculateOBI, getOBISignal } from '../quant/indicators.js';
import { executeTWAP, executeMarket, type ExecutionResult } from '../execution/engine.js';

// All 8 WEEX pairs
export const TRADING_PAIRS = [
    'cmt_btcusdt',
    'cmt_ethusdt',
    'cmt_solusdt',
    'cmt_dogeusdt',
    'cmt_xrpusdt',
    'cmt_adausdt',
    'cmt_bnbusdt',
    'cmt_ltcusdt',
] as const;

export type TradingPair = typeof TRADING_PAIRS[number];

export interface TeamDecision {
    symbol: string;
    action: Action;
    confidence: number;
    direction: 'long' | 'short' | 'none';
    positionSize: number;
    agentVotes: Record<string, AgentDecision>;
    bullBearDebate?: {
        bullThesis: string;
        bearThesis: string;
        winner: 'bull' | 'bear' | 'tie';
    };
    execution?: ExecutionResult;
    timestamp: number;
}

interface TradeRecord {
    pnl: number;
    isWin: boolean;
}

export class EnhancedCoordinatorAgent extends BaseAgent {
    // Agent team
    private marketAnalyst: MarketAnalystAgent;
    private sentimentAgent: SentimentAgent;
    private riskManager: RiskManagerAgent;
    private executor: ExecutorAgent;
    private bullResearcher: BullResearcherAgent;
    private bearResearcher: BearResearcherAgent;
    private fundamentalsAnalyst: FundamentalsAnalystAgent;

    // Configuration
    private maxPositionSize: number;
    private tradeHistory: TradeRecord[] = [];
    private accountEquity: number = 1000; // Will be updated

    constructor(
        openai: OpenAI,
        weex: RustSDKBridge,
        model: string = 'gpt-5.2',
        maxPositionSize: number = 0.001
    ) {
        super('EnhancedCoordinator', 'Decision Making', openai, weex, model);
        this.maxPositionSize = maxPositionSize;

        // Initialize all agents
        this.marketAnalyst = new MarketAnalystAgent(openai, weex, model);
        this.sentimentAgent = new SentimentAgent(openai, weex, model);
        this.riskManager = new RiskManagerAgent(openai, weex, model, maxPositionSize, 0.02);
        this.executor = new ExecutorAgent(openai, weex, model);
        this.bullResearcher = new BullResearcherAgent(openai, weex, model);
        this.bearResearcher = new BearResearcherAgent(openai, weex, model);
        this.fundamentalsAnalyst = new FundamentalsAnalystAgent(openai, weex, model);
    }

    getSystemPrompt(): string {
        return `You are the ENHANCED COORDINATOR for Fenyr v2.0 trading system.

You orchestrate a team of 7 AI agents:
1. Market Analyst - Technical indicators (RSI, MACD, EMA)
2. Sentiment Agent - Funding rates, market positioning
3. Fundamentals Analyst - On-chain metrics, funding arbitrage
4. Bull Researcher - Argues bullish case in debate
5. Bear Researcher - Argues bearish case in debate
6. Risk Manager - Position sizing, veto power
7. Executor - Order placement

Decision Process:
1. Gather analyst signals (Market, Sentiment, Fundamentals)
2. Run Bull/Bear dialectical debate
3. Calculate weighted consensus
4. Get Risk Manager approval (has VETO power)
5. Execute via TWAP/VWAP if approved

Weighting:
- Technical (Market): 25%
- Sentiment: 15%
- Fundamentals: 20%
- Bull/Bear Debate: 25%
- Risk Manager: 15% + VETO

Thresholds:
- EXECUTE: confidence >= 0.55 and Risk Manager approves
- ALERT: confidence 0.40-0.55
- HOLD: confidence < 0.40 or Risk Manager VETO`;
    }

    async analyze(context: Record<string, unknown>): Promise<AgentDecision> {
        const symbol = context.symbol as string;
        const teamDecision = await this.runFullAnalysis(symbol);

        return {
            agentName: this.name,
            signal: teamDecision.direction === 'long' ? 'bullish' :
                teamDecision.direction === 'short' ? 'bearish' : 'neutral',
            confidence: teamDecision.confidence,
            stage: this.stage,
            reasoning: `Team decision: ${teamDecision.action} with ${(teamDecision.confidence * 100).toFixed(0)}% confidence`,
            data: { teamDecision },
            timestamp: new Date().toISOString(),
        };
    }

    async runFullAnalysis(symbol: string): Promise<TeamDecision> {
        console.log(chalk.cyan('\n' + '═'.repeat(60)));
        console.log(chalk.cyan(`🤖 ENHANCED MULTI-AGENT ANALYSIS: ${symbol}`));
        console.log(chalk.cyan('═'.repeat(60)));

        const context = { symbol };
        const agentVotes: Record<string, AgentDecision> = {};

        // Update account equity
        try {
            const assets = await this.weex.getAssets();
            const usdt = assets.find((a: any) => a.coinName === 'USDT');
            if (usdt) {
                this.accountEquity = parseFloat(usdt.equity || usdt.available);
            }
        } catch (e) {
            console.log('   Using default equity');
        }

        // Phase 1: Analyst Team (parallel)
        console.log(chalk.yellow('\n📊 PHASE 1: Analyst Team'));

        console.log('   [1/3] Market Analyst...');
        agentVotes.market = await this.marketAnalyst.analyze(context);
        console.log(`   ${this.formatSignal(agentVotes.market)}`);

        console.log('   [2/3] Sentiment Agent...');
        agentVotes.sentiment = await this.sentimentAgent.analyze(context);
        console.log(`   ${this.formatSignal(agentVotes.sentiment)}`);

        console.log('   [3/3] Fundamentals Analyst...');
        agentVotes.fundamentals = await this.fundamentalsAnalyst.analyze(context);
        console.log(`   ${this.formatSignal(agentVotes.fundamentals)}`);

        // Phase 2: Bull/Bear Debate
        console.log(chalk.yellow('\n🗣️ PHASE 2: Bull/Bear Debate'));

        console.log('   [1/2] Bull Researcher presenting case...');
        agentVotes.bull = await this.bullResearcher.analyze(context);
        console.log(`   ${this.formatSignal(agentVotes.bull)}`);

        console.log('   [2/2] Bear Researcher rebutting...');
        const bearContext = {
            ...context,
            bullishArguments: agentVotes.bull.reasoning
        };
        agentVotes.bear = await this.bearResearcher.analyze(bearContext);
        console.log(`   ${this.formatSignal(agentVotes.bear)}`);

        // Determine debate winner
        const bullConf = agentVotes.bull.confidence;
        const bearConf = agentVotes.bear.confidence;
        const debateWinner = bullConf > bearConf + 0.1 ? 'bull' :
            bearConf > bullConf + 0.1 ? 'bear' : 'tie';

        console.log(chalk.magenta(`   📢 Debate winner: ${debateWinner.toUpperCase()}`));

        // Phase 3: Calculate Weighted Consensus
        console.log(chalk.yellow('\n📐 PHASE 3: Weighted Consensus'));

        const weights = {
            market: 0.25,
            sentiment: 0.15,
            fundamentals: 0.20,
            debate: 0.25,
            risk: 0.15,
        };

        // Convert signals to scores
        const signalToScore = (decision: AgentDecision): number => {
            const base = decision.signal === 'bullish' ? 1 :
                decision.signal === 'bearish' ? -1 : 0;
            return base * decision.confidence;
        };

        const debateScore = debateWinner === 'bull' ? bullConf :
            debateWinner === 'bear' ? -bearConf : 0;

        const weightedScore =
            signalToScore(agentVotes.market) * weights.market +
            signalToScore(agentVotes.sentiment) * weights.sentiment +
            signalToScore(agentVotes.fundamentals) * weights.fundamentals +
            debateScore * weights.debate;

        console.log(`   Weighted score: ${weightedScore.toFixed(3)}`);

        // Determine direction
        const direction: 'long' | 'short' | 'none' =
            weightedScore > 0.15 ? 'long' :
                weightedScore < -0.15 ? 'short' : 'none';

        // Phase 4: Risk Manager
        console.log(chalk.yellow('\n🛡️ PHASE 4: Risk Manager Review'));

        agentVotes.risk = await this.riskManager.analyze({
            ...context,
            proposedDirection: direction,
            proposedSize: this.calculateOptimalSize(),
        });
        console.log(`   ${this.formatSignal(agentVotes.risk)}`);

        // Check for VETO
        const isVetoed = agentVotes.risk.signal === 'reject' && agentVotes.risk.confidence > 0.6;
        if (isVetoed) {
            console.log(chalk.red('   ⛔ RISK MANAGER VETO'));
        }

        // Final confidence (reduced if vetoed)
        let finalConfidence = Math.abs(weightedScore);
        if (isVetoed) {
            finalConfidence = 0;
        } else if (agentVotes.risk.signal === 'approve') {
            finalConfidence = Math.min(1, finalConfidence + 0.1);
        }

        // Determine action
        let action: Action = 'hold';
        if (!isVetoed) {
            if (finalConfidence >= 0.55) action = 'execute';
            else if (finalConfidence >= 0.40) action = 'alert';
        }

        // Calculate position size using Kelly
        const kelly = calculateKellyFraction(this.tradeHistory, 0.25);
        const positionSize = Math.min(
            this.maxPositionSize,
            this.accountEquity * kelly / 88000 // Approximate BTC price
        );

        // Build decision
        const decision: TeamDecision = {
            symbol,
            action,
            confidence: finalConfidence,
            direction: isVetoed ? 'none' : direction,
            positionSize: action === 'execute' ? positionSize : 0,
            agentVotes,
            bullBearDebate: {
                bullThesis: agentVotes.bull.reasoning,
                bearThesis: agentVotes.bear.reasoning,
                winner: debateWinner,
            },
            timestamp: Date.now(),
        };

        // Phase 5: Execute if approved
        if (action === 'execute' && positionSize > 0) {
            console.log(chalk.yellow('\n⚡ PHASE 5: Execution'));
            console.log(`   Direction: ${direction.toUpperCase()}`);
            console.log(`   Size: ${positionSize.toFixed(6)} BTC`);

            const side = direction === 'long' ? 'buy' : 'sell';
            decision.execution = await executeMarket(
                this.weex,
                symbol,
                positionSize,
                side
            );

            if (decision.execution.success) {
                console.log(chalk.green(`   ✅ Executed @ $${decision.execution.avgPrice}`));
            }
        }

        // Upload coordinator decision
        await this.uploadAILog({
            agentName: this.name,
            signal: direction === 'long' ? 'bullish' : direction === 'short' ? 'bearish' : 'neutral',
            confidence: finalConfidence,
            stage: this.stage,
            reasoning: `Team consensus: ${action}. Debate winner: ${debateWinner}. ` +
                `${isVetoed ? 'Risk Manager vetoed.' : ''}`,
            data: { input: { symbol, agentVotes: Object.keys(agentVotes) }, output: decision },
            timestamp: new Date().toISOString(),
        });

        // Print summary
        this.printSummary(decision);

        return decision;
    }

    private calculateOptimalSize(): number {
        const kelly = calculateKellyFraction(this.tradeHistory, 0.25);
        return Math.min(this.maxPositionSize, this.accountEquity * kelly / 88000);
    }

    private formatSignal(decision: AgentDecision): string {
        const emoji = decision.signal === 'bullish' ? '🟢' :
            decision.signal === 'bearish' ? '🔴' :
                decision.signal === 'approve' ? '✅' :
                    decision.signal === 'reject' ? '❌' : '⚪';
        return `${emoji} ${decision.signal} (${(decision.confidence * 100).toFixed(0)}%)`;
    }

    private printSummary(decision: TeamDecision): void {
        console.log(chalk.cyan('\n' + '═'.repeat(60)));
        console.log(chalk.cyan('✅ TEAM ANALYSIS COMPLETE'));
        console.log(chalk.cyan('═'.repeat(60)));

        const actionColors: Record<Action, (s: string) => string> = {
            execute: chalk.green,
            alert: chalk.yellow,
            hold: chalk.gray,
        };

        console.log(`\n   Action: ${actionColors[decision.action](decision.action.toUpperCase())}`);
        console.log(`   Direction: ${decision.direction}`);
        console.log(`   Confidence: ${(decision.confidence * 100).toFixed(0)}%`);
        console.log(`   Position Size: ${decision.positionSize.toFixed(6)}`);

        if (decision.bullBearDebate) {
            console.log(`   Debate Winner: ${decision.bullBearDebate.winner}`);
        }

        if (decision.execution) {
            console.log(`   Execution: ${decision.execution.success ? '✅' : '❌'}`);
        }
    }

    async scanAllPairs(): Promise<Map<TradingPair, TeamDecision>> {
        console.log(chalk.magenta('\n' + '═'.repeat(60)));
        console.log(chalk.magenta('🔍 SCANNING ALL 8 WEEX PAIRS'));
        console.log(chalk.magenta('═'.repeat(60)));

        const results = new Map<TradingPair, TeamDecision>();

        for (const pair of TRADING_PAIRS) {
            try {
                const decision = await this.runFullAnalysis(pair);
                results.set(pair, decision);

                // Brief summary
                console.log(chalk.cyan(`\n${pair}: ${decision.action.toUpperCase()} (${(decision.confidence * 100).toFixed(0)}%)`));

                // Rate limiting between pairs
                await new Promise(r => setTimeout(r, 2000));

            } catch (error) {
                console.error(`Error analyzing ${pair}:`, error);
            }
        }

        return results;
    }
}

export default EnhancedCoordinatorAgent;
