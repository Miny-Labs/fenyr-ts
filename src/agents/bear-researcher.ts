/**
 * Bear Researcher Agent
 * Dialectical debate - critical risk assessment and short opportunities
 */

import OpenAI from 'openai';
import { RustSDKBridge } from '../sdk/rust-bridge.js';
import { BaseAgent, AgentDecision, Signal } from './base.js';

export class BearResearcherAgent extends BaseAgent {
    constructor(openai: OpenAI, weex: RustSDKBridge, model: string = 'gpt-5.2') {
        super('BearResearcher', 'Risk Assessment', openai, weex, model);
    }

    getSystemPrompt(): string {
        return `You are the BEAR RESEARCHER for the Fenyr trading team.

Your role in the dialectical debate is to:
1. Identify risks that others might overlook
2. Find negative indicators and warning signs
3. Advocate for SHORT opportunities or CAUTION
4. Counter bullish arguments with skepticism
5. Protect capital by highlighting dangers

Your analysis style:
- Look for distribution patterns, smart money selling
- Identify overextended moves and exhaustion signals
- Spot positive funding rates (shorts get paid)
- Recognize FOMO and euphoria as danger signs
- Consider macro risks and regulatory concerns

IMPORTANT: You must argue the bearish case even if you see potential.
The Bull Researcher will present the other side.
Your debate produces balanced investment decisions.

Output JSON with:
- bearish_thesis: Your main argument for caution/shorting
- risks: List of 3-5 specific risks
- resistance_levels: Key prices where rallies should fail
- stop_loss: Where bulls should admit defeat
- confidence: 0-1 score for your conviction
- counter_bull: Response to likely bull arguments`;
    }

    async analyze(context: Record<string, unknown>): Promise<AgentDecision> {
        const symbol = context.symbol as string;
        const bullishArguments = context.bullishArguments as string | undefined;

        const ticker = await this.weex.getTicker(symbol);
        const funding = await this.weex.getFundingRate(symbol);
        const indicators = await this.getTechnicalIndicators(symbol);

        const debateContext = {
            symbol,
            currentPrice: ticker.last,
            fundingRate: funding.fundingRate,
            indicators,
            bullishArguments: bullishArguments || 'No bull arguments yet',
            task: 'Present the BEARISH case / risks for this asset',
        };

        const response = await this.callGPT(
            'Analyze the market and present a critical BEARISH thesis. ' +
            'Counter any bullish arguments with skepticism. ' +
            'Be specific about risks, resistance, and stop-loss levels.',
            debateContext
        );

        let parsed: any = {};
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[0]);
            }
        } catch {
            parsed = { bearish_thesis: response, confidence: 0.5 };
        }

        const confidence = parseFloat(parsed.confidence) || 0.5;

        // Bear researcher always argues for bearish signal
        const decision: AgentDecision = {
            agentName: this.name,
            signal: 'bearish' as Signal,
            confidence,
            stage: this.stage,
            reasoning: parsed.bearish_thesis || response,
            data: {
                input: debateContext,
                output: {
                    thesis: parsed.bearish_thesis,
                    risks: parsed.risks || [],
                    resistance: parsed.resistance_levels,
                    stopLoss: parsed.stop_loss,
                    counterBull: parsed.counter_bull,
                },
            },
        };

        await this.uploadAILog(decision);
        return decision;
    }
}
