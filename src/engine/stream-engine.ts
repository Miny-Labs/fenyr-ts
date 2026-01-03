/**
 * Stream Trading Engine
 * High-frequency async trading with parallel signal generation
 * 
 * Architecture:
 * - Real-time data streaming
 * - Parallel quant signals (no waiting)
 * - Sub-second decision making
 * - Immediate execution
 */

import { RustSDKBridge } from '../sdk/rust-bridge.js';
import { QuantTools, calculateOBI, calculateVPIN, calculateRSI, calculateEMA, calculateATR, calculateKellyFraction, analyzeFundingArbitrage } from '../quant/indicators.js';
import { EventEmitter } from 'events';
import chalk from 'chalk';

// Signal types
interface QuantSignal {
    name: string;
    direction: 'long' | 'short' | 'neutral';
    strength: number; // -1 to 1
    confidence: number; // 0 to 1
    timestamp: number;
}

interface CombinedSignal {
    direction: 'long' | 'short' | 'neutral';
    strength: number;
    confidence: number;
    signals: QuantSignal[];
    action: 'open_long' | 'open_short' | 'close_long' | 'close_short' | 'hold';
}

interface Position {
    symbol: string;
    side: 'long' | 'short';
    size: number;
    entryPrice: number;
    unrealizedPnl: number;
}

interface EngineConfig {
    symbol: string;
    maxPositionSize: number;
    minConfidence: number;
    riskPerTrade: number; // Percentage of equity
    minBalance: number;
    pollingIntervalMs: number; // How fast to check market
    signalThreshold: number; // Minimum combined strength to act
}

const DEFAULT_CONFIG: EngineConfig = {
    symbol: 'cmt_btcusdt',
    maxPositionSize: 0.01, // 0.01 BTC
    minConfidence: 0.6,
    riskPerTrade: 0.02, // 2% risk per trade
    minBalance: 700,
    pollingIntervalMs: 5000, // 5 seconds
    signalThreshold: 0.3,
};

// Signal weights for combination
const SIGNAL_WEIGHTS = {
    obi: 0.25,        // Order Book Imbalance
    vpin: 0.15,       // Toxic flow filter
    technical: 0.25,  // RSI/EMA signals
    funding: 0.20,    // Funding rate arb
    momentum: 0.15,   // Price momentum
};

export class StreamTradingEngine extends EventEmitter {
    private weex: RustSDKBridge;
    private config: EngineConfig;
    private isRunning: boolean = false;
    private currentPosition: Position | null = null;
    private lastSignal: CombinedSignal | null = null;
    private equity: number = 1000;
    private tradeHistory: { pnl: number; isWin: boolean }[] = [];
    private priceHistory: number[] = [];
    private pollInterval: NodeJS.Timeout | null = null;

