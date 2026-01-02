/**
 * Quantitative Analysis Module
 * Advanced indicators: OBI, VPIN, ATR, Bollinger, OBV, Kelly Criterion
 */

// ==================== ORDER BOOK IMBALANCE (OBI) ====================
// Provides 56-58% predictive accuracy for short-term direction

export interface OrderBookLevel {
    price: number;
    quantity: number;
}

export interface OrderBook {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
    timestamp: number;
}

/**
 * Calculate Order Book Imbalance
 * OBI = (Σ bid_qty - Σ ask_qty) / (Σ bid_qty + Σ ask_qty)
 * @returns value between -1 (ask heavy) to +1 (bid heavy)
 */
export function calculateOBI(orderBook: OrderBook, levels: number = 10): number {
    const bidQty = orderBook.bids.slice(0, levels).reduce((sum, b) => sum + b.quantity, 0);
    const askQty = orderBook.asks.slice(0, levels).reduce((sum, a) => sum + a.quantity, 0);

    if (bidQty + askQty === 0) return 0;
    return (bidQty - askQty) / (bidQty + askQty);
}

/**
 * Get OBI signal
 * @returns 'bullish' | 'bearish' | 'neutral'
 */
export function getOBISignal(obi: number): 'bullish' | 'bearish' | 'neutral' {
    if (obi > 0.15) return 'bullish';
    if (obi < -0.15) return 'bearish';
    return 'neutral';
}

// ==================== VPIN (Volume-Synchronized Probability of Informed Trading) ====================
// Detects toxic order flow and predicts volatility spikes
// VPIN > 0.7 indicates impending volatility

export interface Trade {
    price: number;
    volume: number;
    side: 'buy' | 'sell';
    timestamp: number;
}

/**
 * Calculate VPIN using bulk volume classification
 * @param trades Recent trades
 * @param bucketSize Volume per bucket
 * @param numBuckets Number of buckets to analyze
 */
export function calculateVPIN(trades: Trade[], bucketSize: number = 1000, numBuckets: number = 50): number {
    if (trades.length < 10) return 0.5;

    // Group trades into volume buckets
    const buckets: { buyVol: number; sellVol: number }[] = [];
    let currentBucket = { buyVol: 0, sellVol: 0 };
    let currentVolume = 0;

    for (const trade of trades) {
        if (trade.side === 'buy') {
            currentBucket.buyVol += trade.volume;
        } else {
            currentBucket.sellVol += trade.volume;
        }
        currentVolume += trade.volume;

        if (currentVolume >= bucketSize) {
            buckets.push(currentBucket);
            currentBucket = { buyVol: 0, sellVol: 0 };
            currentVolume = 0;
            if (buckets.length >= numBuckets) break;
        }
    }

    if (buckets.length === 0) return 0.5;

    // Calculate VPIN = Σ|V_buy - V_sell| / (n × V_bucket)
    const totalImbalance = buckets.reduce((sum, b) => sum + Math.abs(b.buyVol - b.sellVol), 0);
    const totalVolume = buckets.length * bucketSize;

    return Math.min(1, totalImbalance / totalVolume);
}

/**
 * Get VPIN volatility signal
 */
export function getVPINSignal(vpin: number): 'high_volatility' | 'normal' | 'low_volatility' {
    if (vpin > 0.7) return 'high_volatility';
    if (vpin < 0.3) return 'low_volatility';
    return 'normal';
}

// ==================== TECHNICAL INDICATORS ====================

/**
 * Calculate RSI (Relative Strength Index)
 */
export function calculateRSI(prices: number[], period: number = 14): number {
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

/**
 * Calculate EMA (Exponential Moving Average)
 */
export function calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1] || 0;

    const multiplier = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
        ema = (prices[i] - ema) * multiplier + ema;
    }
    return Math.round(ema * 100) / 100;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 */
export function calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    const macd = ema12 - ema26;

    // Signal line is 9-period EMA of MACD (simplified)
    const signal = macd * 0.8; // Approximation
    const histogram = macd - signal;

    return {
        macd: Math.round(macd * 100) / 100,
        signal: Math.round(signal * 100) / 100,
        histogram: Math.round(histogram * 100) / 100,
    };
}

/**
 * Calculate ATR (Average True Range) - for position sizing
 */
export function calculateATR(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 14
): number {
    if (highs.length < period + 1) return 0;

    const trueRanges: number[] = [];
    for (let i = 1; i < highs.length; i++) {
        const tr = Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i - 1]),
            Math.abs(lows[i] - closes[i - 1])
        );
        trueRanges.push(tr);
    }

    const atr = trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
    return Math.round(atr * 100) / 100;
}

