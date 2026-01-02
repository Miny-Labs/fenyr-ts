/**
 * Base Agent Class
 * Foundation for all specialized agents - Uses Rust SDK via Bridge
 */

import OpenAI from 'openai';
import { RustSDKBridge } from '../sdk/rust-bridge.js';
import { TRADING_TOOLS, ACTION_TO_SIDE } from '../tools/trading-tools.js';

export type Signal = 'buy' | 'sell' | 'hold' | 'neutral' | 'bullish' | 'bearish' | 'approve' | 'reject' | 'reduce';
export type Action = 'execute' | 'hold' | 'alert';

export interface AgentDecision {
    agentName: string;
    stage: string;
    signal: Signal;
    confidence: number;
    reasoning: string;
    data: Record<string, unknown>;
    timestamp: string;
}

export interface AgentMessage {
    from: string;
    to: string;
    content: string;
    context?: Record<string, unknown>;
    timestamp: string;
}

export interface TechnicalIndicators {
    rsi_14: number;
    ema_20: number;
    ema_50: number;
    macd: number;
    currentPrice: number;
}

export abstract class BaseAgent {
    protected name: string;
    protected stage: string;
    protected openai: OpenAI;
    protected weex: RustSDKBridge;
    protected model: string;
    protected messageQueue: AgentMessage[] = [];

    constructor(
        name: string,
        stage: string,
        openai: OpenAI,
        weex: RustSDKBridge,
        model: string = 'gpt-5.2'
    ) {
        this.name = name;
        this.stage = stage;
        this.openai = openai;
        this.weex = weex;
        this.model = model;
    }

    abstract getSystemPrompt(): string;
    abstract analyze(context: Record<string, unknown>): Promise<AgentDecision>;

    getName(): string {
        return this.name;
    }

    getStage(): string {
        return this.stage;
    }

    receiveMessage(message: AgentMessage): void {
        this.messageQueue.push(message);
    }

    getMessages(): AgentMessage[] {
        return [...this.messageQueue];
    }

    clearMessages(): void {
        this.messageQueue = [];
    }

    protected async uploadAILog(decision: AgentDecision, orderId?: number): Promise<boolean> {
        try {
            const log = {
                orderId,
                stage: decision.stage,
                model: this.model,
                input: decision.data.input as Record<string, unknown> || {},
                output: {
                    signal: decision.signal,
                    confidence: decision.confidence,
                    agent: decision.agentName,
                    ...(decision.data.output as Record<string, unknown> || {}),
                },
                explanation: decision.reasoning,
            };

            const result = await this.weex.uploadAILog(log);
            return result.code === '00000';
        } catch (error) {
            console.error(`Failed to upload AI log for ${this.name}:`, error);
            return false;
        }
    }

    protected async callGPT(prompt: string, context: Record<string, unknown>): Promise<string> {
        const response = await this.openai.chat.completions.create({
            model: this.model,
            messages: [
                { role: 'system', content: this.getSystemPrompt() },
                { role: 'user', content: `${prompt}\n\nContext:\n${JSON.stringify(context, null, 2)}` },
            ],
            temperature: 0.7,
        });

        return response.choices[0]?.message?.content || '';
    }

    protected calculateRSI(prices: number[], period: number = 14): number {
        if (prices.length < period + 1) return 50;

        const deltas: number[] = [];
        for (let i = 1; i < prices.length; i++) {
            deltas.push(prices[i] - prices[i - 1]);
        }

        const gains = deltas.map((d) => (d > 0 ? d : 0));
        const losses = deltas.map((d) => (d < 0 ? -d : 0));

        const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
        const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;

        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
    }

    protected calculateEMA(prices: number[], period: number): number {
        if (prices.length < period) return prices[prices.length - 1] || 0;

        const multiplier = 2 / (period + 1);
        let ema = prices[0];
        for (let i = 1; i < prices.length; i++) {
            ema = (prices[i] - ema) * multiplier + ema;
        }
        return Math.round(ema * 100) / 100;
    }

    protected async getMarketData(symbol: string): Promise<Record<string, unknown>> {
        const ticker = await this.weex.getTicker(symbol);
        const depth = await this.weex.getDepth(symbol);

        return {
            symbol,
            lastPrice: ticker.last,
            high24h: ticker.high_24h,
            low24h: ticker.low_24h,
            volume24h: ticker.volume_24h,
            priceChange: ticker.priceChangePercent,
            bestBid: depth.bids?.[0]?.[0],
            bestAsk: depth.asks?.[0]?.[0],
            timestamp: new Date().toISOString(),
        };
    }

    protected async getTechnicalIndicators(symbol: string): Promise<TechnicalIndicators> {
        const candles = await this.weex.getCandles(symbol);

        // Handle different response formats
        let closes: number[] = [];
        if (Array.isArray(candles)) {
            closes = candles.map((c: any) => {
                if (Array.isArray(c)) return parseFloat(c[4]);
                if (typeof c === 'object') return parseFloat(c.close);
                return 0;
            }).filter((v) => v > 0);
        }

        if (closes.length === 0) {
            const ticker = await this.weex.getTicker(symbol);
            return {
                rsi_14: 50,
                ema_20: parseFloat(ticker.last),
                ema_50: parseFloat(ticker.last),
                macd: 0,
                currentPrice: parseFloat(ticker.last),
            };
        }

        return {
            rsi_14: this.calculateRSI(closes),
            ema_20: this.calculateEMA(closes, 20),
            ema_50: this.calculateEMA(closes, 50),
            macd: this.calculateEMA(closes, 12) - this.calculateEMA(closes, 26),
            currentPrice: closes[closes.length - 1],
        };
    }

    protected async getAccountStatus(): Promise<Record<string, unknown>> {
        const assets = await this.weex.getAssets();
        const positions = await this.weex.getAllPositions();

        const usdtAsset = (assets as any[]).find((a) => a.coinName === 'USDT') || {};
        const activePositions = (positions as any[]).filter((p) => parseFloat(p.total) > 0);

        return {
            availableUsdt: usdtAsset.available || '0',
            equityUsdt: usdtAsset.equity || '0',
            unrealizedPnl: usdtAsset.unrealizePnl || '0',
            activePositions: activePositions.map((p) => ({
                symbol: p.symbol,
                size: p.total,
                side: p.holdSide,
                entryPrice: p.averageOpenPrice,
                pnl: p.unrealizedPL,
            })),
            positionCount: activePositions.length,
        };
    }

    protected async executeTrade(
        symbol: string,
        action: string,
        size: string,
        confidence: number,
        reasoning: string
    ): Promise<Record<string, unknown>> {
        if (confidence < 0.6) {
            return { executed: false, error: 'Confidence too low (<0.6)' };
        }

        const side = ACTION_TO_SIDE[action];
        if (!side) {
            return { executed: false, error: `Invalid action: ${action}` };
        }

        try {
            const ticker = await this.weex.getTicker(symbol);
            const result = await this.weex.placeOrder(symbol, size, side);

            return {
                executed: true,
                orderId: result.order_id,
                symbol,
                action,
                size,
                price: ticker.last,
                confidence,
                reasoning,
            };
        } catch (error: any) {
            return { executed: false, error: error.message };
        }
    }
}