    constructor(weex: RustSDKBridge, config: Partial<EngineConfig> = {}) {
        super();
        this.weex = weex;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    async start(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;

        console.log(chalk.cyan('\n🚀 STREAM TRADING ENGINE STARTED'));
        console.log(chalk.gray(`   Symbol: ${this.config.symbol}`));
        console.log(chalk.gray(`   Poll Interval: ${this.config.pollingIntervalMs}ms`));
        console.log(chalk.gray(`   Signal Threshold: ${this.config.signalThreshold}`));
        console.log(chalk.gray(`   Risk Per Trade: ${this.config.riskPerTrade * 100}%`));

        // Start polling loop
        await this.updateEquity();
        await this.runCycle(); // First run immediately

        this.pollInterval = setInterval(async () => {
            if (this.isRunning) {
                await this.runCycle();
            }
        }, this.config.pollingIntervalMs);
    }

    stop(): void {
        this.isRunning = false;
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        console.log(chalk.yellow('\n⏹️ ENGINE STOPPED'));
    }

    private async runCycle(): Promise<void> {
        try {
            const startTime = Date.now();

            // Balance protection
            if (this.equity < this.config.minBalance) {
                console.log(chalk.red(`🛡️ Balance ($${this.equity.toFixed(2)}) below minimum, holding`));
                return;
            }

            // Get market data (parallel)
            const [ticker, depth, positions] = await Promise.all([
                this.weex.getTicker(this.config.symbol),
                this.weex.getDepth(this.config.symbol),
                this.weex.getPositions(),
            ]);

            const currentPrice = parseFloat(ticker.last || ticker.lastPr);
            this.priceHistory.push(currentPrice);
            if (this.priceHistory.length > 100) this.priceHistory.shift();

            // Update position state
            this.updatePositionFromAPI(positions);

            // Generate all signals in PARALLEL
            const signals = await this.generateSignalsParallel(ticker, depth, currentPrice);

            // Combine signals
            const combined = this.combineSignals(signals);
            this.lastSignal = combined;

            // Calculate execution time
            const execTime = Date.now() - startTime;

            // Log compact status
            const posStr = this.currentPosition
                ? `${this.currentPosition.side.toUpperCase()} ${this.currentPosition.size}`
                : 'FLAT';

            console.log(
                chalk.gray(`[${new Date().toISOString().slice(11, 19)}]`) +
                ` $${currentPrice.toFixed(1)} ` +
                this.formatSignalArrow(combined) +
                chalk.gray(` (${(combined.confidence * 100).toFixed(0)}%)`) +
                ` | Pos: ${posStr}` +
                chalk.gray(` | ${execTime}ms`)
            );

            // Execute if signal is strong enough
            if (Math.abs(combined.strength) >= this.config.signalThreshold &&
                combined.confidence >= this.config.minConfidence) {
                await this.executeSignal(combined, currentPrice);
            }

            this.emit('cycle', { combined, price: currentPrice, execTime });

        } catch (error: any) {
            console.error(chalk.red(`Cycle error: ${error.message}`));
        }
    }

    private async generateSignalsParallel(ticker: any, depth: any, currentPrice: number): Promise<QuantSignal[]> {
        const signals: QuantSignal[] = [];
        const now = Date.now();

        // 1. OBI Signal - Order Book Imbalance
        try {
            const bids = (depth.bids || []).map((b: any) => ({
                price: parseFloat(b[0]),
                quantity: parseFloat(b[1])
            }));
            const asks = (depth.asks || []).map((a: any) => ({
                price: parseFloat(a[0]),
                quantity: parseFloat(a[1])
            }));

            const obi = calculateOBI({ bids, asks, timestamp: now }, 10);
            signals.push({
                name: 'OBI',
                direction: obi > 0.15 ? 'long' : obi < -0.15 ? 'short' : 'neutral',
                strength: obi,
                confidence: Math.min(1, Math.abs(obi) * 2),
                timestamp: now,
            });
        } catch {
            signals.push({ name: 'OBI', direction: 'neutral', strength: 0, confidence: 0, timestamp: now });
        }

        // 2. Technical Signals (RSI, EMA crossover)
        if (this.priceHistory.length >= 20) {
            const rsi = calculateRSI(this.priceHistory, 14);
            const ema20 = calculateEMA(this.priceHistory, 20);
            const ema50 = this.priceHistory.length >= 50 ? calculateEMA(this.priceHistory, 50) : ema20;

            // RSI signal
            let rsiDirection: 'long' | 'short' | 'neutral' = 'neutral';
            let rsiStrength = 0;
            if (rsi < 30) {
                rsiDirection = 'long';
                rsiStrength = (30 - rsi) / 30;
            } else if (rsi > 70) {
                rsiDirection = 'short';
                rsiStrength = (rsi - 70) / 30;
            }

            // EMA crossover
            const emaCross = (currentPrice - ema20) / ema20;
            const trend = ema20 > ema50 ? 'bullish' : 'bearish';

            signals.push({
                name: 'RSI',
                direction: rsiDirection,
                strength: rsiDirection === 'short' ? -rsiStrength : rsiStrength,
                confidence: Math.min(1, Math.abs(rsi - 50) / 30),
                timestamp: now,
            });

            signals.push({
                name: 'EMA',
                direction: trend === 'bullish' ? 'long' : 'short',
                strength: emaCross,
                confidence: Math.min(1, Math.abs(emaCross) * 10),
                timestamp: now,
            });
        }

        // 3. Momentum signal
        if (this.priceHistory.length >= 10) {
            const priceChange = (currentPrice - this.priceHistory[this.priceHistory.length - 10]) /
                this.priceHistory[this.priceHistory.length - 10];
            signals.push({
                name: 'Momentum',
                direction: priceChange > 0.001 ? 'long' : priceChange < -0.001 ? 'short' : 'neutral',
                strength: priceChange,
                confidence: Math.min(1, Math.abs(priceChange) * 50),
                timestamp: now,
            });
        }

        // 4. Spread/Liquidity signal
        const bestBid = parseFloat(depth.bids?.[0]?.[0] || ticker.bid || currentPrice);
        const bestAsk = parseFloat(depth.asks?.[0]?.[0] || ticker.ask || currentPrice);
        const spreadPercent = (bestAsk - bestBid) / currentPrice;

        // High spread = don't trade
        const liquidityOk = spreadPercent < 0.001; // 0.1% threshold
        if (!liquidityOk) {
            signals.push({
                name: 'Liquidity',
                direction: 'neutral',
                strength: 0,
                confidence: 0.5,
                timestamp: now,
            });
        }

        return signals;
    }

    private combineSignals(signals: QuantSignal[]): CombinedSignal {
        if (signals.length === 0) {
            return {
                direction: 'neutral',
                strength: 0,
                confidence: 0,
                signals: [],
                action: 'hold',
            };
        }

        // Weighted combination
        let totalWeight = 0;
        let weightedStrength = 0;
        let weightedConfidence = 0;

        for (const signal of signals) {
            const weight = SIGNAL_WEIGHTS[signal.name.toLowerCase() as keyof typeof SIGNAL_WEIGHTS] || 0.1;
            totalWeight += weight;
            weightedStrength += signal.strength * weight;
            weightedConfidence += signal.confidence * weight;
        }

        const strength = weightedStrength / totalWeight;
        const confidence = weightedConfidence / totalWeight;

        // Determine direction
        let direction: 'long' | 'short' | 'neutral' = 'neutral';
        if (strength > 0.1) direction = 'long';
        else if (strength < -0.1) direction = 'short';

        // Determine action based on current position
        let action: CombinedSignal['action'] = 'hold';

        if (this.currentPosition) {
            // We have a position
            if (this.currentPosition.side === 'long' && direction === 'short') {
                action = 'close_long';
            } else if (this.currentPosition.side === 'short' && direction === 'long') {
                action = 'close_short';
            }
        } else {
            // No position
            if (direction === 'long') action = 'open_long';
            else if (direction === 'short') action = 'open_short';
        }

        return { direction, strength, confidence, signals, action };
    }

    private async executeSignal(signal: CombinedSignal, currentPrice: number): Promise<void> {
        if (signal.action === 'hold') return;

        try {
            // Calculate Kelly-based position size
            const kellyFraction = calculateKellyFraction(this.tradeHistory, 0.25); // Quarter-Kelly
            const riskAmount = this.equity * Math.min(kellyFraction, this.config.riskPerTrade);
            const atr = this.priceHistory.length >= 15 ? this.calculateSimpleATR() : currentPrice * 0.02;
            let size = Math.min(riskAmount / atr, this.config.maxPositionSize);
            size = Math.round(size * 100000) / 100000; // 5 decimals

            if (size < 0.0001) {
                console.log(chalk.gray('   Size too small, skipping'));
                return;
            }

            console.log(chalk.yellow(`\n⚡ EXECUTING: ${signal.action.toUpperCase()} ${size} @ $${currentPrice.toFixed(2)}`));
            console.log(chalk.gray(`   Strength: ${(signal.strength * 100).toFixed(1)}% | Confidence: ${(signal.confidence * 100).toFixed(1)}%`));

            // Map action to side number
            const sideMap: Record<string, number> = {
                'open_long': 1,
                'close_short': 2,
                'open_short': 3,
                'close_long': 4,
            };
            const side = sideMap[signal.action];

            const result = await this.weex.placeOrder(this.config.symbol, side, size);

            console.log(chalk.green(`   ✅ Order placed: ${result.orderId || 'success'}`));

            // Update position tracking
            if (signal.action.startsWith('open_')) {
                this.currentPosition = {
                    symbol: this.config.symbol,
                    side: signal.action === 'open_long' ? 'long' : 'short',
                    size,
                    entryPrice: currentPrice,
                    unrealizedPnl: 0,
                };
            } else {
                // Closing position - record P&L
                if (this.currentPosition) {
                    const pnl = this.currentPosition.side === 'long'
                        ? (currentPrice - this.currentPosition.entryPrice) * this.currentPosition.size
                        : (this.currentPosition.entryPrice - currentPrice) * this.currentPosition.size;

                    this.tradeHistory.push({ pnl, isWin: pnl > 0 });
                    console.log(chalk.cyan(`   P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`));
                }
                this.currentPosition = null;
            }

            // Refresh equity
            await this.updateEquity();
            this.emit('trade', { signal, size, price: currentPrice });

        } catch (error: any) {
            console.error(chalk.red(`   ❌ Execution failed: ${error.message}`));
        }
    }

    private calculateSimpleATR(): number {
        if (this.priceHistory.length < 15) return 0;

        let sum = 0;
        for (let i = 1; i < 15; i++) {
            const idx = this.priceHistory.length - 15 + i;
            sum += Math.abs(this.priceHistory[idx] - this.priceHistory[idx - 1]);
        }
        return sum / 14;
    }

    private updatePositionFromAPI(positions: any[]): void {
        const pos = positions.find((p: any) =>
            p.symbol?.toLowerCase().includes('btc') && parseFloat(p.total || p.size || 0) > 0
        );

        if (pos) {
            this.currentPosition = {
                symbol: pos.symbol,
                side: pos.holdSide === 'long' ? 'long' : 'short',
                size: parseFloat(pos.total || pos.size),
                entryPrice: parseFloat(pos.averageOpenPrice || pos.entryPrice || 0),
                unrealizedPnl: parseFloat(pos.unrealizedPL || pos.pnl || 0),
            };
        } else if (this.currentPosition) {
            // Position was closed externally
            this.currentPosition = null;
        }
    }

    private async updateEquity(): Promise<void> {
        try {
            const assets = await this.weex.getAssets();
            const usdt = assets.find((a: any) => a.coinName === 'USDT');
            if (usdt) {
                this.equity = parseFloat(usdt.equity || usdt.available);
            }
        } catch { }
    }

    private formatSignalArrow(signal: CombinedSignal): string {
        const strength = Math.abs(signal.strength);
        if (signal.direction === 'long') {
            if (strength > 0.5) return chalk.green('▲▲▲');
            if (strength > 0.3) return chalk.green('▲▲');
            if (strength > 0.1) return chalk.green('▲');
            return chalk.gray('→');
        } else if (signal.direction === 'short') {
            if (strength > 0.5) return chalk.red('▼▼▼');
            if (strength > 0.3) return chalk.red('▼▼');
            if (strength > 0.1) return chalk.red('▼');
            return chalk.gray('→');
        }
        return chalk.gray('→');
    }

    // Public methods for status
    getStatus() {
        return {
            running: this.isRunning,
            equity: this.equity,
            position: this.currentPosition,
            lastSignal: this.lastSignal,
            tradeCount: this.tradeHistory.length,
            winRate: this.tradeHistory.length > 0
                ? this.tradeHistory.filter(t => t.isWin).length / this.tradeHistory.length
                : 0,
        };
    }
}

export default StreamTradingEngine;