/**
 * Calculate Bollinger Bands
 */
export function calculateBollingerBands(
    prices: number[],
    period: number = 20,
    stdDev: number = 2
): { upper: number; middle: number; lower: number; bandwidth: number } {
    if (prices.length < period) {
        const last = prices[prices.length - 1] || 0;
        return { upper: last, middle: last, lower: last, bandwidth: 0 };
    }

    const slice = prices.slice(-period);
    const middle = slice.reduce((a, b) => a + b, 0) / period;

    const variance = slice.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period;
    const std = Math.sqrt(variance);

    const upper = middle + stdDev * std;
    const lower = middle - stdDev * std;
    const bandwidth = (upper - lower) / middle;

    return {
        upper: Math.round(upper * 100) / 100,
        middle: Math.round(middle * 100) / 100,
        lower: Math.round(lower * 100) / 100,
        bandwidth: Math.round(bandwidth * 10000) / 10000,
    };
}

/**
 * Calculate OBV (On-Balance Volume)
 */
export function calculateOBV(closes: number[], volumes: number[]): number[] {
    const obv: number[] = [0];

    for (let i = 1; i < closes.length; i++) {
        if (closes[i] > closes[i - 1]) {
            obv.push(obv[i - 1] + volumes[i]);
        } else if (closes[i] < closes[i - 1]) {
            obv.push(obv[i - 1] - volumes[i]);
        } else {
            obv.push(obv[i - 1]);
        }
    }

    return obv;
}

/**
 * Detect OBV divergence (bullish or bearish)
 */
export function detectOBVDivergence(
    prices: number[],
    obv: number[],
    lookback: number = 14
): 'bullish_divergence' | 'bearish_divergence' | 'none' {
    if (prices.length < lookback || obv.length < lookback) return 'none';

    const priceSlice = prices.slice(-lookback);
    const obvSlice = obv.slice(-lookback);

    const priceStart = priceSlice[0];
    const priceEnd = priceSlice[priceSlice.length - 1];
    const obvStart = obvSlice[0];
    const obvEnd = obvSlice[obvSlice.length - 1];

    const priceTrend = priceEnd > priceStart ? 'up' : 'down';
    const obvTrend = obvEnd > obvStart ? 'up' : 'down';

    if (priceTrend === 'down' && obvTrend === 'up') return 'bullish_divergence';
    if (priceTrend === 'up' && obvTrend === 'down') return 'bearish_divergence';
    return 'none';
}

// ==================== KELLY CRITERION POSITION SIZING ====================

export interface TradeHistory {
    pnl: number;
    isWin: boolean;
}

/**
 * Calculate optimal Kelly fraction
 * Uses quarter-Kelly for crypto volatility
 */
export function calculateKellyFraction(
    tradeHistory: TradeHistory[],
    fractionMultiplier: number = 0.25 // Quarter-Kelly recommended
): number {
    if (tradeHistory.length < 10) return 0.01; // Default 1% if not enough history

    const wins = tradeHistory.filter((t) => t.isWin);
    const losses = tradeHistory.filter((t) => !t.isWin);

    if (wins.length === 0 || losses.length === 0) return 0.01;

    const winRate = wins.length / tradeHistory.length;
    const avgWin = wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length;
    const avgLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length);

    if (avgWin === 0) return 0.01;

    // Kelly formula: f = (p × b - q) / b
    // where p = win rate, q = 1-p, b = avg_win/avg_loss
    const b = avgWin / avgLoss;
    const kelly = (winRate * b - (1 - winRate)) / b;

    // Apply fraction multiplier and cap at 20%
    const adjustedKelly = Math.max(0, Math.min(0.2, kelly * fractionMultiplier));

    return Math.round(adjustedKelly * 10000) / 10000;
}

/**
 * Calculate position size based on Kelly and ATR
 */
export function calculatePositionSize(
    accountEquity: number,
    kellyFraction: number,
    currentPrice: number,
    atr: number,
    stopLossMultiplier: number = 2 // 2× ATR stop loss
): { size: number; stopLoss: number; riskAmount: number } {
    const riskAmount = accountEquity * kellyFraction;
    const stopLossDistance = atr * stopLossMultiplier;
    const stopLoss = currentPrice - stopLossDistance;

    // Size = Risk Amount / Stop Loss Distance
    const size = riskAmount / stopLossDistance;

    return {
        size: Math.round(size * 100000) / 100000, // 5 decimal places for BTC
        stopLoss: Math.round(stopLoss * 100) / 100,
        riskAmount: Math.round(riskAmount * 100) / 100,
    };
}

