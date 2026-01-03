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

    constructor(symbol: string = 'cmt_btcusdt', url: string = 'wss://ws-spot.weex.com/v2/ws/public') {
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

        // Spot usually uses BTCUSDT, futures uses cmt_btcusdt
        // Try subscribing to both formats just in case
        const spotSymbol = this.symbol.replace('cmt_', '').toUpperCase();

        // Subscription format for Spot
        const subMsg = {
            op: 'subscribe',
            args: [
                { channel: 'ticker', instId: spotSymbol },
                { channel: 'candle1m', instId: spotSymbol }
            ]
        };
        this.ws.send(JSON.stringify(subMsg));
        console.log(chalk.gray(`   [WS] Subscribed to ${spotSymbol}`));
    }

    private handleMessage(json: any): void {
        // WEEX Spot WS format: { action: "push", arg: { channel: "ticker", instId: "BTCUSDT" }, data: [...] }

        if (json.action === 'push' && json.data) {
            const topic = json.arg?.channel || '';
            const data = json.data[0];

            if (topic === 'ticker' || topic === 'candle1m') {
                const price = parseFloat(data.last || data.close || data.idxPx || 0);

                if (price > 0 && price !== this.state.lastPrice) {
                    this.state.lastPrice = price;
                    this.state.bid = parseFloat(data.bidPx || 0);
                    this.state.ask = parseFloat(data.askPx || 0);
                    this.state.volume24h = parseFloat(data.vol24h || 0);
                    this.state.timestamp = parseInt(data.ts || Date.now());
                    this.state.symbol = this.symbol;

                    this.emit('tick', price);
                }
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
