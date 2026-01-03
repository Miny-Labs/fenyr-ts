/**
 * Full Parallel Trading Engine
 * Combines:
 * - Parallel AI Agents (4 agents every 15s, lead every 30s)
 * - HFT Execution (every 5s)
 * 
 * Architecture like a real quant firm:
 * - AI agents = employees analyzing independently
 * - Lead coordinator = portfolio manager making decisions
 * - HFT engine = execution algorithms
 */

import { EventEmitter } from 'events';
import OpenAI from 'openai';
import chalk from 'chalk';
import { RustSDKBridge } from '../sdk/rust-bridge.js';
import { ParallelAgentSystem } from './parallel-agents.js';
import { calculateOBI, calculateRSI, calculateEMA } from '../quant/indicators.js';

interface Position {
    side: 'long' | 'short';
    size: number;
    entryPrice: number;
}

export class FullParallelEngine extends EventEmitter {
    private openai: OpenAI;
    private weex: RustSDKBridge;
    private model: string;
    private symbol: string;
    private minBalance: number;

    // AI Layer
    private agentSystem: ParallelAgentSystem;

    // HFT Layer
    private isRunning: boolean = false;
    private hftInterval: NodeJS.Timeout | null = null;
    private priceHistory: number[] = [];
    private equity: number = 1000;
    private currentPosition: Position | null = null;
    private lastTradeTime: number = 0;
    private pendingAction: 'long' | 'short' | 'close' | null = null;

    constructor(
        openai: OpenAI,
        weex: RustSDKBridge,
        model: string = 'mimo-v2-flash',
        symbol: string = 'cmt_btcusdt',
        minBalance: number = 700
    ) {
        super();
        this.openai = openai;
        this.weex = weex;
        this.model = model;
        this.symbol = symbol;
        this.minBalance = minBalance;

        // Create parallel agent system
        this.agentSystem = new ParallelAgentSystem(openai, weex, model);

        // When lead makes a decision, queue it for execution
        this.agentSystem.on('decision', (decision: any) => {
            if (decision.action !== 'hold') {
                this.pendingAction = decision.action;
                console.log(chalk.yellow(`\n📋 Queued action: ${decision.action.toUpperCase()}`));
            }
        });
    }

    async start(hftIntervalMs: number = 5000): Promise<void> {
        console.log(chalk.cyan('\n' + '═'.repeat(70)));
        console.log(chalk.cyan('🏛️ FULL PARALLEL TRADING ENGINE'));
        console.log(chalk.cyan('   4 AI Agents (15s) → Lead Coordinator (30s) → HFT Execution (5s)'));
        console.log(chalk.cyan('   MiMo v2 Flash: 100 RPM • Unlimited TPM • JSON Output'));
        console.log(chalk.cyan('═'.repeat(70)));

        this.isRunning = true;

        // Update equity
        await this.updateEquity();

        // Start parallel AI agents
        await this.agentSystem.start();

        // Start HFT execution loop
        console.log(chalk.green('\n⚡ HFT EXECUTION LAYER STARTED'));
        console.log(chalk.gray(`   Poll Interval: ${hftIntervalMs}ms`));

        await this.hftTick();
        this.hftInterval = setInterval(async () => {
            if (this.isRunning) {
                await this.hftTick();
            }
        }, hftIntervalMs);
    }

    stop(): void {
        this.isRunning = false;
        this.agentSystem.stop();
        if (this.hftInterval) {
            clearInterval(this.hftInterval);
            this.hftInterval = null;
        }
        console.log(chalk.yellow('\n🏛️ Engine stopped'));
    }

    private async hftTick(): Promise<void> {
        try {
            const startTime = Date.now();

            // Balance protection
            if (this.equity < this.minBalance) {
                console.log(chalk.red(`🛡️ Balance protection: $${this.equity.toFixed(2)} < $${this.minBalance}`));
                return;
            }

            // Get market data
            const [ticker, depth, positions] = await Promise.all([
                this.weex.getTicker(this.symbol),
                this.weex.getDepth(this.symbol),
                this.weex.getPositions(),
            ]);

            const currentPrice = parseFloat(ticker.last || ticker.lastPr);
            this.priceHistory.push(currentPrice);
            if (this.priceHistory.length > 100) this.priceHistory.shift();

            // Update position from API
            this.updatePositionFromAPI(positions);

            // Get AI config
            const config = this.agentSystem.getConfig();
            const decision = this.agentSystem.getLastDecision();

            // Generate quant signals
            const signal = this.generateSignal(depth, currentPrice, config);

            // Apply AI bias
            const biasedSignal = signal + (config.biasStrength * 0.15);

            // Determine if we should execute
            const shouldExecute = this.pendingAction !== null ||
                Math.abs(biasedSignal) >= config.signalThreshold;

            // Log status
            const execTime = Date.now() - startTime;
            const posStr = this.currentPosition
                ? `${this.currentPosition.side.toUpperCase()} ${this.currentPosition.size.toFixed(4)}`
                : 'FLAT';
            const biasIcon = config.bias === 'bullish' ? '🟢' : config.bias === 'bearish' ? '🔴' : '⚪';
            const signalArrow = biasedSignal > 0.2 ? '▲▲' : biasedSignal > 0.1 ? '▲' :
                biasedSignal < -0.2 ? '▼▼' : biasedSignal < -0.1 ? '▼' : '→';

            console.log(
                chalk.gray(`[${new Date().toISOString().slice(11, 19)}]`) +
                ` $${currentPrice.toFixed(1)} ` +
                `${biasedSignal >= 0 ? chalk.green(signalArrow) : chalk.red(signalArrow)} ` +
                chalk.gray(`(${(biasedSignal * 100).toFixed(0)}%)`) +
                ` ${biasIcon} ` +
                `| ${posStr} ` +
                chalk.gray(`| ${execTime}ms`) +
                (this.pendingAction ? chalk.yellow(` [PENDING: ${this.pendingAction}]`) : '')
            );

            // Execute if needed
            if (shouldExecute && this.pendingAction) {
                await this.execute(this.pendingAction, currentPrice, config);
                this.pendingAction = null;
            } else if (shouldExecute && !this.pendingAction) {
                // Auto-execute on strong quant signal
                const autoAction = biasedSignal > config.signalThreshold ? 'long' :
                    biasedSignal < -config.signalThreshold ? 'short' : null;
                if (autoAction) {
                    await this.execute(autoAction, currentPrice, config);
                }
            }

        } catch (error: any) {
            console.error(chalk.red(`[HFT] Error: ${error.message}`));
        }
    }

