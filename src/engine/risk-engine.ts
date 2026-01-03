/**
 * HFT Risk Engine (Synchronous)
 * Critical safety layer that runs BEFORE any order execution.
 * 
 * "The Brakes" of the car.
 */

import chalk from 'chalk';

export interface RiskConfig {
    maxDailyLoss: number;      // Max USD loss per day (e.g. $50) -- DEPRECATED in favor of minEquity? Keep both.
    minEquity: number;         // Hard stoploss floor (e.g. 700)
    maxDrawdown: number;       // Max drawdown from peak equity (e.g. 5%)
    maxPositionSize: number;   // Max BTC size absolute (e.g. 0.05 BTC)
    maxOpenOrders: number;     // Max number of open orders (safety)
    allowedTradingTimes: {     // Optional time windows
        startHour: number;
        endHour: number;
    } | null;
}

export interface AccountState {
    equity: number;
    initialEquity: number;
    dailyPnL: number;
    peakEquity: number;
    openOrdersCount: number;
    positionSize: number;
}

export class RiskEngine {
    private config: RiskConfig;
    private state: AccountState;
    private isCircuitBreakerTripped: boolean = false;
    private tripReason: string = '';

    constructor(config: RiskConfig, initialEquity: number = 1000) {
        this.config = config;
        this.state = {
            equity: initialEquity,
            initialEquity: initialEquity,
            dailyPnL: 0,
            peakEquity: initialEquity,
            openOrdersCount: 0,
            positionSize: 0,
        };
    }

    updateState(newState: Partial<AccountState>): void {
        this.state = { ...this.state, ...newState };

        // Track peak equity for drawdown calc
        if (this.state.equity > this.state.peakEquity) {
            this.state.peakEquity = this.state.equity;
        }

        // Calculate PnL
        this.state.dailyPnL = this.state.equity - this.state.initialEquity;
    }

    /**
     * Synchronous check - returns TRUE if trade is allowed, FALSE if blocked
     */
    canTrade(side: 'buy' | 'sell', size: number, price: number): boolean {
        // 1. Circuit Breaker
        if (this.isCircuitBreakerTripped) {
            console.log(chalk.red(`⛔ RISK REJECT: Circuit breaker active (${this.tripReason})`));
            return false;
        }

        // 2. Max Position Size
        const newSize = side === 'buy' ? this.state.positionSize + size : this.state.positionSize - size;
        if (Math.abs(newSize) > this.config.maxPositionSize) {
            console.log(chalk.red(`⛔ RISK REJECT: Max position size exceeded (${Math.abs(newSize).toFixed(4)} > ${this.config.maxPositionSize})`));
            return false;
        }

        // 3. Daily Loss Limit
        if (this.state.dailyPnL < -this.config.maxDailyLoss) {
            this.tripCircuitBreaker('Daily Loss Limit Hit');
            return false;
        }

        // 3.5 Hard Equity Floor (Stoploss)
        if (this.state.equity < this.config.minEquity) {
            this.tripCircuitBreaker(`Hard Stoploss Limit ($${this.config.minEquity})`);
            return false;
        }

        // 4. Max Drawdown
        const drawdown = (this.state.peakEquity - this.state.equity) / this.state.peakEquity;
        if (drawdown > this.config.maxDrawdown) {
            this.tripCircuitBreaker(`Max Drawdown Hit (${(drawdown * 100).toFixed(1)}%)`);
            return false;
        }

        return true;
    }

    private tripCircuitBreaker(reason: string): void {
        this.isCircuitBreakerTripped = true;
        this.tripReason = reason;
        console.log(chalk.bgRed.white(`\n🚨 CIRCUIT BREAKER TRIPPED: ${reason} 🚨`));
        console.log(chalk.red('   All trading halted until manual reset.'));
    }

    reset(): void {
        this.isCircuitBreakerTripped = false;
        this.tripReason = '';
        console.log(chalk.green('✅ Risk engine reset'));
    }

    getStatus() {
        return {
            tripped: this.isCircuitBreakerTripped,
            reason: this.tripReason,
            equity: this.state.equity,
            pnl: this.state.dailyPnL,
            drawdown: ((this.state.peakEquity - this.state.equity) / this.state.peakEquity) * 100
        };
    }
}
