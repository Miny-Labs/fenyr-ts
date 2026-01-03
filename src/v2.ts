/**
 * Fenyr v2.0 - Main Entry Point
 * Multi-Agent Trading System with Full Blueprint Implementation
 */

import 'dotenv/config';
import { Command } from 'commander';
import OpenAI from 'openai';
import chalk from 'chalk';
import { createRustSDKBridge } from './sdk/rust-bridge.js';
import { EnhancedCoordinatorAgent, TRADING_PAIRS, type TradingPair } from './agents/enhanced-coordinator.js';
import { StreamTradingEngine } from './engine/stream-engine.js';
import { HybridTradingEngine } from './engine/hybrid-engine.js';
import { FullParallelEngine } from './engine/full-parallel.js';
import { HFTEngineV3 } from './engine/hft-engine-v3.js';

function printBanner(): void {
    console.log(chalk.cyan(`
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║   ███████╗███████╗███╗   ██╗██╗   ██╗██████╗     ██╗   ██╗██████╗ ║
║   ██╔════╝██╔════╝████╗  ██║╚██╗ ██╔╝██╔══██╗    ██║   ██║╚════██╗║
║   █████╗  █████╗  ██╔██╗ ██║ ╚████╔╝ ██████╔╝    ██║   ██║ █████╔╝║
║   ██╔══╝  ██╔══╝  ██║╚██╗██║  ╚██╔╝  ██╔══██╗    ╚██╗ ██╔╝██╔═══╝ ║
║   ██║     ███████╗██║ ╚████║   ██║   ██║  ██║     ╚████╔╝ ███████╗║
║   ╚═╝     ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝      ╚═══╝  ╚══════╝║
║                                                                   ║
║   ENHANCED MULTI-AGENT TRADING SYSTEM                             ║
║   7 AI Agents • Bull/Bear Debate • Kelly Sizing • TWAP/VWAP      ║
║   OBI • VPIN • Funding Arbitrage • All 8 WEEX Pairs              ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
  `));
}

async function main(): Promise<void> {
    const program = new Command();

    program
        .name('fenyr-v2')
        .description('Fenyr v2.0 - Enhanced Multi-Agent Trading System')
        .version('2.0.0')
        .option('-m, --mode <mode>', 'Mode: single, continuous, quant, hybrid, parallel, director', 'director')
        .option('-s, --symbol <symbol>', 'Trading symbol', 'cmt_btcusdt')
        .option('--hft-cycles <n>', 'Number of HFT cycles', '5')
        .option('--hft-interval <s>', 'Seconds between HFT cycles', '30')
        .option('--model <model>', 'AI model', 'mimo-v2-flash')
        .option('--max-position <size>', 'Maximum position size in BTC', '0.001')
        .option('--min-balance <usd>', 'Stop trading if balance drops below this (USD)', '700')
        .parse(process.argv);

    const opts = program.opts();

    printBanner();
    console.log(`📅 Started: ${new Date().toISOString()}`);
    console.log(`🤖 Model: ${opts.model}`);
    console.log(`📊 Symbol: ${opts.symbol}`);
    console.log(`🔄 Mode: ${opts.mode}`);
    console.log(`💰 Max Position: ${opts.maxPosition} BTC`);

    // Validate environment
    if (!process.env.MIMO_API_KEY && !process.env.OPENAI_API_KEY) {
        console.error(chalk.red('❌ MIMO_API_KEY or OPENAI_API_KEY not set'));
        process.exit(1);
    }
    if (!process.env.WEEX_API_KEY) {
        console.error(chalk.red('❌ WEEX_API_KEY not set'));
        process.exit(1);
    }

    // Initialize clients
    console.log('\n🔗 Connecting to WEEX Exchange...');
    const weexClient = createRustSDKBridge();
    const ticker = await weexClient.getTicker(opts.symbol);
    console.log(chalk.green(`✅ Connected! ${opts.symbol} = $${ticker.last}`));

    // Initialize MiMo AI (OpenAI-compatible API)
    // MiMo-V2-Flash is FREE until Jan 20, 2026
    const openai = new OpenAI({
        apiKey: process.env.MIMO_API_KEY || process.env.OPENAI_API_KEY,
        baseURL: 'https://api.xiaomimimo.com/v1'
    });

    // Initialize Enhanced Coordinator
    console.log('\n🧠 Initializing Enhanced Agent Team...');
    const coordinator = new EnhancedCoordinatorAgent(
        openai,
        weexClient,
        opts.model,
        parseFloat(opts.maxPosition)
    );
    console.log(chalk.green('✅ All 7 agents initialized!'));
    console.log('   📊 Market Analyst');
    console.log('   💭 Sentiment Agent');
    console.log('   📈 Fundamentals Analyst');
    console.log('   🐂 Bull Researcher');
    console.log('   🐻 Bear Researcher');
    console.log('   🛡️ Risk Manager');
    console.log('   ⚡ Executor');

    // Run based on mode
    switch (opts.mode) {
        case 'single':
            await runSingle(coordinator, opts.symbol);
            break;

        case 'hft':
            await runHFT(
                coordinator,
                opts.symbol,
                parseInt(opts.hftCycles),
                parseInt(opts.hftInterval)
            );
            break;

        case 'scan':
            await runScan(coordinator);
            break;

        case 'continuous':
            await runContinuous(coordinator, weexClient, opts.symbol, 300, parseFloat(opts.minBalance));
            break;

        case 'quant':
            await runQuantMode(weexClient, opts.symbol, parseFloat(opts.maxPosition), parseFloat(opts.minBalance));
            break;

        case 'hybrid':
            await runHybridMode(openai, weexClient, opts.model, opts.symbol, parseFloat(opts.minBalance));
            break;

        case 'parallel':
            await runParallelMode(openai, weexClient, opts.model, opts.symbol, parseFloat(opts.minBalance));
            break;

        case 'director':
            await runDirectorMode(openai, weexClient, opts.symbol, parseFloat(opts.minBalance));
            break;

        default:
            console.error(chalk.red(`Unknown mode: ${opts.mode}`));
            process.exit(1);
    }

    console.log(chalk.cyan('\n🏁 Fenyr v2.0 session complete.'));
}

