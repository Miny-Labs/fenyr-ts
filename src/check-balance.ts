
import chalk from 'chalk';
import { createRustSDKBridge } from './sdk/rust-bridge.js';

async function main() {
    const weex = createRustSDKBridge();

    console.log(chalk.cyan('\n🔍 CHECKING ASSETS & POSITIONS...'));

    try {
        // Get Assets
        const assets = await weex.getAssets();
        const usdt = assets.find((a: any) => a.coinName === 'USDT' || a.currency === 'USDT');

        if (usdt) {
            const equity = parseFloat(usdt.equity || usdt.available || 0);
            const available = parseFloat(usdt.available || 0);
            const frozen = parseFloat(usdt.frozen || 0);

            console.log(chalk.yellow('\n💰 ACCOUNT BALANCE (USDT):'));
            console.log(`   Equity:    $${equity.toFixed(2)}`);
            console.log(`   Available: $${available.toFixed(2)}`);
            console.log(`   Frozen:    $${frozen.toFixed(2)}`);
        } else {
            console.log(chalk.red('   [!] No USDT account found'));
        }

        // Get Positions
        const positions = await weex.getPositions();
        const active = positions.filter((p: any) => parseFloat(p.total || p.open || 0) > 0);

        console.log(chalk.yellow('\n📊 OPEN POSITIONS:'));
        if (active.length === 0) {
            console.log(chalk.gray('   No open positions.'));
        } else {
            active.forEach((p: any) => {
                const side = p.holdSide === 'long' ? chalk.green('LONG') : chalk.red('SHORT');
                const size = parseFloat(p.total || 0);
                const entry = parseFloat(p.averageOpenPrice || 0);
                const pnl = parseFloat(p.unrealizedPL || 0);

                console.log(`   ${p.symbol} ${side} ${size} @ $${entry.toFixed(2)} | PnL: $${pnl.toFixed(2)}`);
            });
        }

    } catch (e: any) {
        console.error(chalk.red(`Error: ${e.message}`));
    }
}

main();
