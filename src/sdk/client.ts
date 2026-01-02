/**
 * WEEX SDK for TypeScript
 * Full API implementation for WEEX Exchange
 */

import crypto from 'crypto';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

export interface WeexConfig {
    apiKey: string;
    secretKey: string;
    passphrase: string;
    baseUrl: string;
}

export interface Ticker {
    symbol: string;
    last: string;
    high_24h: string;
    low_24h: string;
    volume_24h: string;
    priceChangePercent: string;
}

export interface Depth {
    asks: [string, string][];
    bids: [string, string][];
}

export interface Candle {
    time: number;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
}

export interface Position {
    symbol: string;
    holdSide: string;
    averageOpenPrice: string;
    total: string;
    unrealizedPL: string;
}

export interface OrderResult {
    order_id: string;
    client_oid: string;
}

export interface AILogInput {
    orderId?: number;
    stage: string;
    model: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    explanation: string;
}

/**
 * WEEX API Client
 */
export class WeexClient {
    private client: AxiosInstance;
    private config: WeexConfig;

    constructor(config: WeexConfig) {
        this.config = config;
        this.client = axios.create({
            baseURL: config.baseUrl,
            headers: {
                'Content-Type': 'application/json',
                'locale': 'en-US',
            },
        });
    }

    private getTimestamp(): string {
        return Date.now().toString();
    }

    private sign(timestamp: string, method: string, path: string, body: string = ''): string {
        const message = timestamp + method.toUpperCase() + path + body;
        const hmac = crypto.createHmac('sha256', this.config.secretKey);
        hmac.update(message);
        return hmac.digest('base64');
    }

    private getAuthHeaders(method: string, path: string, body: string = ''): Record<string, string> {
        const timestamp = this.getTimestamp();
        const signature = this.sign(timestamp, method, path, body);

        return {
            'ACCESS-KEY': this.config.apiKey,
            'ACCESS-SIGN': signature,
            'ACCESS-TIMESTAMP': timestamp,
            'ACCESS-PASSPHRASE': this.config.passphrase,
        };
    }

    private async publicGet<T>(path: string, params?: Record<string, string | number>): Promise<T> {
        const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
        const response = await this.client.get(path + qs);
        return response.data;
    }

    private async authGet<T>(path: string, params?: Record<string, string | number>): Promise<T> {
        const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
        const headers = this.getAuthHeaders('GET', path + qs);
        const response = await this.client.get(path + qs, { headers });
        return response.data;
    }