async function runSingle(coordinator: EnhancedCoordinatorAgent, symbol: string): Promise<void> {
    console.log(chalk.magenta('\n📍 SINGLE ANALYSIS MODE'));
    await coordinator.runFullAnalysis(symbol);
}

async function runHFT(
    coordinator: EnhancedCoordinatorAgent,
    symbol: string,
    cycles: number,
    intervalSec: number
): Promise<void> {
    console.log(chalk.magenta('\n🚀 HFT MODE ACTIVATED'));
    console.log(`   Cycles: ${cycles}`);
    console.log(`   Interval: ${intervalSec}s`);
    console.log('-'.repeat(60));

    let executedTrades = 0;
    let aiLogsUploaded = 0;

    for (let i = 1; i <= cycles; i++) {
        console.log(chalk.yellow(`\n${'═'.repeat(60)}`));
        console.log(chalk.yellow(`🔄 HFT CYCLE ${i}/${cycles}`));
        console.log(chalk.yellow('═'.repeat(60)));

        const decision = await coordinator.runFullAnalysis(symbol);

        aiLogsUploaded += 7; // 7 agents each upload

        if (decision.action === 'execute' && decision.execution?.success) {
            executedTrades++;
        }

        if (i < cycles) {
            console.log(chalk.gray(`\n💤 Next cycle in ${intervalSec}s...`));
            await new Promise(r => setTimeout(r, intervalSec * 1000));
        }
    }

    console.log(chalk.cyan('\n' + '═'.repeat(60)));
    console.log(chalk.cyan('🏁 HFT SESSION COMPLETE'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(`   Cycles: ${cycles}`);
    console.log(`   Trades Executed: ${executedTrades}`);
    console.log(`   AI Logs Uploaded: ${aiLogsUploaded}`);
}

async function runScan(coordinator: EnhancedCoordinatorAgent): Promise<void> {
    console.log(chalk.magenta('\n🔍 MULTI-PAIR SCAN MODE'));
    console.log(`   Scanning all ${TRADING_PAIRS.length} WEEX pairs...`);

    const results = await coordinator.scanAllPairs();

    // Print summary
    console.log(chalk.cyan('\n' + '═'.repeat(60)));
    console.log(chalk.cyan('📊 SCAN RESULTS SUMMARY'));
    console.log(chalk.cyan('═'.repeat(60)));

    const opportunities: { pair: TradingPair; decision: any }[] = [];

    for (const [pair, decision] of results) {
        const actionColor = decision.action === 'execute' ? chalk.green :
            decision.action === 'alert' ? chalk.yellow : chalk.gray;

        console.log(`${pair}: ${actionColor(decision.action)} | ${decision.direction} | ${(decision.confidence * 100).toFixed(0)}%`);

        if (decision.action === 'execute') {
            opportunities.push({ pair, decision });
        }
    }

    if (opportunities.length > 0) {
        console.log(chalk.green(`\n🎯 ${opportunities.length} TRADING OPPORTUNITIES FOUND`));
    } else {
        console.log(chalk.gray('\n⏸️ No immediate opportunities - markets neutral'));
    }
}

async function runContinuous(
    coordinator: EnhancedCoordinatorAgent,
    weexClient: ReturnType<typeof createRustSDKBridge>,
    symbol: string,
    intervalSec: number,
    minBalance: number = 700
): Promise<void> {
    console.log(chalk.magenta('\n♾️ CONTINUOUS MODE (Balance Protected)'));
    console.log(`   Interval: ${intervalSec}s`);
    console.log(`   🛡️ Stop-Loss: $${minBalance}`);
    console.log('   Press Ctrl+C to stop');

    let cycle = 0;
    let totalTrades = 0;
    let aiLogs = 0;

    while (true) {
        cycle++;
        console.log(chalk.yellow(`\n${'═'.repeat(60)}`));
        console.log(chalk.yellow(`🔄 Continuous cycle ${cycle}`));
        console.log(chalk.yellow('═'.repeat(60)));

        // Check balance before each cycle
        try {
            const assets = await weexClient.getAssets();
            const usdt = assets.find((a: any) => a.coinName === 'USDT');
            const balance = parseFloat(usdt?.equity || usdt?.available || '0');

            console.log(chalk.cyan(`\n💰 Current Balance: $${balance.toFixed(2)}`));

            if (balance < minBalance) {
                console.log(chalk.red(`\n⛔ BALANCE PROTECTION TRIGGERED!`));
                console.log(chalk.red(`   Balance $${balance.toFixed(2)} < Min $${minBalance}`));
                console.log(chalk.red(`   Stopping trading to protect capital.`));

                console.log(chalk.cyan('\n' + '═'.repeat(60)));
                console.log(chalk.cyan('🏁 SESSION STOPPED - BALANCE LIMIT'));
                console.log(chalk.cyan('═'.repeat(60)));
                console.log(`   Total Cycles: ${cycle - 1}`);
                console.log(`   AI Logs Uploaded: ${aiLogs}`);
                console.log(`   Final Balance: $${balance.toFixed(2)}`);
                return;
            }
        } catch (error) {
            console.log(chalk.yellow('   ⚠️ Could not fetch balance, continuing...'));
        }

        // Run analysis
        const decision = await coordinator.runFullAnalysis(symbol);
        aiLogs += 7;

        if (decision.action === 'execute' && decision.execution?.success) {
            totalTrades++;
            console.log(chalk.green(`\n💹 Trade #${totalTrades} executed!`));
        }

        console.log(chalk.gray(`\n💤 Next cycle in ${intervalSec}s...`));
        await new Promise(r => setTimeout(r, intervalSec * 1000));
    }
}

async function runQuantMode(
    weex: ReturnType<typeof createRustSDKBridge>,
    symbol: string,
    maxPosition: number,
    minBalance: number
): Promise<void> {
    console.log(chalk.cyan('\n⚡ QUANT MODE - HIGH FREQUENCY TRADING'));
    console.log(chalk.gray('   Pure math signals • No LLM latency • 5-second cycles'));
    console.log(chalk.gray('   Press Ctrl+C to stop\n'));

    const engine = new StreamTradingEngine(weex, {
        symbol,
        maxPositionSize: maxPosition,
        minBalance,
        pollingIntervalMs: 5000, // 5 seconds
        minConfidence: 0.5, // Lower threshold for faster action
        signalThreshold: 0.2,
        riskPerTrade: 0.02, // 2% risk per trade
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log(chalk.yellow('\n\nShutting down gracefully...'));
        engine.stop();
        const status = engine.getStatus();
        console.log(chalk.cyan(`\n📊 Session Summary:`));
        console.log(`   Trades: ${status.tradeCount}`);
        console.log(`   Win Rate: ${(status.winRate * 100).toFixed(1)}%`);
        console.log(`   Final Equity: $${status.equity.toFixed(2)}`);
        process.exit(0);
    });

    await engine.start();

    // Keep running forever
    await new Promise(() => { });
}

async function runHybridMode(
    openai: OpenAI,
    weex: ReturnType<typeof createRustSDKBridge>,
    model: string,
    symbol: string,
    minBalance: number
): Promise<void> {
    console.log(chalk.cyan('\n🏢 HYBRID MODE - AI STRATEGISTS + HFT ALGORITHMS'));
    console.log(chalk.gray('   AI runs every 60s to configure | HFT runs every 5s to execute'));
    console.log(chalk.gray('   Press Ctrl+C to stop\n'));

    const engine = new HybridTradingEngine(openai, weex, model, symbol, minBalance);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log(chalk.yellow('\n\nShutting down hybrid system...'));
        engine.stop();
        process.exit(0);
    });

    // Start with AI every 60s, HFT every 5s
    await engine.start(5000, 60000);

    // Keep running forever
    await new Promise(() => { });
}

