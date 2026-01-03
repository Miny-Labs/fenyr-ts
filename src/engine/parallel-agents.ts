/**
 * Parallel Agent System
 * Independent AI agents running in parallel, reporting to a lead coordinator
 * 
 * Leverages MiMo's capabilities:
 * - 100 RPM (requests per minute)
 * - Unlimited TPM (tokens per minute)
 * - JSON output format
 * - Deep thinking optional
 */

import { EventEmitter } from 'events';
import OpenAI from 'openai';
import chalk from 'chalk';
import { RustSDKBridge } from '../sdk/rust-bridge.js';
import { calculateRSI, calculateEMA, calculateOBI, calculateATR } from '../quant/indicators.js';

// ==================== AGENT REPORT TYPES ====================

export interface AgentReport {
    agentName: string;
    timestamp: number;
    signal: 'bullish' | 'bearish' | 'neutral';
    confidence: number; // 0-1
    reasoning: string;
    data: Record<string, any>;
}

export interface LeadDecision {
    action: 'long' | 'short' | 'hold' | 'close';
    confidence: number;
    positionSize: number; // As fraction of equity
    stopLoss?: number;
    takeProfit?: number;
    reasoning: string;
    agentVotes: Record<string, AgentReport>;
    timestamp: number;
}

export interface TradingConfig {
    weights: Record<string, number>;
    signalThreshold: number;
    riskPerTrade: number;
    regime: string;
    bias: string;
    biasStrength: number;
}

// ==================== INDIVIDUAL AGENT CLASS ====================

class IndependentAgent extends EventEmitter {
    private openai: OpenAI;
    private weex: RustSDKBridge;
    private model: string;
    private name: string;
    private role: string;
    private intervalMs: number;
    private isRunning: boolean = false;
    private interval: NodeJS.Timeout | null = null;
    private lastReport: AgentReport | null = null;

    constructor(
        openai: OpenAI,
        weex: RustSDKBridge,
        name: string,
        role: string,
        model: string = 'mimo-v2-flash',
        intervalMs: number = 15000
    ) {
        super();
        this.openai = openai;
        this.weex = weex;
        this.name = name;
        this.role = role;
        this.model = model;
        this.intervalMs = intervalMs;
    }

    getLastReport(): AgentReport | null {
        return this.lastReport;
    }

    async start(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;

        console.log(chalk.gray(`   [${this.name}] Started (${this.intervalMs / 1000}s interval)`));

        // First run immediately
        await this.analyze();

        // Then run periodically
        this.interval = setInterval(async () => {
            if (this.isRunning) {
                await this.analyze();
            }
        }, this.intervalMs);
    }

