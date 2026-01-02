/**
 * Executor Agent
 * Handles order execution and management
 */

import OpenAI from 'openai';
import { RustSDKBridge } from '../sdk/rust-bridge.js';
import { BaseAgent, AgentDecision, Signal } from './base.js';

export class ExecutorAgent extends BaseAgent {
    constructor(openai: OpenAI, weex: RustSDKBridge, model: string = 'gpt-5.2') {
        super('Executor', 'Order Execution', openai, weex, model);
    }

    getSystemPrompt(): string {
        return `You are the Executor Agent, responsible for order execution.

Your role:
- Execute trades based on team consensus
- Manage order placement
- Track fill status
- Report execution results

You execute the final decision from the Coordinator.`;
    }

    async analyze(context: Record<string, unknown>): Promise<AgentDecision> {
        const action = (context.action as string) || 'hold';
        const symbol = (context.symbol as string) || 'cmt_btcusdt';
        const size = (context.size as string) || '0.0002';
        const tradeDirection = (context.tradeDirection as string) || 'buy';
        const reasoning = (context.reasoning as string) || '';
        const confidence = (context.confidence as number) || 0.5;

        // Execute if action is execute
        if (action.toLowerCase() === 'execute' && ['buy', 'sell'].includes(tradeDirection)) {
            const tradeAction = tradeDirection === 'buy' ? 'open_long' : 'open_short';

            const result = await this.executeTrade(symbol, tradeAction, size, confidence, reasoning);

            const signal: Signal = result.executed ? (tradeDirection === 'buy' ? 'buy' : 'sell') : 'hold';

            const decision: AgentDecision = {
                agentName: this.name,
                stage: this.stage,
                signal,
                confidence: result.executed ? 1.0 : 0.0,
                reasoning: result.executed
                    ? `Executed ${tradeAction}: Order ID ${result.orderId}`
                    : `Execution failed: ${result.error}`,
                data: { input: context, output: result },
                timestamp: new Date().toISOString(),
            };

            // Upload AI log with order ID if successful
            const orderId = result.executed ? parseInt(result.orderId as string, 10) : undefined;
            await this.uploadAILog(decision, orderId);

            return decision;
        }

        // No execution needed
        const decision: AgentDecision = {
            agentName: this.name,
            stage: this.stage,
            signal: 'hold',
            confidence: 1.0,
            reasoning: `No execution required. Action: ${action}`,
            data: { input: context, output: { action: 'hold' } },
            timestamp: new Date().toISOString(),
        };

        await this.uploadAILog(decision);

        return decision;
    }
}
