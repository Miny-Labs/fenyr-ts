/**
 * TWAP/VWAP Execution Engine
 * Smart order execution to minimize market impact
 */

import { RustSDKBridge } from '../sdk/rust-bridge.js';

export interface ExecutionConfig {
    symbol: string;
    totalSize: number;
    side: 'buy' | 'sell';
    leverage?: number;
    durationMs: number;      // Total execution time
    numSlices: number;       // Number of order slices
    maxSlippage: number;     // Max allowed slippage %
}

export interface ExecutionResult {
    success: boolean;
    ordersPlaced: number;
    totalFilled: number;
    avgPrice: number;
    slippage: number;
    executionTime: number;
    orderIds: string[];
}

/**
 * TWAP (Time-Weighted Average Price) Execution
 * Splits orders evenly over time - ideal for low liquidity
 */
export async function executeTWAP(
    weex: RustSDKBridge,
    config: ExecutionConfig
): Promise<ExecutionResult> {
    const startTime = Date.now();
    const sliceSize = config.totalSize / config.numSlices;
    const intervalMs = config.durationMs / config.numSlices;
    const orderIds: string[] = [];
    let totalFilled = 0;
    let totalValue = 0;

    console.log(`\n🕐 TWAP Execution Started`);
    console.log(`   Total: ${config.totalSize} ${config.symbol}`);
    console.log(`   Slices: ${config.numSlices} × ${sliceSize.toFixed(6)}`);
    console.log(`   Interval: ${intervalMs}ms`);

    try {
        const startPrice = parseFloat((await weex.getTicker(config.symbol)).last);

        for (let i = 0; i < config.numSlices; i++) {
            // Wait for interval (except first slice)
            if (i > 0) {
                await sleep(intervalMs);
            }

            // Get current price
            const ticker = await weex.getTicker(config.symbol);
            const currentPrice = parseFloat(ticker.last);

            // Check slippage
            const slippage = Math.abs(currentPrice - startPrice) / startPrice;
            if (slippage > config.maxSlippage) {
                console.log(`⚠️ Slippage exceeded ${(config.maxSlippage * 100).toFixed(2)}%, pausing...`);
                await sleep(5000); // Wait 5 seconds
                continue;
            }

            // Place order slice
            const side = config.side === 'buy' ? 1 : 2;
            const result = await weex.placeOrder(
                config.symbol,
                sliceSize.toFixed(6),
                side
            );

            if (result.code === '00000' || result.order_id) {
                const orderId = result.order_id || result.data?.orderId || `slice_${i}`;
                orderIds.push(String(orderId));
                totalFilled += sliceSize;
                totalValue += sliceSize * currentPrice;
                console.log(`   ✅ Slice ${i + 1}/${config.numSlices}: ${sliceSize.toFixed(6)} @ $${currentPrice}`);
            } else {
                console.log(`   ❌ Slice ${i + 1} failed: ${result.msg || 'Unknown error'}`);
            }
        }

        const endPrice = parseFloat((await weex.getTicker(config.symbol)).last);
        const avgPrice = totalFilled > 0 ? totalValue / totalFilled : endPrice;
        const actualSlippage = Math.abs(avgPrice - startPrice) / startPrice;

        return {
            success: totalFilled > 0,
            ordersPlaced: orderIds.length,
            totalFilled,
            avgPrice,
            slippage: actualSlippage,
            executionTime: Date.now() - startTime,
            orderIds,
        };

    } catch (error) {
        console.error('TWAP execution error:', error);
        return {
            success: false,
            ordersPlaced: orderIds.length,
            totalFilled,
            avgPrice: 0,
            slippage: 0,
            executionTime: Date.now() - startTime,
            orderIds,
        };
    }
}

/**
 * VWAP (Volume-Weighted Average Price) Execution
 * Executes in proportion to market volume - better for liquid assets
 */