    stop(): void {
        this.isRunning = false;
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    private async analyze(): Promise<void> {
        try {
            const startTime = Date.now();

            // Gather data specific to this agent's role
            const data = await this.gatherData();

            // Call LLM for analysis
            const analysis = await this.callLLM(data);

            // Create report
            this.lastReport = {
                agentName: this.name,
                timestamp: Date.now(),
                signal: analysis.signal || 'neutral',
                confidence: analysis.confidence || 0.5,
                reasoning: analysis.reasoning || 'No reasoning provided',
                data: analysis.data || {},
            };

            const elapsed = Date.now() - startTime;
            const signalIcon = this.lastReport.signal === 'bullish' ? '🟢' :
                this.lastReport.signal === 'bearish' ? '🔴' : '⚪';

            console.log(chalk.gray(`   [${this.name}] ${signalIcon} ${this.lastReport.signal} (${(this.lastReport.confidence * 100).toFixed(0)}%) - ${elapsed}ms`));

            // Emit report to lead
            this.emit('report', this.lastReport);

        } catch (error: any) {
            console.log(chalk.yellow(`   [${this.name}] Error: ${error.message}`));
        }
    }

    private async gatherData(): Promise<Record<string, any>> {
        // Base data all agents get
        const ticker = await this.weex.getTicker('cmt_btcusdt');
        const currentPrice = parseFloat(ticker.last || ticker.lastPr);

        const baseData = {
            symbol: 'cmt_btcusdt',
            currentPrice,
            priceChange24h: parseFloat(ticker.priceChangePercent || 0),
            volume24h: parseFloat(ticker.volume_24h || ticker.baseVolume || 0),
            timestamp: new Date().toISOString(),
        };

        // Role-specific data
        switch (this.role) {
            case 'market':
                const depth = await this.weex.getDepth('cmt_btcusdt');
                const bids = (depth.bids || []).slice(0, 10);
                const asks = (depth.asks || []).slice(0, 10);
                return { ...baseData, topBids: bids, topAsks: asks, spread: asks[0]?.[0] - bids[0]?.[0] };

            case 'sentiment':
                const funding = await this.weex.getFundingRate('cmt_btcusdt').catch(() => ({ fundingRate: 0 }));
                return { ...baseData, fundingRate: parseFloat(funding.fundingRate || 0) };

            case 'risk':
                const positions = await this.weex.getPositions();
                const assets = await this.weex.getAssets();
                const usdt = assets.find((a: any) => a.coinName === 'USDT');
                return {
                    ...baseData,
                    equity: parseFloat(usdt?.equity || usdt?.available || 0),
                    positions: positions.filter((p: any) => parseFloat(p.total || 0) > 0),
                };

            case 'momentum':
                const candles = await this.weex.getCandles('cmt_btcusdt');
                let closes: number[] = [];
                if (Array.isArray(candles)) {
                    closes = candles.map((c: any) => parseFloat(Array.isArray(c) ? c[4] : c.close)).filter(v => v > 0);
                }
                const rsi = closes.length >= 15 ? calculateRSI(closes, 14) : 50;
                const ema20 = closes.length >= 20 ? calculateEMA(closes, 20) : currentPrice;
                const ema50 = closes.length >= 50 ? calculateEMA(closes, 50) : currentPrice;
                return { ...baseData, rsi, ema20, ema50, trend: ema20 > ema50 ? 'bullish' : 'bearish' };

            default:
                return baseData;
        }
    }

    private async callLLM(data: Record<string, any>): Promise<any> {
        const systemPrompt = this.getSystemPrompt();

        try {
            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Analyze this data and provide your report:\n${JSON.stringify(data, null, 2)}` }
                ],
                temperature: 0.3,
                max_tokens: 300,
                response_format: { type: 'json_object' },
            });

            const content = response.choices[0]?.message?.content || '{}';
            return JSON.parse(content);
        } catch (error) {
            return { signal: 'neutral', confidence: 0.5, reasoning: 'API error' };
        }
    }

    private getSystemPrompt(): string {
        const basePrompt = `You are ${this.name}, an AI trading agent. Respond with ONLY valid JSON in this exact format:
{
    "signal": "bullish" | "bearish" | "neutral",
    "confidence": number between 0 and 1,
    "reasoning": "brief 1-sentence explanation",
    "data": { any relevant metrics }
}`;

        const rolePrompts: Record<string, string> = {
            market: `${basePrompt}\n\nYour expertise: Order book analysis, spread, liquidity. Look at bid/ask imbalance.`,
            sentiment: `${basePrompt}\n\nYour expertise: Funding rates, market sentiment. Positive funding = longs pay shorts (bearish signal).`,
            risk: `${basePrompt}\n\nYour expertise: Position sizing, account health. Consider equity and exposure.`,
            momentum: `${basePrompt}\n\nYour expertise: Technical analysis, RSI, EMA trends. RSI<30=oversold, RSI>70=overbought.`,
        };

        return rolePrompts[this.role] || basePrompt;
    }
}

// ==================== LEAD COORDINATOR AGENT ====================

class LeadCoordinator extends EventEmitter {
    private openai: OpenAI;
    private model: string;
    private agents: IndependentAgent[] = [];
    private latestReports: Map<string, AgentReport> = new Map();
    private isRunning: boolean = false;
    private decisionInterval: NodeJS.Timeout | null = null;
    private lastDecision: LeadDecision | null = null;
    private decisionIntervalMs: number;

    private symbolShort: string;

    constructor(openai: OpenAI, symbol: string, model: string = 'mimo-v2-flash', decisionIntervalMs: number = 30000) {
        super();
        this.openai = openai;
        this.symbolShort = symbol.replace('cmt_', '').toUpperCase().replace('USDT', '');
        this.model = model;
        this.decisionIntervalMs = decisionIntervalMs;
    }

    addAgent(agent: IndependentAgent): void {
        this.agents.push(agent);
        agent.on('report', (report: AgentReport) => {
            this.latestReports.set(report.agentName, report);
        });
    }

    getLastDecision(): LeadDecision | null {
        return this.lastDecision;
    }

    async start(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;

        console.log(chalk.magenta('\n👔 LEAD COORDINATOR STARTED'));
        console.log(chalk.gray(`   Decision interval: ${this.decisionIntervalMs / 1000}s`));
        console.log(chalk.gray(`   Managing ${this.agents.length} agents`));

        // Start all agents
        await Promise.all(this.agents.map(a => a.start()));

        // Wait for first reports
        await new Promise(r => setTimeout(r, 5000));

        // Make first decision
        await this.makeDecision();

        // Then decide periodically
        this.decisionInterval = setInterval(async () => {
            if (this.isRunning) {
                await this.makeDecision();
            }
        }, this.decisionIntervalMs);
    }

    stop(): void {
        this.isRunning = false;
        this.agents.forEach(a => a.stop());
        if (this.decisionInterval) {
            clearInterval(this.decisionInterval);
            this.decisionInterval = null;
        }
    }

    private async makeDecision(): Promise<void> {
        if (this.latestReports.size < 2) {
            console.log(chalk.gray('   [Lead] Waiting for more agent reports...'));
            return;
        }

        try {
            const startTime = Date.now();
            console.log(chalk.magenta(`\n👔 [Lead] Making decision with ${this.latestReports.size} agent reports...`));

            // Collect all reports
            const reports: Record<string, AgentReport> = {};
            this.latestReports.forEach((report, name) => {
                reports[name] = report;
            });

            // Call LLM for final decision
            const decision = await this.callLeadLLM(reports);

            this.lastDecision = {
                action: decision.action || 'hold',
                confidence: decision.confidence || 0.5,
                positionSize: decision.positionSize || 0.01,
                stopLoss: decision.stopLoss,
                takeProfit: decision.takeProfit,
                reasoning: decision.reasoning || 'No reasoning',
                agentVotes: reports,
                timestamp: Date.now(),
            };

            const elapsed = Date.now() - startTime;
            const actionIcon = this.lastDecision.action === 'long' ? '🟢' :
                this.lastDecision.action === 'short' ? '🔴' :
                    this.lastDecision.action === 'close' ? '🟡' : '⚪';

            console.log(chalk.magenta(
                `👔 [Lead:${this.symbolShort}] ${actionIcon} ${this.lastDecision.action.toUpperCase()} ` +
                `(${(this.lastDecision.confidence * 100).toFixed(0)}%) - ${elapsed}ms`
            ));
            console.log(chalk.gray(`   Reasoning: ${this.lastDecision.reasoning}`)); // Full reasoning

            // Emit decision for HFT engine
            this.emit('decision', this.lastDecision);

        } catch (error: any) {
            console.log(chalk.yellow(`   [Lead] Decision error: ${error.message}`));
        }
    }

    private async callLeadLLM(reports: Record<string, AgentReport>): Promise<any> {
        const systemPrompt = `You are the Lead Trading Coordinator at a quantitative hedge fund.
You receive reports from your team of specialist agents and must make the final trading decision.

Respond with ONLY valid JSON in this exact format:
{
    "action": "long" | "short" | "hold" | "close",
    "confidence": number between 0 and 1,
    "positionSize": number between 0.005 and 0.05 (fraction of equity),
    "stopLoss": number (optional, as percentage like 0.02 for 2%),
    "takeProfit": number (optional, as percentage like 0.03 for 3%),
    "reasoning": "1-2 sentence explanation of your decision"
}

Decision guidelines:
- If majority of agents agree: follow their consensus
- If agents disagree: prefer "hold" unless one has very high confidence
- Consider risk agent's assessment of account health
- In uncertain conditions: smaller position size, wider stops
- Only "long" or "short" if confidence > 0.6`;

        // Summarize reports for prompt
        const reportSummary = Object.entries(reports).map(([name, r]) =>
            `${name}: ${r.signal} (${(r.confidence * 100).toFixed(0)}%) - ${r.reasoning}`
        ).join('\n');

        try {
            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Agent reports:\n${reportSummary}\n\nMake your decision.` }
                ],
                temperature: 0.3,
                max_tokens: 300,
                response_format: { type: 'json_object' },
            });

            const content = response.choices[0]?.message?.content || '{}';
            return JSON.parse(content);
        } catch (error) {
            return { action: 'hold', confidence: 0.5, reasoning: 'API error - defaulting to hold' };
        }
    }
}