    private async authPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
        const bodyStr = JSON.stringify(body);
        const headers = this.getAuthHeaders('POST', path, bodyStr);
        const response = await this.client.post(path, body, { headers });
        return response.data;
    }

    // ==================== MARKET API ====================

    async getServerTime(): Promise<{ serverTime: number }> {
        return this.publicGet('/capi/v2/market/time');
    }

    async getContracts(symbol?: string): Promise<unknown[]> {
        return this.publicGet('/capi/v2/market/contracts', symbol ? { symbol } : undefined);
    }

    async getTicker(symbol: string): Promise<Ticker> {
        return this.publicGet('/capi/v2/market/ticker', { symbol });
    }

    async getAllTickers(): Promise<Ticker[]> {
        return this.publicGet('/capi/v2/market/tickers');
    }

    async getDepth(symbol: string, type: string = 'step0'): Promise<Depth> {
        return this.publicGet('/capi/v2/market/depth', { symbol, type });
    }

    async getCandles(symbol: string, granularity: string = '1H', limit: number = 100): Promise<Candle[]> {
        return this.publicGet('/capi/v2/market/candles', { symbol, granularity, limit: limit.toString() });
    }

    async getTrades(symbol: string, limit: number = 100): Promise<unknown[]> {
        return this.publicGet('/capi/v2/market/trades', { symbol, limit: limit.toString() });
    }

    async getIndex(symbol: string): Promise<{ index: string }> {
        return this.publicGet('/capi/v2/market/index', { symbol });
    }

    async getFundingRate(symbol: string): Promise<{ fundingRate: string; fundingTime: string }> {
        return this.publicGet('/capi/v2/market/fundingRate', { symbol });
    }

    async getOpenInterest(symbol: string): Promise<{ openInterestAmount: string }> {
        return this.publicGet('/capi/v2/market/openInterest', { symbol });
    }

    // ==================== ACCOUNT API ====================

    async getAssets(): Promise<unknown[]> {
        return this.authGet('/capi/v2/account/assets');
    }

    async getPosition(symbol: string): Promise<Position> {
        return this.authGet('/capi/v2/account/position/singlePosition', { symbol });
    }

    async getAllPositions(): Promise<Position[]> {
        return this.authGet('/capi/v2/account/position/allPosition');
    }

    async getBills(symbol: string, pageSize: number = 20): Promise<unknown[]> {
        return this.authGet('/capi/v2/account/bills', { symbol, pageSize: pageSize.toString() });
    }

    async setLeverage(symbol: string, leverage: number): Promise<unknown> {
        return this.authPost('/capi/v2/account/leverage', {
            symbol,
            marginMode: '1',
            longLeverage: leverage.toString(),
            shortLeverage: leverage.toString(),
        });
    }

    async setMarginMode(symbol: string, mode: string): Promise<unknown> {
        return this.authPost('/capi/v2/account/setMarginMode', { symbol, marginMode: mode });
    }

    async adjustMargin(symbol: string, amount: string, holdSide: string): Promise<unknown> {
        return this.authPost('/capi/v2/account/adjustPositionMargin', { symbol, amount, holdSide });
    }

    // ==================== TRADE API ====================

    async placeOrder(
        symbol: string,
        size: string,
        side: number,
        orderType: number = 1,
        price?: string,
        clientOid?: string
    ): Promise<OrderResult> {
        const body: Record<string, string> = {
            symbol,
            size,
            type: side.toString(),
            order_type: orderType.toString(),
            match_price: orderType === 1 ? '1' : '0',
            client_oid: clientOid || Date.now().toString(),
        };

        if (price && orderType === 0) {
            body.price = price;
        }

        return this.authPost('/capi/v2/order/placeOrder', body);
    }

    async cancelOrder(symbol: string, orderId: string): Promise<unknown> {
        return this.authPost('/capi/v2/order/cancelOrder', { symbol, orderId });
    }

    async cancelAllOrders(symbol: string): Promise<unknown> {
        return this.authPost('/capi/v2/order/cancelAllOrders', { symbol });
    }

    async getOrderDetail(symbol: string, orderId: string): Promise<unknown> {
        return this.authGet('/capi/v2/order/detail', { symbol, orderId });
    }

    async getOrderHistory(symbol: string, pageSize: number = 20): Promise<unknown[]> {
        return this.authGet('/capi/v2/order/history', { symbol, pageSize: pageSize.toString() });
    }

    async getCurrentOrders(symbol: string): Promise<unknown[]> {
        return this.authGet('/capi/v2/order/current', { symbol });
    }

    async getFills(symbol: string): Promise<unknown[]> {
        return this.authGet('/capi/v2/order/fills', { symbol });
    }

    async placeTriggerOrder(
        symbol: string,
        size: string,
        side: number,
        triggerPrice: string,
        triggerType: string = 'fill_price'
    ): Promise<unknown> {
        return this.authPost('/capi/v2/order/placeTriggerOrder', {
            symbol,
            size,
            type: side.toString(),
            triggerPrice,
            triggerBy: triggerType,
            orderType: '1',
        });
    }

    async cancelTriggerOrder(symbol: string, orderId: string): Promise<unknown> {
        return this.authPost('/capi/v2/order/cancelTriggerOrder', { symbol, orderId });
    }

    async closeAllPositions(symbol: string): Promise<unknown> {
        return this.authPost('/capi/v2/order/closeAllPositions', { symbol });
    }

    async placeTPSL(
        symbol: string,
        holdSide: string,
        takeProfitPrice?: string,
        stopLossPrice?: string
    ): Promise<unknown> {
        const body: Record<string, string> = { symbol, holdSide };
        if (takeProfitPrice) body.takeProfitPrice = takeProfitPrice;
        if (stopLossPrice) body.stopLossPrice = stopLossPrice;
        return this.authPost('/capi/v2/order/placeTPSL', body);
    }

    // ==================== AI LOG API ====================

    async uploadAILog(log: AILogInput): Promise<{ code: string; msg: string; data: string }> {
        return this.authPost('/capi/v2/order/uploadAiLog', {
            orderId: log.orderId,
            stage: log.stage,
            model: log.model,
            input: log.input,
            output: log.output,
            explanation: log.explanation.slice(0, 1000),
        });
    }
}

/**
 * Create WEEX client from environment variables
 */
export function createWeexClient(): WeexClient {
    const config: WeexConfig = {
        apiKey: process.env.WEEX_API_KEY || '',
        secretKey: process.env.WEEX_SECRET_KEY || '',
        passphrase: process.env.WEEX_PASSPHRASE || '',
        baseUrl: process.env.WEEX_BASE_URL || 'https://api-contract.weex.com',
    };

    if (!config.apiKey || !config.secretKey || !config.passphrase) {
        throw new Error('Missing WEEX API credentials in environment');
    }

    return new WeexClient(config);
}
