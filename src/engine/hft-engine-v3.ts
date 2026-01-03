/**
 * HFT Engine v3.0 (The "Director's Cut")
 * 
 * Architecture:
 * - Event-Driven: Triggered by WebSocket ticks (0ms latency/polling)
 * - Single Source of Truth: MarketDataService (Shared Memory)
 * - Safety First: Synchronous RiskEngine pre-checks
 * - Resilience: Dead Man's Switch (Confidence Decay)
 * 
 * "Process Fork Bomb" fixed: Only spawns process for Execution, not Data.
 */

import { EventEmitter } from 'events';
import OpenAI from 'openai';
import chalk from 'chalk';
import { RustSDKBridge } from '../sdk/rust-bridge.js';
import { ParallelAgentSystem } from './parallel-agents.js';
import { MarketDataService } from '../services/market-data.js';
import { RiskEngine } from './risk-engine.js';
import { calculateRSI } from '../quant/indicators.js';

export class HFTEngineV3 extends EventEmitter {
    // Components
    private ws: MarketDataService;
    private risk: RiskEngine;
    private agents: ParallelAgentSystem;
    private weex: RustSDKBridge;

    // State
    private isRunning: boolean = false;
    private symbol: string;
    private priceHistory: number[] = [];
    private currentPosition: { side: 'long' | 'short', size: number } | null = null;
    private lastExecutionTime: number = 0;

    // Config
    private minConf = 0.6;
    private decaySeconds = 60; // Dead Man's Switch timeout

    constructor(
        openai: OpenAI,
        weex: RustSDKBridge,
        symbol: string = 'cmt_btcusdt',
        initialEquity: number = 1000
    ) {
        super();
        this.symbol = symbol;
        this.weex = weex;

        // 1. Initialize Components
        this.ws = new MarketDataService(symbol);
        this.risk = new RiskEngine({
            maxDailyLoss: 50,
            maxDrawdown: 0.05,
            maxPositionSize: 0.05,
            maxOpenOrders: 3,
            allowedTradingTimes: null
        }, initialEquity);
        this.agents = new ParallelAgentSystem(openai, weex);
    }

    async start(): Promise<void> {
        console.log(chalk.cyan('\n' + '═'.repeat(70)));
        console.log(chalk.cyan('🚀 FENYR HFT v3.0 (DIRECTOR\'S CUT)'));
        console.log(chalk.cyan('   Event-Driven • WS Data • Sync Risk • Dead-Man Switch'));
        console.log(chalk.cyan('═'.repeat(70)));

        this.isRunning = true;

        // Start subsystems
        console.log(chalk.gray('   [Init] Starting WebSocket Service...'));
        this.ws.start();

        console.log(chalk.gray('   [Init] Starting AI Strategy Layer...'));
        await this.agents.start();

        // Bind Events (The Heartbeat)
        this.ws.on('tick', (price: number) => this.onTick(price));
        this.ws.on('connected', () => console.log(chalk.green('   [Link] Market Data Stream Active 🟢')));

        // Initial Position Check (Persistence/Recovery)
        await this.syncPosition();
    }

    stop(): void {
        this.isRunning = false;
        this.ws.stop();
        this.agents.stop();
        console.log(chalk.yellow('\n🛑 HFT Engine halted.'));
    }