async function runParallelMode(
    openai: OpenAI,
    weex: ReturnType<typeof createRustSDKBridge>,
    model: string,
    symbol: string,
    minBalance: number
): Promise<void> {
    console.log(chalk.cyan('\n🏛️ PARALLEL MODE - Full Multi-Agent System'));
    console.log(chalk.gray('   4 AI Agents (15s) → Lead Coordinator (30s) → HFT (5s)'));
    console.log(chalk.gray('   MiMo: 100 RPM • Unlimited TPM • JSON Output'));
    console.log(chalk.gray('   Press Ctrl+C to stop\n'));

    const engine = new FullParallelEngine(openai, weex, model, symbol, minBalance);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log(chalk.yellow('\n\nShutting down parallel system...'));
        engine.stop();
        const status = engine.getStatus();
        console.log(chalk.cyan(`\n📊 Session Summary:`));
        console.log(`   Final Equity: $${status.equity.toFixed(2)}`);
        console.log(`   Position: ${status.position ? `${status.position.side} ${status.position.size}` : 'FLAT'}`);
        process.exit(0);
    });

    await engine.start(5000); // HFT every 5s

    // Keep running forever
    await new Promise(() => { });
}

async function runDirectorMode(
    openai: OpenAI,
    weex: ReturnType<typeof createRustSDKBridge>,
    symbol: string,
    minBalance: number
): Promise<void> {
    console.log(chalk.cyan('\n🚀 DIRECTOR MODE - REAL HFT ARCHITECTURE'));
    console.log(chalk.gray('   WS Data (0ms) -> Sync Risk -> HFT Logic (Instant) -> Execution'));
    console.log(chalk.gray('   Press Ctrl+C to stop\n'));

    const engines: HFTEngineV3[] = [];

    // Determine symbols to trade
    let symbolsToTrade: string[] = [];
    if (symbol === 'all') {
        // Use top 3 liquid pairs to respect rate limits for now
        // Or TRADING_PAIRS from config if we want all
        symbolsToTrade = ['cmt_btcusdt', 'cmt_ethusdt', 'cmt_solusdt'];
        console.log(chalk.yellow(`   Starting Multi-Pair Engines for: ${symbolsToTrade.join(', ')}`));
    } else {
        symbolsToTrade = [symbol];
    }

    // Launch Engines
    for (const sym of symbolsToTrade) {
        console.log(chalk.cyan(`   [Init] Launching HFT Engine for ${sym}...`));
        const engine = new HFTEngineV3(openai, weex, sym, minBalance);
        engines.push(engine);

        // Start engine
        await engine.start();

        // Stagger start to avoid API burst
        if (symbolsToTrade.length > 1) {
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    process.on('SIGINT', () => {
        console.log(chalk.yellow('\n\nStopping all engines...'));
        engines.forEach(e => {
            e.stop();
            const status = e.getStatus();
            console.log(chalk.cyan(`   ${e['symbol']}: Equity=$${status.risk.equity.toFixed(2)}, RiskTripped=${status.risk.tripped}`));
        });
        process.exit(0);
    });

    // Keep running forever
    await new Promise(() => { });
}

main().catch(console.error);