export async function executeVWAP(
    weex: RustSDKBridge,
    config: ExecutionConfig,
    volumeProfile?: number[] // Historical volume distribution by period
): Promise<ExecutionResult> {
    const startTime = Date.now();
    const orderIds: string[] = [];
    let totalFilled = 0;
    let totalValue = 0;

    // Default volume profile if not provided (front-loaded)
    const profile = volumeProfile || generateDefaultVolumeProfile(config.numSlices);

    console.log(`\n📊 VWAP Execution Started`);
    console.log(`   Total: ${config.totalSize} ${config.symbol}`);
    console.log(`   Slices: ${config.numSlices}`);

    try {
        const startPrice = parseFloat((await weex.getTicker(config.symbol)).last);
        const intervalMs = config.durationMs / config.numSlices;

        for (let i = 0; i < config.numSlices; i++) {
            if (i > 0) {
                await sleep(intervalMs);
            }

            // Calculate slice size based on volume profile
            const sliceWeight = profile[i] / profile.reduce((a, b) => a + b, 0);
            const sliceSize = config.totalSize * sliceWeight;

            if (sliceSize < 0.00001) continue; // Skip tiny slices

            const ticker = await weex.getTicker(config.symbol);
            const currentPrice = parseFloat(ticker.last);

            // Check slippage
            const slippage = Math.abs(currentPrice - startPrice) / startPrice;
            if (slippage > config.maxSlippage) {
                console.log(`⚠️ Slippage exceeded, reducing slice size`);
                continue;
            }

            const side = config.side === 'buy' ? 1 : 2;
            const result = await weex.placeOrder(
                config.symbol,
                sliceSize.toFixed(6),
                side
            );

            if (result.code === '00000' || result.order_id) {
                const orderId = result.order_id || result.data?.orderId || `vwap_${i}`;
                orderIds.push(String(orderId));
                totalFilled += sliceSize;
                totalValue += sliceSize * currentPrice;
                console.log(`   ✅ VWAP ${i + 1}/${config.numSlices}: ${sliceSize.toFixed(6)} (${(sliceWeight * 100).toFixed(1)}%)`);
            }
        }

        const avgPrice = totalFilled > 0 ? totalValue / totalFilled : 0;
        const actualSlippage = Math.abs(avgPrice - startPrice) / startPrice;

        return {
            success: totalFilled > 0,
            ordersPlaced: orderIds.length,
            totalFilled,
            avgPrice,
            slippage: actualSlippage,
            executionTime: Date.now() - startTime,
            orderIds,
        };

    } catch (error) {
        console.error('VWAP execution error:', error);
        return {
            success: false,
            ordersPlaced: orderIds.length,
            totalFilled,
            avgPrice: 0,
            slippage: 0,
            executionTime: Date.now() - startTime,
            orderIds,
        };
    }
}

/**
 * Generate default volume profile (higher at open/close)
 */
function generateDefaultVolumeProfile(numSlices: number): number[] {
    const profile: number[] = [];
    for (let i = 0; i < numSlices; i++) {
        // U-shaped curve: higher at start and end
        const x = i / (numSlices - 1);
        const weight = 1 + 0.5 * Math.pow(2 * x - 1, 2);
        profile.push(weight);
    }
    return profile;
}

/**
 * Quick market order execution (for urgent trades)
 */
export async function executeMarket(
    weex: RustSDKBridge,
    symbol: string,
    size: number,
    side: 'buy' | 'sell'
): Promise<ExecutionResult> {
    const startTime = Date.now();
    const ticker = await weex.getTicker(symbol);
    const startPrice = parseFloat(ticker.last);

    try {
        const sideNum = side === 'buy' ? 1 : 2;
        const result = await weex.placeOrder(symbol, size.toFixed(6), sideNum);

        const endTicker = await weex.getTicker(symbol);
        const endPrice = parseFloat(endTicker.last);
        const slippage = Math.abs(endPrice - startPrice) / startPrice;

        return {
            success: result.code === '00000' || !!result.order_id,
            ordersPlaced: 1,
            totalFilled: size,
            avgPrice: endPrice,
            slippage,
            executionTime: Date.now() - startTime,
            orderIds: [result.order_id || result.data?.orderId || 'unknown'],
        };

    } catch (error) {
        return {
            success: false,
            ordersPlaced: 0,
            totalFilled: 0,
            avgPrice: 0,
            slippage: 0,
            executionTime: Date.now() - startTime,
            orderIds: [],
        };
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export const ExecutionEngine = {
    executeTWAP,
    executeVWAP,
    executeMarket,
};

export default ExecutionEngine;
