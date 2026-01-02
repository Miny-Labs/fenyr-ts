/**
 * Market Analyst Agent
 * Technical analysis specialist
 */

import OpenAI from 'openai';
import { RustSDKBridge } from '../sdk/rust-bridge.js';
import { BaseAgent, AgentDecision, Signal } from './base.js';

export class MarketAnalystAgent extends BaseAgent {
    constructor(openai: OpenAI, weex: RustSDKBridge, model: string = 'gpt-5.2') {
        super('MarketAnalyst', 'Technical Analysis', openai, weex, model);
    }

    getSystemPrompt(): string {
        return `You are the Market Analyst Agent, specialized in technical analysis.

Your role:
- Analyze price action and technical indicators
- Identify trends, support/resistance levels
- Generate trading signals based on technical patterns

You receive: RSI, EMA, MACD, price data, orderbook
You output: BUY, SELL, or NEUTRAL signal with confidence 0-1

Be precise and data-driven. Format your response as JSON:
{
  "signal": "BUY|SELL|NEUTRAL",
  "confidence": 0.0-1.0,
  "reasoning": "Your technical analysis..."
}`;
    }

    async analyze(context: Record<string, unknown>): Promise<AgentDecision> {
        const symbol = (context.symbol as string) || 'cmt_btcusdt';

        // Fetch real market data
        const marketData = await this.getMarketData(symbol);
        const indicators = await this.getTechnicalIndicators(symbol);

        const analysisContext = {
            symbol,
            marketData,
            indicators,
            timestamp: new Date().toISOString(),
        };

        // Call GPT for analysis
        const prompt = `Analyze ${symbol} and provide a trading signal based on the technical data.`;
        const response = await this.callGPT(prompt, analysisContext);

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
            BUY: 'buy',
            SELL: 'sell',
            NEUTRAL: 'neutral',
            HOLD: 'hold',
        };
        const signal = signalMap[result.signal.toUpperCase()] || 'neutral';

        const decision: AgentDecision = {
            agentName: this.name,
            stage: this.stage,
            signal,
            confidence: result.confidence,
            reasoning: result.reasoning,
            data: { input: analysisContext, output: { indicators } },
            timestamp: new Date().toISOString(),
        };

        // Upload AI log
        await this.uploadAILog(decision);

        return decision;
    }
}
