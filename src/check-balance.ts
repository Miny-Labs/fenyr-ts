
import { createRustSDKBridge } from './sdk/rust-bridge.js';

async function main() {
    const weex = createRustSDKBridge();
    const result = {
        equity: 0,
        available: 0,
        usedMargin: 0,
        positions: [] as any[]
    };

    try {
        const assets = await weex.getAssets();
        const usdt = assets.find((a: any) => a.coinName === 'USDT');
        if (usdt) {
            result.equity = parseFloat(usdt.equity || usdt.available || 0);
            result.available = parseFloat(usdt.available || 0);
            result.usedMargin = result.equity - result.available; // Approx used
        }

        const positions = await weex.getPositions();
        if (Array.isArray(positions)) {
            result.positions = positions.filter((p: any) => parseFloat(p.total || p.size || 0) > 0).map((p: any) => ({
                symbol: p.symbol,
                side: p.side || p.holdSide,
                size: parseFloat(p.total || p.size),
                pnl: parseFloat(p.unrealizedPL || p.unrealizedPnl || 0),
                margin: parseFloat(p.margin || 0)
            }));

            // Adjust usedMargin if positions provided explicit margin
            // result.usedMargin = result.positions.reduce((acc, p) => acc + (p.margin || 0), 0);
        }

        console.log(JSON.stringify(result));
    } catch (e) {
        console.error(JSON.stringify({ error: e }));
    }
}
main();
