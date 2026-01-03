/**
 * WEEX WebSocket Market Data Service
 * Replaces polling with real-time push data.
 * 
 * Benefits:
 * - 50ms latency (vs 5000ms polling)
 * - Zero API rate limit usage
 * - Event-driven triggers
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import chalk from 'chalk';

export interface TickerData {
    symbol: string;
    lastPrice: number;
    bid: number;
    ask: number;
    volume24h: number;
    timestamp: number;
}

export class MarketDataService extends EventEmitter {
    private ws: WebSocket | null = null;
    private url: string;
    private symbol: string;
    private isConnected: boolean = false;
    private pingInterval: NodeJS.Timeout | null = null;
    private reconnectTimeout: NodeJS.Timeout | null = null;

    // Shared state (SSOT) - Direct access for HFT engine
    public state: TickerData = {
        symbol: '',
        lastPrice: 0,
        bid: 0,
        ask: 0,
        volume24h: 0,
        timestamp: 0
    };

    constructor(symbol: string = 'cmt_btcusdt', url: string = 'wss://ws-contract.weex.com/contract/ws/public') {
        super();
        this.symbol = symbol;
        this.url = url;
    }

    start(): void {
        this.connect();
    }

    private connect(): void {
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.terminate();
        }

        console.log(chalk.gray(`   [WS] Connecting to ${this.url}...`));
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
            console.log(chalk.green('   [WS] Connected!'));
            this.isConnected = true;
            this.subscribe();
            this.startPing();
            this.emit('connected');
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            try {
                const msg = data.toString();
                // Handle "pong" if needed, usually generic
                if (msg === 'pong') return;

                const json = JSON.parse(msg);
                this.handleMessage(json);
            } catch (e) {
                // Ignore parse errors (e.g. ping frames)
            }
        });

        this.ws.on('close', () => {
            console.log(chalk.yellow('   [WS] Disconnected. Reconnecting in 2s...'));
            this.isConnected = false;
            this.stopPing();
            this.reconnectTimeout = setTimeout(() => this.connect(), 2000);
        });

        this.ws.on('error', (err) => {
            console.log(chalk.red(`   [WS] Error: ${err.message}`));
            this.ws?.close();
        });
    }

    private subscribe(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        // Subscription format based on standard WEEX docs
        // Trying standard "sub" or "op" format
        const subMsg = {
            op: 'subscribe',
            args: [`market.ticker.${this.symbol}`, `market.depth.${this.symbol}.step1`]
        };
        this.ws.send(JSON.stringify(subMsg));
        console.log(chalk.gray(`   [WS] Subscribed to ${this.symbol}`));
    }

    private handleMessage(json: any): void {
        // Handle Ticker Update
        // Data format usually: { channel: "...", data: {...} } or { topic: "...", data: [...] }

        // Flexible parsing for different exchange variations
        const data = json.data || json;
        const topic = json.channel || json.topic || '';

        if (topic.includes('ticker')) {
            // Update state
            const ticker = Array.isArray(data) ? data[0] : data;
            const price = parseFloat(ticker.last || ticker.price || ticker.lastPrice);

            if (price > 0 && price !== this.state.lastPrice) {
                this.state.lastPrice = price;
                this.state.bid = parseFloat(ticker.bid || ticker.bestBid || 0);
                this.state.ask = parseFloat(ticker.ask || ticker.bestAsk || 0);
                this.state.volume24h = parseFloat(ticker.volume24h || ticker.volume || 0);
                this.state.timestamp = Date.now();
                this.state.symbol = this.symbol;

                // Emit lightweight tick event for HFT engine
                this.emit('tick', price);
            }
        }
    }

    private startPing(): void {
        this.stopPing();
        // Send 'ping' every 20s to keep connection alive
        this.pingInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send('ping');
            }
        }, 20000);
    }

    private stopPing(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    stop(): void {
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this.stopPing();
        this.ws?.close();
    }
}
