#!/usr/bin/env node
/**
 * Fenyr TypeScript Multi-Agent Trading System
 * Main entry point
 */

import 'dotenv/config';
import { Command } from 'commander';
import OpenAI from 'openai';
import chalk from 'chalk';
import { createWeexClient } from './sdk/client.js';
import { CoordinatorAgent, TeamDecision } from './agents/coordinator.js';

function printBanner(): void {
    console.log(chalk.cyan(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ███████╗███████╗███╗   ██╗██╗   ██╗██████╗                 ║
║   ██╔════╝██╔════╝████╗  ██║╚██╗ ██╔╝██╔══██╗                ║
║   █████╗  █████╗  ██╔██╗ ██║ ╚████╔╝ ██████╔╝                ║
║   ██╔══╝  ██╔══╝  ██║╚██╗██║  ╚██╔╝  ██╔══██╗                ║
║   ██║     ███████╗██║ ╚████║   ██║   ██║  ██║                ║
║   ╚═╝     ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝                ║
║                                                               ║
║   ${chalk.bold('MULTI-AGENT TRADING SYSTEM • TypeScript')}               ║
║   5 AI Agents • Team Consensus • Full SDK • HFT Ready        ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `));
}

async function runSingleAnalysis(
    coordinator: CoordinatorAgent,
    symbol: string
): Promise<TeamDecision> {
    console.log(`\n⏰ ${new Date().toISOString()} - Starting team analysis`);
    const decision = await coordinator.runTeamAnalysis(symbol);

    console.log(chalk.bold('\n📋 TEAM DECISION SUMMARY:'));
    console.log(`   Action: ${chalk.bold(decision.action.toUpperCase())}`);
    console.log(`   Direction: ${decision.tradeDirection}`);
    console.log(`   Size: ${decision.size}`);
    console.log(`   Confidence: ${decision.confidence.toFixed(2)}`);
    console.log(`   AI Logs Uploaded: ${chalk.green(decision.aiLogsUploaded.toString())}`);

    return decision;
}

async function runHFTMode(
    coordinator: CoordinatorAgent,
    symbol: string,
    cycles: number,
    interval: number
): Promise<void> {
    console.log(chalk.red.bold('\n🚀 HFT MODE ACTIVATED'));
    console.log(`   Symbol: ${symbol}`);
    console.log(`   Cycles: ${cycles}`);
    console.log(`   Interval: ${interval}s`);
    console.log('-'.repeat(60));

    let tradesExecuted = 0;
    let totalAiLogs = 0;

    for (let cycle = 1; cycle <= cycles; cycle++) {
        console.log(chalk.yellow(`\n${'═'.repeat(60)}`));
        console.log(chalk.yellow.bold(`🔄 HFT CYCLE ${cycle}/${cycles}`));
        console.log(chalk.yellow(`${'═'.repeat(60)}`));

        try {
            const decision = await coordinator.runTeamAnalysis(symbol);
            totalAiLogs += decision.aiLogsUploaded;

            if (decision.action === 'execute') {
                tradesExecuted++;
                console.log(chalk.green(`⚡ TRADE EXECUTED: ${decision.tradeDirection} ${decision.size}`));
            } else if (decision.action === 'alert') {
                console.log(chalk.yellow('🔔 ALERT: Notable market conditions'));
            } else {
                console.log(chalk.gray('⏸️ HOLD: Waiting for opportunity'));
            }
        } catch (error: any) {
            console.error(chalk.red(`❌ Cycle error: ${error.message}`));
        }

        if (cycle < cycles) {
            console.log(chalk.gray(`\n💤 Next cycle in ${interval}s...`));
            await new Promise((resolve) => setTimeout(resolve, interval * 1000));
        }
    }

    console.log(chalk.green(`\n${'═'.repeat(60)}`));
    console.log(chalk.green.bold('🏁 HFT SESSION COMPLETE'));
    console.log(chalk.green(`${'═'.repeat(60)}`));
    console.log(`   Cycles: ${cycles}`);
    console.log(`   Trades Executed: ${tradesExecuted}`);
    console.log(`   AI Logs Uploaded: ${chalk.green(totalAiLogs.toString())}`);
}

async function runContinuousMode(
    coordinator: CoordinatorAgent,
    symbol: string,
    interval: number
): Promise<void> {
    console.log(chalk.blue.bold('\n🔄 CONTINUOUS MODE'));
    console.log(`   Interval: ${interval}s`);

    let cycle = 0;
    while (true) {
        cycle++;
        console.log(chalk.blue(`\n${'═'.repeat(60)}`));
        console.log(chalk.blue.bold(`CYCLE ${cycle}`));
        console.log(chalk.blue(`${'═'.repeat(60)}`));

        try {
            await runSingleAnalysis(coordinator, symbol);
        } catch (error: any) {
            console.error(chalk.red(`❌ Error: ${error.message}`));
        }

        console.log(chalk.gray(`\n💤 Next analysis in ${interval}s...`));
        await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    }
}

async function main(): Promise<void> {
    const program = new Command();

    program
        .name('fenyr')
        .description('Multi-agent AI trading system for WEEX')
        .version('1.0.0')
        .option('-m, --mode <mode>', 'Operation mode: single, hft, continuous', 'single')
        .option('-s, --symbol <symbol>', 'Trading symbol', 'cmt_btcusdt')
        .option('-i, --interval <seconds>', 'Interval for continuous mode', '300')
        .option('-c, --hft-cycles <number>', 'HFT mode cycles', '5')
        .option('--hft-interval <seconds>', 'HFT mode interval', '30')
        .parse();

    const opts = program.opts();

    printBanner();

    // Config
    const model = process.env.GPT_MODEL || 'gpt-5.2';
    const maxPositionSize = parseFloat(process.env.MAX_POSITION_SIZE || '0.0002');

    console.log(`📅 Started: ${new Date().toISOString()}`);
    console.log(`🤖 Model: ${model}`);
    console.log(`📊 Symbol: ${opts.symbol}`);
    console.log(`🔄 Mode: ${opts.mode}`);

    // Initialize clients
    console.log('\n🔗 Connecting to WEEX Exchange...');
    const weexClient = createWeexClient();
    const ticker = await weexClient.getTicker(opts.symbol);
    console.log(chalk.green(`✅ Connected! ${opts.symbol} = $${ticker.last}`));

    // Initialize OpenAI
    console.log('\n🧠 Initializing AI Agents...');
    const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Initialize Coordinator
    const coordinator = new CoordinatorAgent(openaiClient, weexClient, model, maxPositionSize);

    console.log(chalk.green('✅ All 5 agents initialized!'));
    console.log('   📊 Market Analyst');
    console.log('   💭 Sentiment Agent');
    console.log('   🛡️ Risk Manager');
    console.log('   ⚡ Executor');
    console.log('   🎯 Coordinator');

    // Run based on mode
    switch (opts.mode) {
        case 'hft':
            await runHFTMode(
                coordinator,
                opts.symbol,
                parseInt(opts.hftCycles, 10),
                parseInt(opts.hftInterval, 10)
            );
            break;
        case 'continuous':
            await runContinuousMode(coordinator, opts.symbol, parseInt(opts.interval, 10));
            break;
        default:
            await runSingleAnalysis(coordinator, opts.symbol);
    }

    console.log(chalk.bold('\n🏁 Fenyr Multi-Agent System finished.'));
}

main().catch(console.error);
