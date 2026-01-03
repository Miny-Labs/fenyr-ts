
import chalk from 'chalk';
import { createRustSDKBridge } from './sdk/rust-bridge.js';

async function main() {
    const weex = createRustSDKBridge();
    const symbol = 'cmt_btcusdt';

    console.log(chalk.cyan(`\n📜 TRADING HISTORY: ${symbol.toUpperCase()}`));

    try {
        const history = await weex.getOrderHistory(symbol);

        if (!Array.isArray(history) || history.length === 0) {
            console.log(chalk.gray('   No trade history found.'));
            return;
        }

        // Sort by time (newest first)
        const sorted = history.sort((a: any, b: any) => parseInt(b.cTime || b.createTime) - parseInt(a.cTime || a.createTime));
        const recent = sorted.slice(0, 10);

        let filledCount = 0;
        let totalVol = 0;

        console.log(chalk.yellow('\n⚡ RECENT TRADES:'));
        recent.forEach((o: any) => {
            if (o.state !== 'filled' && o.status !== 'filled') return;

            filledCount++;
            const side = o.side === 'buy' ? chalk.green('BUY ') : chalk.red('SELL');
            const price = parseFloat(o.priceAvg || o.price || 0);
            const size = parseFloat(o.size || o.volume || 0);
            const time = new Date(parseInt(o.cTime || o.createTime)).toISOString().replace('T', ' ').slice(0, 19);
            const pnl = parseFloat(o.realizedPl || 0);

            totalVol += size * price;

            console.log(`   ${time} | ${side} | ${size.toFixed(4)} @ $${price.toFixed(1)} | PnL: ${pnl >= 0 ? chalk.green('+$' + pnl.toFixed(4)) : chalk.red('-$' + Math.abs(pnl).toFixed(4))}`);
        });

        console.log(chalk.gray(`\n   ... (Showing ${recent.length} of ${history.length} orders)`));

    } catch (e: any) {
        console.error(chalk.red(`Error: ${e.message}`));
    }
}

main();
