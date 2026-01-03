
import { createRustSDKBridge } from './sdk/rust-bridge.js';
import { TRADING_PAIRS } from './agents/enhanced-coordinator.js';

async function main() {
    const weex = createRustSDKBridge();
    const results: Record<string, any> = {};

    // Parallel fetch for speed
    const tasks = TRADING_PAIRS.map(async (symbol) => {
        try {
            const ticker = await weex.getTicker(symbol);
            if (ticker) {
                const short = symbol.replace('cmt_', '').toUpperCase().replace('USDT', '');
                return {
                    short,
                    data: {
                        price: parseFloat(ticker.last || ticker.close || 0),
                        change: parseFloat(ticker.change24h || 0)
                    }
                };
            }
        } catch (e) {
            return null;
        }
    });

    try {
        const finished = await Promise.all(tasks);
        finished.forEach(item => {
            if (item) {
                results[item.short] = item.data;
            }
        });
        console.log(JSON.stringify(results));
    } catch (e) {
        console.error(JSON.stringify({}));
    }
}

main();
