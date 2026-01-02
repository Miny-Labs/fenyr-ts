/**
 * Risk Manager Agent
 * Position sizing and risk assessment
 */

import OpenAI from 'openai';
import { RustSDKBridge } from '../sdk/rust-bridge.js';
import { BaseAgent, AgentDecision, Signal } from './base.js';

export class RiskManagerAgent extends BaseAgent {
    private maxPositionSize: number;
    private maxRiskPct: number;

    constructor(
        openai: OpenAI,
        weex: RustSDKBridge,
        model: string = 'gpt-5.2',
        maxPositionSize: number = 0.0002,
        maxRiskPct: number = 0.02
    ) {
        super('RiskManager', 'Risk Assessment', openai, weex, model);
        this.maxPositionSize = maxPositionSize;
        this.maxRiskPct = maxRiskPct;
    }

    getSystemPrompt(): string {
        return `You are the Risk Manager Agent, the guardian of capital.

Your role:
- Assess current portfolio exposure
- Calculate appropriate position sizing
- Enforce risk limits (max ${this.maxRiskPct * 100}% per trade)
- Veto trades that exceed risk tolerance

You have VETO POWER - if risk is too high, REJECT the trade.
Max position size: ${this.maxPositionSize} BTC

Output: APPROVE, REDUCE, or REJECT with recommended size

Format your response as JSON:
{
  "signal": "APPROVE|REDUCE|REJECT",
  "confidence": 0.0-1.0,
  "recommended_size": ${this.maxPositionSize},
  "reasoning": "Your risk assessment..."
}`;
    }

    async analyze(context: Record<string, unknown>): Promise<AgentDecision> {
        const symbol = (context.symbol as string) || 'cmt_btcusdt';
        const proposedSignal = (context.proposedSignal as string) || 'buy';
        const proposedConfidence = (context.proposedConfidence as number) || 0.5;

        // Fetch account data
        const account = await this.getAccountStatus();
        const ticker = await this.weex.getTicker(symbol);

        const riskContext = {
            symbol,
            proposedSignal,
            proposedConfidence,
            account,
            currentPrice: ticker.last,
            riskLimits: {
                maxRiskPct: this.maxRiskPct,
                maxPositionSize: this.maxPositionSize,
            },
            timestamp: new Date().toISOString(),
        };

        // Call GPT
        const prompt = `Assess the risk for a potential ${proposedSignal} trade on ${symbol}. Should we proceed?`;
        const response = await this.callGPT(prompt, riskContext);

        // Parse response
        let result: { signal: string; confidence: number; recommended_size: number; reasoning: string };
        try {
            const jsonStart = response.indexOf('{');
            const jsonEnd = response.lastIndexOf('}') + 1;
            result = JSON.parse(response.slice(jsonStart, jsonEnd));
        } catch {
            result = {
                signal: 'APPROVE',
                confidence: 0.7,
                recommended_size: this.maxPositionSize,
                reasoning: response,
            };
        }

        // Map signal
        const signalMap: Record<string, Signal> = {
            APPROVE: 'approve',
            REDUCE: 'reduce',
            REJECT: 'reject',
        };
        const signal = signalMap[result.signal.toUpperCase()] || 'approve';

        // Ensure size is within limits
        const recommendedSize = Math.min(result.recommended_size || this.maxPositionSize, this.maxPositionSize);

        const decision: AgentDecision = {
            agentName: this.name,
            stage: this.stage,
            signal,
            confidence: result.confidence,
            reasoning: result.reasoning,
            data: {
                input: riskContext,
                output: { recommendedSize, riskStatus: result.signal },
            },
            timestamp: new Date().toISOString(),
        };

        await this.uploadAILog(decision);

        return decision;
    }
}