// ==================== PARALLEL AGENT SYSTEM ====================

export class ParallelAgentSystem extends EventEmitter {
    private openai: OpenAI;
    private weex: RustSDKBridge;
    private model: string;
    private lead: LeadCoordinator;
    private config: TradingConfig;

    constructor(openai: OpenAI, weex: RustSDKBridge,
        symbol: string,
        model: string = 'mimo-v2-flash') {
        super();
        this.openai = openai;
        this.weex = weex;
        this.model = model;

        const shortSymbol = symbol.replace('cmt_', '').toUpperCase().replace('USDT', '');

        this.config = {
            weights: { obi: 0.25, rsi: 0.25, ema: 0.25, momentum: 0.25 },
            signalThreshold: 0.3,
            riskPerTrade: 0.02,
            regime: 'unknown',
            bias: 'neutral',
            biasStrength: 0,
        };

        // Create lead coordinator
        this.lead = new LeadCoordinator(openai, symbol, model, 30000); // Decision every 30s

        // Create independent agents (each runs every 15s)
        const marketAgent = new IndependentAgent(openai, weex, `MarketAgent:${shortSymbol}`, 'market', model, 15000);
        const sentimentAgent = new IndependentAgent(openai, weex, `SentimentAgent:${shortSymbol}`, 'sentiment', model, 15000);
        const riskAgent = new IndependentAgent(openai, weex, `RiskAgent:${shortSymbol}`, 'risk', model, 15000);
        const momentumAgent = new IndependentAgent(openai, weex, `MomentumAgent:${shortSymbol}`, 'momentum', model, 15000);

        // Add agents to lead
        this.lead.addAgent(marketAgent);
        this.lead.addAgent(sentimentAgent);
        this.lead.addAgent(riskAgent);
        this.lead.addAgent(momentumAgent);

        // When lead makes decision, update config for HFT engine
        this.lead.on('decision', (decision: LeadDecision) => {
            this.updateConfigFromDecision(decision);
            this.emit('configUpdate', this.config);
            this.emit('decision', decision);
        });
    }

