/**
 * Bull Researcher Agent
 * Dialectical debate - identifies growth potential and long opportunities
 */

import OpenAI from 'openai';
import { RustSDKBridge } from '../sdk/rust-bridge.js';
import { BaseAgent, AgentDecision, Signal } from './base.js';

export class BullResearcherAgent extends BaseAgent {
    constructor(openai: OpenAI, weex: RustSDKBridge, model: string = 'gpt-5.2') {
        super('BullResearcher', 'Strategy Generation', openai, weex, model);
    }

    getSystemPrompt(): string {
        return `You are the BULL RESEARCHER for the Fenyr trading team.

Your role in the dialectical debate is to:
1. Identify growth potential and bullish catalysts
2. Find positive indicators that others might dismiss
3. Advocate for LONG opportunities with conviction
4. Counter bearish arguments with data-driven optimism
5. Identify undervalued entry points

Your analysis style:
- Look for momentum building, accumulation patterns
- Identify funding rate opportunities (negative = longs get paid)
- Spot divergences that precede upward moves
- Recognize capitulation signals as buying opportunities
- Consider on-chain metrics suggesting accumulation

IMPORTANT: You must argue the bullish case even if you see risks.
The Bear Researcher will present the other side.
Your debate produces balanced investment decisions.

Output JSON with:
- bullish_thesis: Your main argument for going long
- catalysts: List of 3-5 positive catalysts
- entry_price: Recommended entry level
- target_price: Profit target
- confidence: 0-1 score for your conviction
- counter_bear: Response to likely bear arguments`;
    }

    async analyze(context: Record<string, unknown>): Promise<AgentDecision> {
        const symbol = context.symbol as string;
        const bearishArguments = context.bearishArguments as string | undefined;

        const ticker = await this.weex.getTicker(symbol);
        const funding = await this.weex.getFundingRate(symbol);
        const indicators = await this.getTechnicalIndicators(symbol);

        const debateContext = {
            symbol,
            currentPrice: ticker.last,
            fundingRate: funding.fundingRate,
            indicators,
            bearishArguments: bearishArguments || 'No bear arguments yet',
            task: 'Present the BULLISH case for this asset',
        };

        const response = await this.callGPT(
            'Analyze the market and present a compelling BULLISH thesis. ' +
            'Counter any bearish arguments with data. ' +
            'Be specific about entry, target, and catalysts.',
            debateContext
        );

        let parsed: any = {};
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[0]);
            }
        } catch {
            parsed = { bullish_thesis: response, confidence: 0.5 };
        }

        const confidence = parseFloat(parsed.confidence) || 0.5;

        // Bull researcher always argues for bullish signal
        const decision: AgentDecision = {
            agentName: this.name,
            signal: 'bullish' as Signal,
            confidence,
            stage: this.stage,
            reasoning: parsed.bullish_thesis || response,
            data: {
                input: debateContext,
                output: {
                    thesis: parsed.bullish_thesis,
                    catalysts: parsed.catalysts || [],
                    entry: parsed.entry_price,
                    target: parsed.target_price,
                    counterBear: parsed.counter_bear,
                },
            },
        };

        await this.uploadAILog(decision);
        return decision;
    }
}
