/**
 * Execution Strategies Module
 * TWAP, VWAP, and smart order execution
 */

export interface ExecutionConfig {
    symbol: string;
    totalSize: number;
    side: 'buy' | 'sell';
    durationMinutes: number;
}

export interface ExecutionSlice {
    sliceNumber: number;
    size: number;
    executeAt: Date;
    executed: boolean;
    price?: number;
}

/**
 * TWAP (Time-Weighted Average Price)
 * Splits large orders evenly over time intervals
 * 
 * Benefits:
 * - Reduces market impact
 * - More predictable execution
 * - Good for illiquid markets
 */
export function generateTWAPSlices(
    config: ExecutionConfig,
    intervalSeconds: number = 60
): ExecutionSlice[] {
    const numSlices = Math.ceil((config.durationMinutes * 60) / intervalSeconds);
    const sizePerSlice = config.totalSize / numSlices;
    const slices: ExecutionSlice[] = [];
    const now = new Date();

    for (let i = 0; i < numSlices; i++) {
        slices.push({
            sliceNumber: i + 1,
            size: Math.round(sizePerSlice * 100000) / 100000, // 5 decimal places
            executeAt: new Date(now.getTime() + i * intervalSeconds * 1000),
            executed: false
        });
    }

    return slices;
}

/**
 * VWAP (Volume-Weighted Average Price)
 * Executes proportional to historical volume profile
 * 
 * Benefits:
 * - Matches natural market rhythm
 * - Better fills during high volume periods
 * - Minimizes slippage
 */
export function generateVWAPSlices(
    config: ExecutionConfig,
    volumeProfile: { hour: number; volumePercent: number }[]
): ExecutionSlice[] {
    const slices: ExecutionSlice[] = [];
    const now = new Date();
    let sliceNumber = 0;

    // Normalize volume percentages
    const totalVolume = volumeProfile.reduce((sum, v) => sum + v.volumePercent, 0);

    for (const period of volumeProfile) {
        const normalizedPercent = period.volumePercent / totalVolume;
        const size = config.totalSize * normalizedPercent;

        if (size > 0.00001) { // Minimum size threshold
            sliceNumber++;
            const executeAt = new Date(now);
            executeAt.setHours(period.hour, 0, 0, 0);

            // If time has passed, schedule for next day
            if (executeAt <= now) {
                executeAt.setDate(executeAt.getDate() + 1);
            }

            slices.push({
                sliceNumber,
                size: Math.round(size * 100000) / 100000,
                executeAt,
                executed: false
            });
        }
    }

    return slices.sort((a, b) => a.executeAt.getTime() - b.executeAt.getTime());
}

/**
 * Default crypto volume profile (UTC hours)
 * Based on typical BTC/ETH trading patterns
 */
export const DEFAULT_CRYPTO_VOLUME_PROFILE = [
    { hour: 0, volumePercent: 3 },
    { hour: 1, volumePercent: 3 },
    { hour: 2, volumePercent: 3 },
    { hour: 3, volumePercent: 4 },
    { hour: 4, volumePercent: 4 },
    { hour: 5, volumePercent: 4 },
    { hour: 6, volumePercent: 5 },
    { hour: 7, volumePercent: 5 },
    { hour: 8, volumePercent: 6 },  // London open
    { hour: 9, volumePercent: 6 },
    { hour: 10, volumePercent: 5 },
    { hour: 11, volumePercent: 5 },
    { hour: 12, volumePercent: 4 },
    { hour: 13, volumePercent: 5 },  // US pre-market
    { hour: 14, volumePercent: 7 },  // US open
    { hour: 15, volumePercent: 7 },
    { hour: 16, volumePercent: 6 },
    { hour: 17, volumePercent: 5 },
    { hour: 18, volumePercent: 4 },
    { hour: 19, volumePercent: 4 },
    { hour: 20, volumePercent: 3 },
    { hour: 21, volumePercent: 3 },
    { hour: 22, volumePercent: 3 },
    { hour: 23, volumePercent: 3 },
];

/**
 * Iceberg Order
 * Shows only a small portion of the total order
 */
export function generateIcebergSlices(
    config: ExecutionConfig,
    visibleSize: number,
    intervalSeconds: number = 10
): ExecutionSlice[] {
    const slices: ExecutionSlice[] = [];
    let remaining = config.totalSize;
    let sliceNumber = 0;
    const now = new Date();

    while (remaining > 0) {
        sliceNumber++;
        const size = Math.min(visibleSize, remaining);

        slices.push({
            sliceNumber,
            size: Math.round(size * 100000) / 100000,
            executeAt: new Date(now.getTime() + (sliceNumber - 1) * intervalSeconds * 1000),
            executed: false
        });

        remaining -= size;
    }

    return slices;
}

/**
 * Smart Execution Recommendation
 * Analyzes market conditions and recommends execution strategy
 */
export function recommendExecutionStrategy(
    orderSize: number,
    avgDailyVolume: number,
    currentSpread: number,
    volatility: number
): {
    strategy: 'market' | 'twap' | 'vwap' | 'iceberg';
    reason: string;
    params: {
        duration?: number;
        slices?: number;
        visibleSize?: number;
    };
} {
    const sizePercent = orderSize / avgDailyVolume;

    // Very small orders - just market order
    if (sizePercent < 0.001 && currentSpread < 0.001) {
        return {
            strategy: 'market',
            reason: 'Order too small to impact market',
            params: {}
        };
    }

    // High volatility - use TWAP to reduce timing risk
    if (volatility > 0.03) {
        return {
            strategy: 'twap',
            reason: 'High volatility - spread execution over time',
            params: {
                duration: 30, // 30 minutes
                slices: 10
            }
        };
    }

    // Large order relative to volume - use iceberg
    if (sizePercent > 0.01) {
        return {
            strategy: 'iceberg',
            reason: 'Large order - hide size with iceberg',
            params: {
                visibleSize: orderSize * 0.1, // Show 10% at a time
                slices: 10
            }
        };
    }

    // Medium order - use VWAP for best fills
    if (sizePercent > 0.001) {
        return {
            strategy: 'vwap',
            reason: 'Medium order - match volume profile',
            params: {
                duration: 60, // 1 hour
                slices: 6
            }
        };
    }

    // Default to market
    return {
        strategy: 'market',
        reason: 'Standard execution appropriate',
        params: {}
    };
}

export const ExecutionStrategies = {
    generateTWAPSlices,
    generateVWAPSlices,
    generateIcebergSlices,
    recommendExecutionStrategy,
    DEFAULT_CRYPTO_VOLUME_PROFILE
};

export default ExecutionStrategies;
