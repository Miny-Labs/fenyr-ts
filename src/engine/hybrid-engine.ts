/**
 * Hybrid Trading Engine
 * Real Quant Firm Architecture:
 * - AI Agents run async in background (strategists)
 * - HFT Engine executes trades (algorithms)
 * - Agents configure engine parameters dynamically
 */

import { EventEmitter } from 'events';
import OpenAI from 'openai';
import chalk from 'chalk';
import { RustSDKBridge } from '../sdk/rust-bridge.js';
import { calculateOBI, calculateRSI, calculateEMA, calculateKellyFraction, calculateATR } from '../quant/indicators.js';

// ==================== CONFIGURATION THAT AI AGENTS CAN MODIFY ====================

export interface TradingConfig {
    // Signal weights (AI agents adjust these based on market regime)
    weights: {
        obi: number;
        rsi: number;
        ema: number;
        momentum: number;
        funding: number;
    };

    // Risk parameters (Risk Manager agent adjusts)
    risk: {
        maxPositionSize: number;
        stopLossPercent: number;
        takeProfitPercent: number;
        maxDrawdownPercent: number;
        riskPerTrade: number;
    };

    // Execution parameters (Strategist adjusts)
    execution: {
        signalThreshold: number;
        minConfidence: number;
        cooldownSeconds: number;
        useIceberg: boolean;
    };

    // Market regime (Regime Detector sets)
    regime: 'trending_up' | 'trending_down' | 'ranging' | 'volatile' | 'unknown';

    // Bias (Bull/Bear Research sets)
    bias: 'bullish' | 'bearish' | 'neutral';
    biasStrength: number; // -1 to 1

    // Last update timestamp
    lastAIUpdate: number;
}

const DEFAULT_CONFIG: TradingConfig = {
    weights: {
        obi: 0.25,
        rsi: 0.20,
        ema: 0.20,
        momentum: 0.20,
        funding: 0.15,
    },
    risk: {
        maxPositionSize: 0.01,
        stopLossPercent: 0.02,
        takeProfitPercent: 0.03,
        maxDrawdownPercent: 0.10,
        riskPerTrade: 0.02,
    },
    execution: {
        signalThreshold: 0.2,
        minConfidence: 0.5,
        cooldownSeconds: 30,
        useIceberg: false,
    },
    regime: 'unknown',
    bias: 'neutral',
    biasStrength: 0,
    lastAIUpdate: 0,
};

// ==================== AI STRATEGIC LAYER ====================

class StrategicAILayer extends EventEmitter {
    private openai: OpenAI;
    private weex: RustSDKBridge;
    private config: TradingConfig;
    private isRunning: boolean = false;
    private analysisInterval: NodeJS.Timeout | null = null;
    private model: string;

    constructor(openai: OpenAI, weex: RustSDKBridge, model: string = 'mimo-v2-flash') {
        super();
        this.openai = openai;
        this.weex = weex;
        this.model = model;
        this.config = { ...DEFAULT_CONFIG };
    }

    getConfig(): TradingConfig {
        return this.config;
    }

    async start(intervalMs: number = 60000): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;

        console.log(chalk.blue('\n🧠 STRATEGIC AI LAYER STARTED'));
        console.log(chalk.gray(`   AI Analysis Interval: ${intervalMs / 1000}s`));
        console.log(chalk.gray(`   Model: ${this.model}`));

        // Run first analysis immediately
        await this.runStrategicAnalysis();