    /**
     * THE HOT PATH - Called on every price tick (potentially 10-20 times/sec)
     * Must be extremely fast. No API calls allowed here except execution.
     */
    private async onTick(price: number): Promise<void> {
        if (!this.isRunning) return;

        // 1. Update Local History (Memory)
        this.priceHistory.push(price);
        if (this.priceHistory.length > 100) this.priceHistory.shift();

        // 2. Get Strategic Guidance (Async -> Sync Read)
        const decision = this.agents.getLastDecision();
        const config = this.agents.getConfig();

        // 3. Dead Man's Switch (Confidence Decay)
        let effectiveConfidence = 0;
        let action = 'hold';

        if (decision) {
            const ageSeconds = (Date.now() - decision.timestamp) / 1000;
            if (ageSeconds > this.decaySeconds) {
                // Confidence decays to 0 over 2x decay window
                console.log(chalk.red(`   ⚠️ STALE DECISION (${ageSeconds.toFixed(1)}s old) - Ignoring`));
                effectiveConfidence = 0;
            } else {
                effectiveConfidence = decision.confidence;
                action = decision.action;
            }
        }

        // 4. Calculate Alpha (Local HFT Logic) - Combined with AI
        // We re-calculate RSI locally locally for 0ms latency confirmation
        const localRSI = this.priceHistory.length > 14 ? calculateRSI(this.priceHistory, 14) : 50;

        // HFT Logic: Confirm AI with local math
        let hftConfirm = false;
        if (action === 'long' && localRSI < 70) hftConfirm = true;
        if (action === 'short' && localRSI > 30) hftConfirm = true;
        // Close signals are always honored
        if (action === 'close') hftConfirm = true;

        // 5. Execution Logic
        if (effectiveConfidence > this.minConf && hftConfirm) {

            // Cooldown check (simple)
            if (Date.now() - this.lastExecutionTime < 5000) return; // 5s cooldown

            if (action === 'long' && (!this.currentPosition || this.currentPosition.side === 'short')) {
                await this.executeOrder('buy', config.riskPerTrade * 10000, price, 'AI_LONG'); // Scaled size
            } else if (action === 'short' && (!this.currentPosition || this.currentPosition.side === 'long')) {
                await this.executeOrder('sell', config.riskPerTrade * 10000, price, 'AI_SHORT');
            } else if (action === 'close' && this.currentPosition) {
                const side = this.currentPosition.side === 'long' ? 'sell' : 'buy';
                await this.executeOrder(side, this.currentPosition.size, price, 'AI_CLOSE');
            }
        }

        // Log Heartbeat (Throttle logging)
        if (Math.random() < 0.05) { // Log ~5% of ticks to avoid spam
            this.printStatus(price, action, effectiveConfidence, localRSI);
        }
    }

    private async executeOrder(side: 'buy' | 'sell', size: number, price: number, reason: string): Promise<void> {
        // 6. RISK GATE (Synchronous) - The Final Check
        if (!this.risk.canTrade(side, size, price)) {
            return; // Rejected by Risk Engine
        }

        console.log(chalk.yellow(`\n⚡ EXECUTE ${side.toUpperCase()} ${size} @ $${price} (${reason})`));

        try {
            // Execution (Process Spawn - The only necessary evil)
            // Map side to 1/2/3/4 for our CLI
            // 1=open_long, 2=close_short (buy)
            // 3=open_short, 4=close_long (sell)

            let weexSide = 0;
            if (side === 'buy') {
                weexSide = this.currentPosition?.side === 'short' ? 2 : 1;
            } else {
                weexSide = this.currentPosition?.side === 'long' ? 4 : 3;
            }

            await this.weex.placeOrder(this.symbol, weexSide, size);

            this.lastExecutionTime = Date.now();
            console.log(chalk.green(`   ✅ Filled ${size} ${this.symbol}`));

            // Update State Optimistically (Reconcile later)
            if (weexSide === 1) this.currentPosition = { side: 'long', size };
            if (weexSide === 3) this.currentPosition = { side: 'short', size };
            if (weexSide === 2 || weexSide === 4) this.currentPosition = null;

            // Update Risk Engine State
            this.risk.updateState({ positionSize: this.currentPosition ? this.currentPosition.size : 0 });

        } catch (e: any) {
            console.log(chalk.red(`   ❌ Order Failed: ${e.message}`));
        }
    }

    private async syncPosition(): Promise<void> {
        try {
            const positions = await this.weex.getPositions();
            const pos = positions.find((p: any) => p.symbol?.toLowerCase().includes('btc') && parseFloat(p.total) > 0);
            if (pos) {
                this.currentPosition = {
                    side: pos.holdSide === 'long' ? 'long' : 'short',
                    size: parseFloat(pos.total)
                };
                this.risk.updateState({ positionSize: this.currentPosition.size });
                console.log(chalk.blue(`   [Sync] Recovered Position: ${this.currentPosition.side.toUpperCase()} ${this.currentPosition.size}`));
            }
        } catch (e) { }
    }

    private printStatus(price: number, action: string, conf: number, rsi: number) {
        const actionCol = action === 'long' ? chalk.green : action === 'short' ? chalk.red : chalk.gray;
        const posStr = this.currentPosition ? `${this.currentPosition.side.toUpperCase()} ${this.currentPosition.size}` : 'FLAT';
        console.log(
            chalk.gray(`[Tick]`) +
            ` $${price.toFixed(1)} ` +
            chalk.gray(`| RSI:${rsi.toFixed(1)} |`) +
            ` AI:${actionCol(action.toUpperCase())}(${(conf * 100).toFixed(0)}%) ` +
            `| Pos:${posStr}`
        );
    }

    getStatus() {
        return {
            price: this.ws.state.lastPrice,
            position: this.currentPosition,
            risk: this.risk.getStatus(),
            aiAction: this.agents.getLastDecision()?.action
        };
    }
}
