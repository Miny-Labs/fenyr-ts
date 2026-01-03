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
import { calculateRSI, calculateEMA, calculateOBI, calculateATR, calculateMACD, calculateBollingerBands } from '../quant/indicators.js';

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
    private symbol: string; // ACTUAL TRADING SYMBOL
    private intervalMs: number;
    private isRunning: boolean = false;
    private interval: NodeJS.Timeout | null = null;
    private lastReport: AgentReport | null = null;

    constructor(
        openai: OpenAI,
        weex: RustSDKBridge,
        name: string,
        role: string,
        symbol: string, // NOW REQUIRED
        model: string = 'mimo-v2-flash',
        intervalMs: number = 10000 // Faster: 10s instead of 15s
    ) {
        super();
        this.openai = openai;
        this.weex = weex;
        this.name = name;
        this.role = role;
        this.symbol = symbol; // STORE THE ACTUAL SYMBOL
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
        // USE THE CORRECT SYMBOL FOR THIS AGENT
        const ticker = await this.weex.getTicker(this.symbol);
        const currentPrice = parseFloat(ticker.last || ticker.lastPr);

        const baseData = {
            symbol: this.symbol,
            currentPrice,
            priceChange24h: parseFloat(ticker.priceChangePercent || 0),
            volume24h: parseFloat(ticker.volume_24h || ticker.baseVolume || 0),
            timestamp: new Date().toISOString(),
        };

        // 2 POWER AGENTS - each combines multiple data sources
        switch (this.role) {
            case 'technical':
                // TECHNICAL AGENT: RSI, EMA, MACD, Bollinger, ATR
                const candles = await this.weex.getCandles(this.symbol);
                let closes: number[] = [];
                let highs: number[] = [];
                let lows: number[] = [];
                if (Array.isArray(candles)) {
                    closes = candles.map((c: any) => parseFloat(Array.isArray(c) ? c[4] : c.close)).filter(v => v > 0);
                    highs = candles.map((c: any) => parseFloat(Array.isArray(c) ? c[2] : c.high)).filter(v => v > 0);
                    lows = candles.map((c: any) => parseFloat(Array.isArray(c) ? c[3] : c.low)).filter(v => v > 0);
                }
                const rsi = closes.length >= 15 ? calculateRSI(closes, 14) : 50;
                const ema9 = closes.length >= 9 ? calculateEMA(closes, 9) : currentPrice;
                const ema21 = closes.length >= 21 ? calculateEMA(closes, 21) : currentPrice;
                const macd = calculateMACD(closes);
                const bollinger = calculateBollingerBands(closes, 20, 2);
                const atr = calculateATR(highs, lows, closes, 14);
                return {
                    ...baseData,
                    rsi,
                    rsiSignal: rsi < 30 ? 'OVERSOLD_BUY' : rsi > 70 ? 'OVERBOUGHT_SELL' : 'NEUTRAL',
                    ema9,
                    ema21,
                    emaCross: ema9 > ema21 ? 'BULLISH_CROSS' : 'BEARISH_CROSS',
                    macdHistogram: macd.histogram,
                    macdSignal: macd.histogram > 0 ? 'BULLISH' : 'BEARISH',
                    bollingerUpper: bollinger.upper,
                    bollingerLower: bollinger.lower,
                    priceVsBollinger: currentPrice > bollinger.upper ? 'OVERBOUGHT' : currentPrice < bollinger.lower ? 'OVERSOLD' : 'NEUTRAL',
                    atr,
                    volatilityLevel: atr / currentPrice > 0.02 ? 'HIGH' : 'NORMAL'
                };

            case 'structure':
                // STRUCTURE AGENT: Order Book, Funding, Positions, Depth
                const depth = await this.weex.getDepth(this.symbol);
                const rawBids = (depth.bids || []).slice(0, 10);
                const rawAsks = (depth.asks || []).slice(0, 10);
                const bidQty = rawBids.reduce((sum: number, b: any) => sum + parseFloat(b[1] || 0), 0);
                const askQty = rawAsks.reduce((sum: number, a: any) => sum + parseFloat(a[1] || 0), 0);
                const obi = (bidQty + askQty) > 0 ? (bidQty - askQty) / (bidQty + askQty) : 0;
                const spread = rawAsks[0]?.[0] - rawBids[0]?.[0];

                const funding = await this.weex.getFundingRate(this.symbol).catch(() => ({ fundingRate: 0 }));
                const fundingRate = parseFloat(funding.fundingRate || 0);

                const positions = await this.weex.getPositions();
                const assets = await this.weex.getAssets();
                const usdt = assets.find((a: any) => a.coinName === 'USDT');
                const equity = parseFloat(usdt?.equity || usdt?.available || 0);
                const activePositions = positions.filter((p: any) => parseFloat(p.total || 0) > 0);
                const hasPosition = activePositions.some((p: any) => p.symbol?.includes(this.symbol.replace('cmt_', '')));

                return {
                    ...baseData,
                    obi,
                    obiSignal: obi > 0.15 ? 'BUY_PRESSURE' : obi < -0.15 ? 'SELL_PRESSURE' : 'BALANCED',
                    spread,
                    fundingRate,
                    fundingSignal: fundingRate > 0.0001 ? 'SHORTS_FAVORED' : fundingRate < -0.0001 ? 'LONGS_FAVORED' : 'NEUTRAL',
                    equity,
                    hasPosition,
                    positionCount: activePositions.length,
                    canTrade: equity > 100 && activePositions.length < 5
                };

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
                max_tokens: 1024, // Increased for reasoning
                response_format: { type: 'json_object' },
                ...((this.model.includes('gpt-oss') || this.model.includes('Reasoning')) ? { reasoning_effort: 'high' } : {})
            } as any);

            const content = response.choices[0]?.message?.content || '{}';
            return JSON.parse(content);
        } catch (error) {
            return { signal: 'neutral', confidence: 0.5, reasoning: 'API error' };
        }
    }

    private getSystemPrompt(): string {
        const rolePrompts: Record<string, string> = {
            technical: `You are a TECHNICAL ANALYSIS expert for HFT trading. You analyze:
- RSI (Relative Strength Index): <30 = OVERSOLD (BUY), >70 = OVERBOUGHT (SELL)
- EMA Crossover: EMA9 > EMA21 = BULLISH, EMA9 < EMA21 = BEARISH
- MACD Histogram: Positive = BULLISH momentum, Negative = BEARISH momentum
- Bollinger Bands: Price > Upper = OVERBOUGHT, Price < Lower = OVERSOLD
- ATR: High volatility = wider stops, Low volatility = tighter stops

TRADING RULES:
1. If RSI is OVERSOLD + MACD turning positive = STRONG BUY (bullish, 85%+)
2. If RSI is OVERBOUGHT + MACD turning negative = STRONG SELL (bearish, 85%+)
3. If EMA cross aligns with MACD = MEDIUM signal (70%)
4. Conflicting signals = NEUTRAL (50%)

Respond with ONLY valid JSON:
{"signal": "bullish" | "bearish" | "neutral", "confidence": 0.0-1.0, "reasoning": "brief explanation"}`,

            structure: `You are a MARKET STRUCTURE expert for HFT trading. You analyze:
- Order Book Imbalance (OBI): >0.15 = BUY pressure, <-0.15 = SELL pressure
- Funding Rate: Positive = longs pay shorts (go short), Negative = shorts pay longs (go long)
- Position Count: Too many positions = reduce risk
- Equity Level: Must have sufficient margin

TRADING RULES:
1. If OBI shows BUY_PRESSURE + Funding is LONGS_FAVORED = STRONG BUY (bullish, 85%+)
2. If OBI shows SELL_PRESSURE + Funding is SHORTS_FAVORED = STRONG SELL (bearish, 85%+)
3. If signals align but weaker = MEDIUM signal (70%)
4. If canTrade is false = NEUTRAL regardless of other signals
5. Mixed signals = NEUTRAL (50%)

Respond with ONLY valid JSON:
{"signal": "bullish" | "bearish" | "neutral", "confidence": 0.0-1.0, "reasoning": "brief explanation"}`
        };

        return rolePrompts[this.role] || 'Analyze the data and respond with JSON: {"signal": "bullish"|"bearish"|"neutral", "confidence": 0.0-1.0, "reasoning": "explanation"}';
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

        // Start all agents (non-blocking)
        this.agents.forEach(a => a.start().catch(() => { }));

        // Schedule first decision after agents warm up (non-blocking)
        setTimeout(async () => {
            await this.makeDecision().catch(() => { });
        }, 10000); // 10s warmup before first decision

        // Then decide periodically
        this.decisionInterval = setInterval(async () => {
            if (this.isRunning) {
                await this.makeDecision().catch(() => { });
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
            console.log(chalk.magenta(`\n👔 [Lead:${this.symbolShort}] Making decision with ${this.latestReports.size} agent reports...`));

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

Decision guidelines (AGGRESSIVE HFT MODE):
- PREFER ACTION over caution - this is HFT, not buy-and-hold
- If even 2 agents agree on direction: TAKE THE TRADE  
- Strong single signal (>70% confidence) from any agent: ACT on it
- Only "hold" if ALL agents are truly neutral (50-55%)
- Risk agent approval is helpful but NOT required for small positions
- Use larger position sizes (0.02-0.04) when signals align
- "long" or "short" if ANY agent shows confidence > 0.55`;

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
    public lead: LeadCoordinator;
    private config: TradingConfig;
    private intervalMs: number;

    constructor(openai: OpenAI, weex: RustSDKBridge,
        symbol: string,
        model: string = 'mimo-v2-flash',
        intervalMs: number = 20000) {
        super();
        this.openai = openai;
        this.weex = weex;
        this.model = model;
        this.intervalMs = intervalMs;

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

        // 2 POWER AGENTS (instead of 4) - each combines multiple data sources
        const technicalAgent = new IndependentAgent(openai, weex, `TechAgent:${shortSymbol}`, 'technical', symbol, model, this.intervalMs);
        const structureAgent = new IndependentAgent(openai, weex, `StructAgent:${shortSymbol}`, 'structure', symbol, model, this.intervalMs);

        // Add agents to lead
        this.lead.addAgent(technicalAgent);
        this.lead.addAgent(structureAgent);

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
        console.log(chalk.cyan(`   Model: ${this.model}`));
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