        // Then run periodically
        this.analysisInterval = setInterval(async () => {
            if (this.isRunning) {
                await this.runStrategicAnalysis();
            }
        }, intervalMs);
    }

    stop(): void {
        this.isRunning = false;
        if (this.analysisInterval) {
            clearInterval(this.analysisInterval);
            this.analysisInterval = null;
        }
    }

    private async runStrategicAnalysis(): Promise<void> {
        const startTime = Date.now();
        console.log(chalk.blue(`\n[AI] Strategic analysis started...`));

        try {
            // Gather market data for AI analysis
            const [ticker, candles, funding, positions] = await Promise.all([
                this.weex.getTicker('cmt_btcusdt'),
                this.weex.getCandles('cmt_btcusdt'),
                this.weex.getFundingRate('cmt_btcusdt').catch(() => ({ fundingRate: 0 })),
                this.weex.getPositions(),
            ]);

            const currentPrice = parseFloat(ticker.last || ticker.lastPr);
            const priceChange24h = parseFloat(ticker.priceChangePercent || 0);
            const volume24h = parseFloat(ticker.volume_24h || ticker.baseVolume || 0);
            const fundingRate = parseFloat(funding.fundingRate || 0);

            // Calculate technical indicators
            let closes: number[] = [];
            if (Array.isArray(candles)) {
                closes = candles.map((c: any) => parseFloat(Array.isArray(c) ? c[4] : c.close)).filter(v => v > 0);
            }

            const rsi = closes.length >= 15 ? calculateRSI(closes, 14) : 50;
            const ema20 = closes.length >= 20 ? calculateEMA(closes, 20) : currentPrice;
            const ema50 = closes.length >= 50 ? calculateEMA(closes, 50) : currentPrice;

            // Build context for AI
            const context = {
                currentPrice,
                priceChange24h,
                volume24h,
                fundingRate,
                rsi,
                ema20,
                ema50,
                emaTrend: ema20 > ema50 ? 'bullish' : 'bearish',
                currentConfig: this.config,
                hasPosition: positions.some((p: any) => parseFloat(p.total || 0) > 0),
            };

            // Call AI for strategic decisions
            const aiResponse = await this.callStrategicAI(context);

            // Apply AI recommendations
            if (aiResponse) {
                this.applyAIRecommendations(aiResponse);
            }

            const elapsed = Date.now() - startTime;
            console.log(chalk.blue(`[AI] Analysis complete (${elapsed}ms) - Regime: ${this.config.regime}, Bias: ${this.config.bias}`));

            this.emit('configUpdate', this.config);

        } catch (error: any) {
            console.log(chalk.yellow(`[AI] Strategic analysis error: ${error.message}`));
        }
    }

    private async callStrategicAI(context: any): Promise<any> {
        const systemPrompt = `You are a senior quantitative trading strategist at a hedge fund. 
Your job is to analyze market conditions and configure the HFT trading engine.

You must respond with ONLY valid JSON in this exact format:
{
    "regime": "trending_up" | "trending_down" | "ranging" | "volatile",
    "bias": "bullish" | "bearish" | "neutral",
    "biasStrength": number between -1 and 1,
    "signalThreshold": number between 0.1 and 0.5,
    "riskPerTrade": number between 0.01 and 0.05,
    "weights": {
        "obi": number 0-0.4,
        "rsi": number 0-0.4,
        "ema": number 0-0.4,
        "momentum": number 0-0.4
    },
    "reasoning": "brief explanation"
}

Guidelines:
- In TRENDING markets: increase momentum weight, lower signal threshold
- In RANGING markets: increase RSI weight (mean reversion), higher threshold
- In VOLATILE markets: reduce riskPerTrade, increase threshold
- If RSI < 30: lean bullish bias
- If RSI > 70: lean bearish bias
- If funding rate very positive: favor shorts
- If funding rate very negative: favor longs`;

        try {
            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Analyze this market state and configure trading engine:\n${JSON.stringify(context, null, 2)}` }
                ],
                temperature: 0.3,
                max_tokens: 500,
                response_format: { type: 'json_object' },
            });

            const content = response.choices[0]?.message?.content || '{}';
            return JSON.parse(content);
        } catch (error: any) {
            console.log(chalk.yellow(`[AI] API call failed: ${error.message}`));
            return null;
        }
    }

    private applyAIRecommendations(ai: any): void {
        try {
            // Update regime
            if (ai.regime && ['trending_up', 'trending_down', 'ranging', 'volatile'].includes(ai.regime)) {
                this.config.regime = ai.regime;
            }

            // Update bias
            if (ai.bias && ['bullish', 'bearish', 'neutral'].includes(ai.bias)) {
                this.config.bias = ai.bias;
            }
            if (typeof ai.biasStrength === 'number') {
                this.config.biasStrength = Math.max(-1, Math.min(1, ai.biasStrength));
            }

            // Update execution params
            if (typeof ai.signalThreshold === 'number') {
                this.config.execution.signalThreshold = Math.max(0.1, Math.min(0.5, ai.signalThreshold));
            }
            if (typeof ai.riskPerTrade === 'number') {
                this.config.risk.riskPerTrade = Math.max(0.01, Math.min(0.05, ai.riskPerTrade));
            }

            // Update weights
            if (ai.weights) {
                const w = ai.weights;
                if (typeof w.obi === 'number') this.config.weights.obi = Math.max(0, Math.min(0.4, w.obi));
                if (typeof w.rsi === 'number') this.config.weights.rsi = Math.max(0, Math.min(0.4, w.rsi));
                if (typeof w.ema === 'number') this.config.weights.ema = Math.max(0, Math.min(0.4, w.ema));
                if (typeof w.momentum === 'number') this.config.weights.momentum = Math.max(0, Math.min(0.4, w.momentum));
            }

            this.config.lastAIUpdate = Date.now();

            console.log(chalk.blue(`[AI] Config updated - Weights: OBI=${this.config.weights.obi}, RSI=${this.config.weights.rsi}, Threshold=${this.config.execution.signalThreshold}`));
            if (ai.reasoning) {
                console.log(chalk.gray(`[AI] Reasoning: ${ai.reasoning.substring(0, 100)}...`));
            }

        } catch (error) {
            console.log(chalk.yellow('[AI] Failed to apply recommendations'));
        }
    }
}

// ==================== HFT EXECUTION LAYER ====================

class HFTExecutionLayer extends EventEmitter {
    private weex: RustSDKBridge;
    private config: TradingConfig;
    private isRunning: boolean = false;
    private pollInterval: NodeJS.Timeout | null = null;
    private priceHistory: number[] = [];
    private equity: number = 1000;
    private currentPosition: any = null;
    private lastTradeTime: number = 0;
    private symbol: string;
    private minBalance: number;

    constructor(weex: RustSDKBridge, config: TradingConfig, symbol: string = 'cmt_btcusdt', minBalance: number = 700) {
        super();
        this.weex = weex;
        this.config = config;
        this.symbol = symbol;
        this.minBalance = minBalance;
    }

    updateConfig(newConfig: TradingConfig): void {
        this.config = newConfig;
    }

    async start(pollIntervalMs: number = 5000): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;

        console.log(chalk.green('\n⚡ HFT EXECUTION LAYER STARTED'));
        console.log(chalk.gray(`   Poll Interval: ${pollIntervalMs}ms`));
        console.log(chalk.gray(`   Symbol: ${this.symbol}`));

        await this.updateEquity();
        await this.runTick();

        this.pollInterval = setInterval(async () => {
            if (this.isRunning) {
                await this.runTick();
            }
        }, pollIntervalMs);
    }

    stop(): void {
        this.isRunning = false;
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    private async runTick(): Promise<void> {
        const startTime = Date.now();

        try {
            // Balance protection
            if (this.equity < this.minBalance) {
                console.log(chalk.red(`🛡️ Balance ($${this.equity.toFixed(2)}) below minimum`));
                return;
            }

            // Cooldown check
            const timeSinceLastTrade = (Date.now() - this.lastTradeTime) / 1000;
            const inCooldown = timeSinceLastTrade < this.config.execution.cooldownSeconds;

            // Get market data
            const [ticker, depth, positions] = await Promise.all([
                this.weex.getTicker(this.symbol),
                this.weex.getDepth(this.symbol),
                this.weex.getPositions(),
            ]);

            const currentPrice = parseFloat(ticker.last || ticker.lastPr);
            this.priceHistory.push(currentPrice);
            if (this.priceHistory.length > 100) this.priceHistory.shift();

            // Update position
            this.updatePosition(positions);

            // Generate signals using AI-configured weights
            const signal = this.generateSignal(ticker, depth, currentPrice);

            // Apply AI bias
            const biasedSignal = signal + (this.config.biasStrength * 0.1);

            // Log status
            const execTime = Date.now() - startTime;
            const posStr = this.currentPosition
                ? `${this.currentPosition.side.toUpperCase()} ${this.currentPosition.size}`
                : 'FLAT';
            const regimeIcon = {
                'trending_up': '📈',
                'trending_down': '📉',
                'ranging': '↔️',
                'volatile': '🌊',
                'unknown': '❓'
            }[this.config.regime];

            console.log(
                chalk.gray(`[${new Date().toISOString().slice(11, 19)}]`) +
                ` $${currentPrice.toFixed(1)} ` +
                this.formatSignal(biasedSignal) +
                chalk.gray(` T:${this.config.execution.signalThreshold.toFixed(2)}`) +
                ` ${regimeIcon} ` +
                `| ${posStr}` +
                chalk.gray(` | ${execTime}ms`) +
                (inCooldown ? chalk.yellow(' [CD]') : '')
            );

            // Execute if signal strong enough and not in cooldown
            if (!inCooldown && Math.abs(biasedSignal) >= this.config.execution.signalThreshold) {
                await this.executeSignal(biasedSignal, currentPrice);
            }

            this.emit('tick', { signal: biasedSignal, price: currentPrice, position: this.currentPosition });

        } catch (error: any) {
            console.error(chalk.red(`[HFT] Tick error: ${error.message}`));
        }
    }

    private generateSignal(ticker: any, depth: any, currentPrice: number): number {
        let signal = 0;
        const w = this.config.weights;

        // OBI Signal
        try {
            const bids = (depth.bids || []).map((b: any) => ({ price: parseFloat(b[0]), quantity: parseFloat(b[1]) }));
            const asks = (depth.asks || []).map((a: any) => ({ price: parseFloat(a[0]), quantity: parseFloat(a[1]) }));
            const bidVol = bids.slice(0, 10).reduce((s: number, b: any) => s + b.quantity, 0);
            const askVol = asks.slice(0, 10).reduce((s: number, a: any) => s + a.quantity, 0);
            const obi = (bidVol - askVol) / (bidVol + askVol + 0.0001);
            signal += obi * w.obi;
        } catch { }

        // RSI Signal
        if (this.priceHistory.length >= 15) {
            const rsi = calculateRSI(this.priceHistory, 14);
            const rsiSignal = rsi < 30 ? 0.5 : rsi > 70 ? -0.5 : 0;
            signal += rsiSignal * w.rsi;
        }

        // EMA Signal
        if (this.priceHistory.length >= 20) {
            const ema20 = calculateEMA(this.priceHistory, 20);
            const emaDiff = (currentPrice - ema20) / ema20;
            signal += Math.max(-0.5, Math.min(0.5, emaDiff * 10)) * w.ema;
        }

        // Momentum Signal
        if (this.priceHistory.length >= 10) {
            const momentum = (currentPrice - this.priceHistory[this.priceHistory.length - 10]) /
                this.priceHistory[this.priceHistory.length - 10];
            signal += Math.max(-0.5, Math.min(0.5, momentum * 20)) * w.momentum;
        }

        return signal;
    }

    private async executeSignal(signal: number, currentPrice: number): Promise<void> {
        try {
            const direction = signal > 0 ? 'long' : 'short';
            let action: string;

            if (this.currentPosition) {
                // Check if we should close
                if ((this.currentPosition.side === 'long' && direction === 'short') ||
                    (this.currentPosition.side === 'short' && direction === 'long')) {
                    action = this.currentPosition.side === 'long' ? 'close_long' : 'close_short';
                } else {
                    return; // Already in same direction
                }
            } else {
                action = direction === 'long' ? 'open_long' : 'open_short';
            }

            // Calculate size
            const size = Math.min(
                this.equity * this.config.risk.riskPerTrade / 1000,
                this.config.risk.maxPositionSize
            );

            console.log(chalk.yellow(`\n⚡ ${action.toUpperCase()} ${size.toFixed(5)} @ $${currentPrice.toFixed(2)}`));

            const sideMap: Record<string, number> = {
                'open_long': 1, 'close_short': 2, 'open_short': 3, 'close_long': 4
            };

            await this.weex.placeOrder(this.symbol, sideMap[action], size);
            this.lastTradeTime = Date.now();

            console.log(chalk.green(`   ✅ Order executed`));
            await this.updateEquity();
            this.emit('trade', { action, size, price: currentPrice, signal });

        } catch (error: any) {
            console.error(chalk.red(`   ❌ Execution failed: ${error.message}`));
        }
    }

    private formatSignal(signal: number): string {
        const abs = Math.abs(signal);
        if (signal > 0.3) return chalk.green('▲▲▲');
        if (signal > 0.2) return chalk.green('▲▲');
        if (signal > 0.1) return chalk.green('▲');
        if (signal < -0.3) return chalk.red('▼▼▼');
        if (signal < -0.2) return chalk.red('▼▼');
        if (signal < -0.1) return chalk.red('▼');
        return chalk.gray('→');
    }

    private updatePosition(positions: any[]): void {
        const pos = positions.find((p: any) =>
            p.symbol?.toLowerCase().includes('btc') && parseFloat(p.total || 0) > 0
        );
        if (pos) {
            this.currentPosition = {
                side: pos.holdSide === 'long' ? 'long' : 'short',
                size: parseFloat(pos.total),
                entryPrice: parseFloat(pos.averageOpenPrice || 0),
            };
        } else {
            this.currentPosition = null;
        }
    }

    private async updateEquity(): Promise<void> {
        try {
            const assets = await this.weex.getAssets();
            const usdt = assets.find((a: any) => a.coinName === 'USDT');
            if (usdt) this.equity = parseFloat(usdt.equity || usdt.available);
        } catch { }
    }
}

// ==================== HYBRID ENGINE (Combines Both) ====================

export class HybridTradingEngine extends EventEmitter {
    private aiLayer: StrategicAILayer;
    private hftLayer: HFTExecutionLayer;
    private weex: RustSDKBridge;
    private symbol: string;

    constructor(
        openai: OpenAI,
        weex: RustSDKBridge,
        model: string = 'mimo-v2-flash',
        symbol: string = 'cmt_btcusdt',
        minBalance: number = 700
    ) {
        super();
        this.weex = weex;
        this.symbol = symbol;

        // Create both layers
        this.aiLayer = new StrategicAILayer(openai, weex, model);
        this.hftLayer = new HFTExecutionLayer(weex, this.aiLayer.getConfig(), symbol, minBalance);

        // Connect: When AI updates config, HFT layer uses it
        this.aiLayer.on('configUpdate', (config: TradingConfig) => {
            this.hftLayer.updateConfig(config);
        });

        // Forward events
        this.hftLayer.on('trade', (data) => this.emit('trade', data));
        this.hftLayer.on('tick', (data) => this.emit('tick', data));
    }

    async start(hftIntervalMs: number = 5000, aiIntervalMs: number = 60000): Promise<void> {
        console.log(chalk.cyan('\n' + '═'.repeat(60)));
        console.log(chalk.cyan('🏢 HYBRID QUANT TRADING SYSTEM'));
        console.log(chalk.cyan('   AI Strategists + HFT Algorithms'));
        console.log(chalk.cyan('═'.repeat(60)));

        // Start AI layer (runs every minute by default)
        await this.aiLayer.start(aiIntervalMs);

        // Start HFT layer (runs every 5 seconds by default)
        await this.hftLayer.start(hftIntervalMs);
    }

    stop(): void {
        this.aiLayer.stop();
        this.hftLayer.stop();
        console.log(chalk.yellow('\n🏢 Hybrid system stopped'));
    }
}

export default HybridTradingEngine;
