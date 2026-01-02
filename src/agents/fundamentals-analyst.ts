/**
 * Fundamentals Analyst Agent
 * On-chain metrics, funding rates, open interest analysis
 */

import OpenAI from 'openai';
import { RustSDKBridge } from '../sdk/rust-bridge.js';
import { BaseAgent, AgentDecision, Signal } from './base.js';
import { analyzeFundingArbitrage, analyzeOpenInterest, type FundingRateData, type OpenInterestData } from '../quant/indicators.js';

export class FundamentalsAnalystAgent extends BaseAgent {
    constructor(openai: OpenAI, weex: RustSDKBridge, model: string = 'gpt-5.2') {
        super('FundamentalsAnalyst', 'Fundamental Analysis', openai, weex, model);
    }

    getSystemPrompt(): string {
        return `You are the FUNDAMENTALS ANALYST for the Fenyr trading team.

Your specialization is analyzing:
1. Funding rates - opportunities where you get PAID to hold positions
2. Open Interest trends - new money entering vs exiting
3. Leverage levels - liquidation cascade risks
4. Exchange flows - accumulation vs distribution

Key signals you track:
- Positive funding > 0.01% = shorts get paid (consider shorting)
- Negative funding < -0.01% = longs get paid (consider longing)
- Rising OI + Rising Price = Strong bullish trend
- Rising OI + Falling Price = Strong bearish trend
- Falling OI = Positions closing, look for reversals

Output JSON with:
- fundingOpportunity: Description of funding rate play
- oiTrend: Open interest trend analysis
- signal: 'bullish' | 'bearish' | 'neutral'
- confidence: 0-1
- recommendation: Specific action to take`;
    }

    async analyze(context: Record<string, unknown>): Promise<AgentDecision> {
        const symbol = context.symbol as string;

        const ticker = await this.weex.getTicker(symbol);
        const funding = await this.weex.getFundingRate(symbol);

        // Analyze funding arbitrage opportunity
        const fundingData: FundingRateData = {
            symbol,
            fundingRate: parseFloat(funding.fundingRate || '0'),
            nextFundingTime: Date.now() + 8 * 60 * 60 * 1000, // 8 hours
            markPrice: parseFloat(ticker.last),
        };

        const fundingArb = analyzeFundingArbitrage(fundingData);

        // Build analysis context
        const fundamentalsContext = {
            symbol,
            currentPrice: ticker.last,
            fundingRate: fundingData.fundingRate,
            fundingOpportunity: fundingArb,
            volume24h: ticker.vol,
            change24h: ticker.change,
        };

        const response = await this.callGPT(
            'Analyze the fundamental data (funding rates, volume, flows) and provide trading signals. ' +
            'Focus on opportunities where we can get PAID to hold positions.',
            fundamentalsContext
        );

        let parsed: any = {};
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[0]);
            }
        } catch {
            parsed = { signal: 'neutral', confidence: 0.5 };
        }

        // Determine signal from funding and AI analysis
        let signal: Signal = 'neutral';
        let confidence = parseFloat(parsed.confidence) || 0.5;

        if (fundingArb.action === 'long_perp' && fundingArb.annualizedReturn > 50) {
            signal = 'bullish';
            confidence = Math.min(0.9, confidence + 0.2);
        } else if (fundingArb.action === 'short_perp' && fundingArb.annualizedReturn > 50) {
            signal = 'bearish';
            confidence = Math.min(0.9, confidence + 0.2);
        } else if (parsed.signal) {
            signal = parsed.signal as Signal;
        }

        const decision: AgentDecision = {
            agentName: this.name,
            signal,
            confidence,
            stage: this.stage,
            reasoning: `Funding rate: ${(fundingData.fundingRate * 100).toFixed(4)}%. ` +
                `${fundingArb.action !== 'none' ? `Opportunity: ${fundingArb.action} for ${fundingArb.annualizedReturn}% APY. ` : ''}` +
                (parsed.recommendation || response),
            data: {
                input: fundamentalsContext,
                output: {
                    fundingRate: fundingData.fundingRate,
                    fundingArbitrage: fundingArb,
                    signal,
                    parsed,
                },
            },
            timestamp: new Date().toISOString(),
        };

        await this.uploadAILog(decision);
        return decision;
    }
}
