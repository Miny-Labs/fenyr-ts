/**
 * Sentiment Agent
 * Analyzes funding rates, OI, and market positioning
 */

import OpenAI from 'openai';
import { WeexClient } from '../sdk/client.js';
import { BaseAgent, AgentDecision, Signal } from './base.js';

export class SentimentAgent extends BaseAgent {
    constructor(openai: OpenAI, weex: WeexClient, model: string = 'gpt-5.2') {
        super('SentimentAgent', 'Sentiment Analysis', openai, weex, model);
    }

    getSystemPrompt(): string {
        return `You are the Sentiment Agent, specialized in market sentiment analysis.

Your role:
- Analyze funding rates (negative = shorts pay longs, bullish pressure)
- Monitor open interest changes (rising OI = new positions)
- Assess market positioning and crowding
- Identify potential squeezes

You output: BULLISH, BEARISH, or NEUTRAL with confidence 0-1

Format your response as JSON:
{
  "signal": "BULLISH|BEARISH|NEUTRAL",
  "confidence": 0.0-1.0,
  "reasoning": "Your sentiment analysis..."
}`;
    }

    async analyze(context: Record<string, unknown>): Promise<AgentDecision> {
        const symbol = (context.symbol as string) || 'cmt_btcusdt';

        // Fetch sentiment data
        const ticker = await this.weex.getTicker(symbol);
        const funding = await this.weex.getFundingRate(symbol);

        let openInterest = 'N/A';
        try {
            const oi = await this.weex.getOpenInterest(symbol);
            openInterest = oi.openInterestAmount;
        } catch {
            // OI may not be available
        }

        const sentimentContext = {
            symbol,
            currentPrice: ticker.last,
            priceChange24h: ticker.priceChangePercent,
            volume24h: ticker.volume_24h,
            fundingRate: funding.fundingRate,
            nextFundingTime: funding.fundingTime,
            openInterest,
            timestamp: new Date().toISOString(),
        };

        // Call GPT
        const prompt = `Analyze sentiment for ${symbol} based on funding and market data.`;
        const response = await this.callGPT(prompt, sentimentContext);

        // Parse response
        let result: { signal: string; confidence: number; reasoning: string };
        try {
            const jsonStart = response.indexOf('{');
            const jsonEnd = response.lastIndexOf('}') + 1;
            result = JSON.parse(response.slice(jsonStart, jsonEnd));
        } catch {
            result = { signal: 'NEUTRAL', confidence: 0.5, reasoning: response };
        }

        // Map signal
        const signalMap: Record<string, Signal> = {
            BULLISH: 'bullish',
            BEARISH: 'bearish',
            NEUTRAL: 'neutral',
        };
        const signal = signalMap[result.signal.toUpperCase()] || 'neutral';

        const decision: AgentDecision = {
            agentName: this.name,
            stage: this.stage,
            signal,
            confidence: result.confidence,
            reasoning: result.reasoning,
            data: { input: sentimentContext, output: { fundingRate: funding.fundingRate } },
            timestamp: new Date().toISOString(),
        };

        await this.uploadAILog(decision);

        return decision;
    }
}