    private generateSignal(depth: any, currentPrice: number, config: any): number {
        let signal = 0;
        const w = config.weights;

        // OBI
        try {
            const bids = (depth.bids || []).map((b: any) => ({ price: parseFloat(b[0]), quantity: parseFloat(b[1]) }));
            const asks = (depth.asks || []).map((a: any) => ({ price: parseFloat(a[0]), quantity: parseFloat(a[1]) }));
            const bidVol = bids.slice(0, 10).reduce((s: number, b: any) => s + b.quantity, 0);
            const askVol = asks.slice(0, 10).reduce((s: number, a: any) => s + a.quantity, 0);
            const obi = (bidVol - askVol) / (bidVol + askVol + 0.0001);
            signal += obi * (w.obi || 0.25);
        } catch { }

        // RSI
        if (this.priceHistory.length >= 15) {
            const rsi = calculateRSI(this.priceHistory, 14);
            const rsiSignal = rsi < 30 ? 0.5 : rsi > 70 ? -0.5 : 0;
            signal += rsiSignal * (w.rsi || 0.25);
        }

        // EMA
        if (this.priceHistory.length >= 20) {
            const ema20 = calculateEMA(this.priceHistory, 20);
            const emaDiff = (currentPrice - ema20) / ema20;
            signal += Math.max(-0.5, Math.min(0.5, emaDiff * 10)) * (w.ema || 0.25);
        }

        // Momentum
        if (this.priceHistory.length >= 10) {
            const mom = (currentPrice - this.priceHistory[this.priceHistory.length - 10]) /
                this.priceHistory[this.priceHistory.length - 10];
            signal += Math.max(-0.5, Math.min(0.5, mom * 20)) * (w.momentum || 0.25);
        }

        return signal;
    }

    private async execute(action: 'long' | 'short' | 'close', currentPrice: number, config: any): Promise<void> {
        try {
            let sideNum: number;
            let size: number;

            if (action === 'close' && this.currentPosition) {
                sideNum = this.currentPosition.side === 'long' ? 4 : 2; // close_long or close_short
                size = this.currentPosition.size;
            } else if (action === 'long') {
                if (this.currentPosition?.side === 'short') {
                    // Close short first
                    await this.weex.placeOrder(this.symbol, 2, this.currentPosition.size);
                    console.log(chalk.green(`   ✅ Closed short position`));
                }
                sideNum = 1; // open_long
                size = Math.min(this.equity * config.riskPerTrade / 1000, 0.01);
            } else if (action === 'short') {
                if (this.currentPosition?.side === 'long') {
                    // Close long first
                    await this.weex.placeOrder(this.symbol, 4, this.currentPosition.size);
                    console.log(chalk.green(`   ✅ Closed long position`));
                }
                sideNum = 3; // open_short
                size = Math.min(this.equity * config.riskPerTrade / 1000, 0.01);
            } else {
                return;
            }

            size = Math.round(size * 100000) / 100000;
            if (size < 0.0001) return;

            const actionName = ['', 'OPEN_LONG', 'CLOSE_SHORT', 'OPEN_SHORT', 'CLOSE_LONG'][sideNum];
            console.log(chalk.yellow(`\n⚡ EXECUTE: ${actionName} ${size} @ $${currentPrice.toFixed(2)}`));

            await this.weex.placeOrder(this.symbol, sideNum, size);
            this.lastTradeTime = Date.now();

            console.log(chalk.green(`   ✅ Order executed`));
            await this.updateEquity();

        } catch (error: any) {
            console.error(chalk.red(`   ❌ Execution failed: ${error.message}`));
        }
    }

    private updatePositionFromAPI(positions: any[]): void {
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

    getStatus() {
        return {
            running: this.isRunning,
            equity: this.equity,
            position: this.currentPosition,
            lastDecision: this.agentSystem.getLastDecision(),
            config: this.agentSystem.getConfig(),
        };
    }
}

export default FullParallelEngine;