    getConfig(): TradingConfig {
        return this.config;
    }

    getLastDecision(): LeadDecision | null {
        return this.lead.getLastDecision();
    }

    async start(): Promise<void> {
        console.log(chalk.cyan('\n' + '═'.repeat(60)));
        console.log(chalk.cyan('🤖 PARALLEL AGENT SYSTEM'));
        console.log(chalk.cyan('   4 Independent Agents + 1 Lead Coordinator'));
        console.log(chalk.cyan('   Using MiMo: 100 RPM, Unlimited TPM'));
        console.log(chalk.cyan('═'.repeat(60)));

        await this.lead.start();
    }

    stop(): void {
        this.lead.stop();
    }

    private updateConfigFromDecision(decision: LeadDecision): void {
        // Update bias based on decision
        if (decision.action === 'long') {
            this.config.bias = 'bullish';
            this.config.biasStrength = decision.confidence;
        } else if (decision.action === 'short') {
            this.config.bias = 'bearish';
            this.config.biasStrength = -decision.confidence;
        } else {
            this.config.bias = 'neutral';
            this.config.biasStrength = 0;
        }

        // Update risk based on confidence
        this.config.riskPerTrade = Math.min(0.05, decision.positionSize);

        // Adjust threshold based on confidence
        this.config.signalThreshold = decision.confidence > 0.7 ? 0.2 : 0.35;
    }
}

export default ParallelAgentSystem;
