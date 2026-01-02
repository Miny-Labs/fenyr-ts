/**
 * WebSocket Client for Real-Time Market Data
 * Event-driven architecture with ring buffer
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

// All 8 WEEX trading pairs
export const WEEX_PAIRS = [
    'cmt_btcusdt',
    'cmt_ethusdt',
    'cmt_solusdt',
    'cmt_dogeusdt',
    'cmt_xrpusdt',
    'cmt_adausdt',
    'cmt_bnbusdt',
    'cmt_ltcusdt',
] as const;

export type WeexPair = typeof WEEX_PAIRS[number];

export interface TickerUpdate {
    symbol: WeexPair;
    last: number;
    high24h: number;
    low24h: number;
    volume24h: number;
    change24h: number;
    timestamp: number;
}

export interface DepthUpdate {
    symbol: WeexPair;
    bids: [number, number][]; // [price, qty]
    asks: [number, number][];
    timestamp: number;
}

export interface TradeUpdate {
    symbol: WeexPair;
    price: number;
    size: number;
    side: 'buy' | 'sell';
    timestamp: number;
}

// Ring buffer for efficient data storage
export class RingBuffer<T> {
    private buffer: (T | undefined)[];
    private head: number = 0;
    private tail: number = 0;
    private size: number = 0;
    private capacity: number;

    constructor(capacity: number) {
        // Round up to power of 2 for bitwise modulo
        this.capacity = Math.pow(2, Math.ceil(Math.log2(capacity)));
        this.buffer = new Array(this.capacity);
    }

    push(item: T): void {
        this.buffer[this.tail] = item;
        this.tail = (this.tail + 1) & (this.capacity - 1); // Bitwise modulo

        if (this.size < this.capacity) {
            this.size++;
        } else {
            this.head = (this.head + 1) & (this.capacity - 1);
        }
    }

    getAll(): T[] {
        const result: T[] = [];
        for (let i = 0; i < this.size; i++) {
            const idx = (this.head + i) & (this.capacity - 1);
            if (this.buffer[idx] !== undefined) {
                result.push(this.buffer[idx]!);
            }
        }
        return result;
    }

    getLast(n: number): T[] {
        const count = Math.min(n, this.size);
        const result: T[] = [];
        for (let i = this.size - count; i < this.size; i++) {
            const idx = (this.head + i) & (this.capacity - 1);
            if (this.buffer[idx] !== undefined) {
                result.push(this.buffer[idx]!);
            }
        }
        return result;
    }

    getSize(): number {
        return this.size;
    }

    clear(): void {
        this.buffer = new Array(this.capacity);
        this.head = 0;
        this.tail = 0;
        this.size = 0;
    }
}

export interface MarketDataStore {
    tickers: Map<WeexPair, TickerUpdate>;
    depths: Map<WeexPair, DepthUpdate>;
    trades: Map<WeexPair, RingBuffer<TradeUpdate>>;
    prices: Map<WeexPair, RingBuffer<number>>;
}

export class WeexWebSocket extends EventEmitter {
    private ws: WebSocket | null = null;
    private wsUrl: string;
    private isConnected: boolean = false;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 10;
    private pingInterval: NodeJS.Timeout | null = null;

    public data: MarketDataStore;

    constructor(wsUrl: string = 'wss://contract.weex.com/ws/v1/public') {
        super();
        this.wsUrl = wsUrl;

        // Initialize data store
        this.data = {
            tickers: new Map(),
            depths: new Map(),
            trades: new Map(),
            prices: new Map(),
        };

        // Initialize buffers for each pair
        for (const pair of WEEX_PAIRS) {
            this.data.trades.set(pair, new RingBuffer(1000));
            this.data.prices.set(pair, new RingBuffer(500));
        }
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.wsUrl);

                this.ws.on('open', () => {
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    console.log('✅ WebSocket connected');

                    // Subscribe to all pairs
                    this.subscribeAll();

                    // Start ping/pong
                    this.startPing();

                    this.emit('connected');
                    resolve();
                });

                this.ws.on('message', (data: WebSocket.Data) => {
                    this.handleMessage(data.toString());
                });

                this.ws.on('close', () => {
                    this.isConnected = false;
                    console.log('⚠️ WebSocket disconnected');
                    this.emit('disconnected');
                    this.attemptReconnect();
                });

                this.ws.on('error', (error: Error) => {
                    console.error('❌ WebSocket error:', error.message);
                    this.emit('error', error);
                    if (!this.isConnected) reject(error);
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    private subscribeAll(): void {
        // Subscribe to tickers for all pairs
        for (const pair of WEEX_PAIRS) {
            this.send({
                op: 'subscribe',
                args: [`ticker:${pair}`],
            });

            this.send({
                op: 'subscribe',
                args: [`depth5:${pair}`],
            });

            this.send({
                op: 'subscribe',
                args: [`trade:${pair}`],
            });
        }
    }

    private handleMessage(rawData: string): void {
        try {
            const msg = JSON.parse(rawData);

            // Ping/pong
            if (msg.event === 'pong') {
                return;
            }

            // Handle ticker updates
            if (msg.arg?.channel?.startsWith('ticker')) {
                this.handleTicker(msg);
            }

            // Handle depth updates
            if (msg.arg?.channel?.startsWith('depth')) {
                this.handleDepth(msg);
            }

            // Handle trade updates
            if (msg.arg?.channel?.startsWith('trade')) {
                this.handleTrade(msg);
            }

        } catch (error) {
            // Silent parse errors for non-JSON messages
        }
    }

    private handleTicker(msg: any): void {
        const data = msg.data?.[0];
        if (!data) return;

        const symbol = msg.arg?.instId as WeexPair;
        if (!WEEX_PAIRS.includes(symbol)) return;

        const ticker: TickerUpdate = {
            symbol,
            last: parseFloat(data.last || data.lastPr),
            high24h: parseFloat(data.high24h || 0),
            low24h: parseFloat(data.low24h || 0),
            volume24h: parseFloat(data.vol24h || data.baseVolume || 0),
            change24h: parseFloat(data.change24h || data.changeUtc24h || 0),
            timestamp: Date.now(),
        };

        this.data.tickers.set(symbol, ticker);
        this.data.prices.get(symbol)?.push(ticker.last);

        this.emit('ticker', ticker);
    }

    private handleDepth(msg: any): void {
        const data = msg.data?.[0];
        if (!data) return;

        const symbol = msg.arg?.instId as WeexPair;
        if (!WEEX_PAIRS.includes(symbol)) return;

        const depth: DepthUpdate = {
            symbol,
            bids: (data.bids || []).map((b: string[]) => [parseFloat(b[0]), parseFloat(b[1])]),
            asks: (data.asks || []).map((a: string[]) => [parseFloat(a[0]), parseFloat(a[1])]),
            timestamp: Date.now(),
        };

        this.data.depths.set(symbol, depth);
        this.emit('depth', depth);
    }

    private handleTrade(msg: any): void {
        const trades = msg.data;
        if (!Array.isArray(trades)) return;

        const symbol = msg.arg?.instId as WeexPair;
        if (!WEEX_PAIRS.includes(symbol)) return;

        for (const t of trades) {
            const trade: TradeUpdate = {
                symbol,
                price: parseFloat(t.px || t.price),
                size: parseFloat(t.sz || t.size),
                side: t.side === 'buy' ? 'buy' : 'sell',
                timestamp: parseInt(t.ts) || Date.now(),
            };

            this.data.trades.get(symbol)?.push(trade);
            this.emit('trade', trade);
        }
    }

    private send(data: object): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    private startPing(): void {
        this.pingInterval = setInterval(() => {
            this.send({ op: 'ping' });
        }, 25000);
    }

    private attemptReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('❌ Max reconnect attempts reached');
            this.emit('max_reconnects');
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

        console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(() => {
            this.connect().catch(console.error);
        }, delay);
    }

    disconnect(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
    }

    getLatestPrice(symbol: WeexPair): number | undefined {
        return this.data.tickers.get(symbol)?.last;
    }

    getPriceHistory(symbol: WeexPair, count: number = 100): number[] {
        return this.data.prices.get(symbol)?.getLast(count) || [];
    }

    getRecentTrades(symbol: WeexPair, count: number = 100): TradeUpdate[] {
        return this.data.trades.get(symbol)?.getLast(count) || [];
    }

    getOrderBook(symbol: WeexPair): DepthUpdate | undefined {
        return this.data.depths.get(symbol);
    }
}

export default WeexWebSocket;