// ==================== OPEN INTEREST ANALYSIS ====================

export interface OpenInterestData {
    openInterest: number;
    price: number;
    timestamp: number;
}

/**
 * Analyze Open Interest trend
 * Rising price + rising OI = strong bullish
 * Rising price + falling OI = weak rally (shorts covering)
 * Falling price + rising OI = strong bearish
 * Falling price + falling OI = capitulation (potential bottom)
 */
export function analyzeOpenInterest(
    history: OpenInterestData[]
): 'strong_bullish' | 'weak_bullish' | 'strong_bearish' | 'capitulation' | 'neutral' {
    if (history.length < 2) return 'neutral';

    const first = history[0];
    const last = history[history.length - 1];

    const priceChange = (last.price - first.price) / first.price;
    const oiChange = (last.openInterest - first.openInterest) / first.openInterest;

    const priceUp = priceChange > 0.001;
    const priceDown = priceChange < -0.001;
    const oiUp = oiChange > 0.01;
    const oiDown = oiChange < -0.01;

    if (priceUp && oiUp) return 'strong_bullish';
    if (priceUp && oiDown) return 'weak_bullish';
    if (priceDown && oiUp) return 'strong_bearish';
    if (priceDown && oiDown) return 'capitulation';
    return 'neutral';
}

// ==================== FUNDING RATE ARBITRAGE ====================

export interface FundingRateData {
    symbol: string;
    fundingRate: number;
    nextFundingTime: number;
    markPrice: number;
}

/**
 * Calculate funding arbitrage opportunity
 * Positive funding = longs pay shorts (go short perp, long spot)
 * Negative funding = shorts pay longs (go long perp, short spot)
 */
export function analyzeFundingArbitrage(
    fundingData: FundingRateData,
    threshold: number = 0.0005 // 0.05% threshold
): {
    action: 'long_perp' | 'short_perp' | 'none';
    expectedReturn: number;
    annualizedReturn: number;
} {
    const rate = fundingData.fundingRate;

    if (Math.abs(rate) < threshold) {
        return { action: 'none', expectedReturn: 0, annualizedReturn: 0 };
    }

    // Funding typically every 8 hours = 3× per day = 1095× per year
    const annualized = Math.abs(rate) * 1095 * 100; // As percentage

    if (rate > threshold) {
        // Positive funding: shorts get paid
        return {
            action: 'short_perp',
            expectedReturn: rate * 100,
            annualizedReturn: Math.round(annualized * 100) / 100,
        };
    } else {
        // Negative funding: longs get paid
        return {
            action: 'long_perp',
            expectedReturn: Math.abs(rate) * 100,
            annualizedReturn: Math.round(annualized * 100) / 100,
        };
    }
}

// ==================== LIQUIDATION CASCADE DETECTION ====================

/**
 * Estimate liquidation clusters based on leverage and entry prices
 */
export function estimateLiquidationPrice(
    entryPrice: number,
    leverage: number,
    isLong: boolean,
    maintenanceMargin: number = 0.005 // 0.5%
): number {
    const liquidationDistance = (1 - maintenanceMargin) / leverage;

    if (isLong) {
        return entryPrice * (1 - liquidationDistance);
    } else {
        return entryPrice * (1 + liquidationDistance);
    }
}

/**
 * Detect if price is approaching liquidation cluster
 */
export function isNearLiquidationCluster(
    currentPrice: number,
    clusterPrice: number,
    threshold: number = 0.01 // 1% proximity
): boolean {
    const distance = Math.abs(currentPrice - clusterPrice) / currentPrice;
    return distance < threshold;
}

// ==================== EXPORT ALL ====================

export const QuantTools = {
    // Order Book
    calculateOBI,
    getOBISignal,

    // VPIN
    calculateVPIN,
    getVPINSignal,

    // Technical
    calculateRSI,
    calculateEMA,
    calculateMACD,
    calculateATR,
    calculateBollingerBands,
    calculateOBV,
    detectOBVDivergence,

    // Position Sizing
    calculateKellyFraction,
    calculatePositionSize,

    // Open Interest
    analyzeOpenInterest,

    // Funding
    analyzeFundingArbitrage,

    // Liquidation
    estimateLiquidationPrice,
    isNearLiquidationCluster,
};

export default QuantTools;
