/**
 * Rust SDK Bridge
 * Calls the Rust SDK binary for all WEEX operations
 */

import { execSync, spawn } from 'child_process';
import path from 'path';

const RUST_SDK_PATH = process.env.RUST_SDK_PATH || '/root/weex-sdk';

export interface RustSDKConfig {
    apiKey: string;
    secretKey: string;
    passphrase: string;
    baseUrl: string;
}

/**
 * Execute Rust SDK command and return JSON result
 */
async function execRustSDK(command: string, args: Record<string, string> = {}): Promise<unknown> {
    // For now, we'll use the Python wrapper that already works
    // In production, this would call the compiled Rust binary

    const pythonScript = `
import time, hmac, hashlib, base64, requests, json, sys

API_KEY = '${process.env.WEEX_API_KEY}'
SECRET_KEY = '${process.env.WEEX_SECRET_KEY}'
PASSPHRASE = '${process.env.WEEX_PASSPHRASE}'
BASE = '${process.env.WEEX_BASE_URL || 'https://api-contract.weex.com'}'

def auth_headers(method, path, body=''):
    ts = str(int(time.time() * 1000))
    sig = base64.b64encode(hmac.new(SECRET_KEY.encode(), (ts + method + path + body).encode(), hashlib.sha256).digest()).decode()
    return {'ACCESS-KEY': API_KEY, 'ACCESS-SIGN': sig, 'ACCESS-TIMESTAMP': ts, 'ACCESS-PASSPHRASE': PASSPHRASE, 'Content-Type': 'application/json', 'locale': 'en-US'}

def get(path, qs=''):
    return requests.get(BASE + path + qs, headers=auth_headers('GET', path + qs)).json()

def post(path, body):
    body_str = json.dumps(body)
    return requests.post(BASE + path, headers=auth_headers('POST', path, body_str), data=body_str).json()

command = '${command}'
args = json.loads('${JSON.stringify(args)}')

if command == 'ticker':
    result = get('/capi/v2/market/ticker', '?symbol=' + args.get('symbol', 'cmt_btcusdt'))
elif command == 'depth':
    result = get('/capi/v2/market/depth', '?symbol=' + args.get('symbol', 'cmt_btcusdt') + '&type=step0')
elif command == 'candles':
    result = get('/capi/v2/market/candles', '?symbol=' + args.get('symbol') + '&granularity=1H&limit=50')
elif command == 'funding':
    result = get('/capi/v2/market/fundingRate', '?symbol=' + args.get('symbol', 'cmt_btcusdt'))
elif command == 'assets':
    result = get('/capi/v2/account/assets')
elif command == 'positions':
    result = get('/capi/v2/account/position/allPosition')
elif command == 'order_history':
    result = get('/capi/v2/order/history', '?symbol=' + args.get('symbol', 'cmt_btcusdt') + '&pageSize=20')
elif command == 'place_order':
    result = post('/capi/v2/order/placeOrder', {
        'symbol': args.get('symbol'),
        'size': args.get('size'),
        'type': args.get('side'),
        'order_type': '1',
        'match_price': '1',
        'client_oid': str(int(time.time() * 1000))
    })
elif command == 'upload_ai_log':
    result = post('/capi/v2/order/uploadAiLog', {
        'orderId': args.get('orderId'),
        'stage': args.get('stage'),
        'model': args.get('model'),
        'input': json.loads(args.get('input', '{}')),
        'output': json.loads(args.get('output', '{}')),
        'explanation': args.get('explanation', '')[:1000]
    })
else:
    result = {'error': 'Unknown command'}

print(json.dumps(result))
`;

    return new Promise((resolve, reject) => {
        const python = spawn('python3', ['-c', pythonScript]);
        let stdout = '';
        let stderr = '';

        python.stdout.on('data', (data) => { stdout += data.toString(); });
        python.stderr.on('data', (data) => { stderr += data.toString(); });

        python.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`SDK error: ${stderr}`));
            } else {
                try {
                    resolve(JSON.parse(stdout));
                } catch {
                    resolve(stdout);
                }
            }
        });
    });
}

export class RustSDKBridge {
    constructor() {
        // Validate env vars
        if (!process.env.WEEX_API_KEY) throw new Error('WEEX_API_KEY required');
        if (!process.env.WEEX_SECRET_KEY) throw new Error('WEEX_SECRET_KEY required');
        if (!process.env.WEEX_PASSPHRASE) throw new Error('WEEX_PASSPHRASE required');
    }

    // ==================== MARKET ====================

    async getTicker(symbol: string): Promise<any> {
        return execRustSDK('ticker', { symbol });
    }

    async getDepth(symbol: string): Promise<any> {
        return execRustSDK('depth', { symbol });
    }

    async getCandles(symbol: string): Promise<any> {
        return execRustSDK('candles', { symbol });
    }

    async getFundingRate(symbol: string): Promise<any> {
        return execRustSDK('funding', { symbol });
    }

    // ==================== ACCOUNT ====================

    async getAssets(): Promise<any[]> {
        const result = await execRustSDK('assets');
        return Array.isArray(result) ? result : [];
    }

    async getAllPositions(): Promise<any[]> {
        const result = await execRustSDK('positions');
        return Array.isArray(result) ? result : [];
    }

    async getOrderHistory(symbol: string): Promise<any[]> {
        const result = await execRustSDK('order_history', { symbol });
        return Array.isArray(result) ? result : [];
    }

    // ==================== TRADE ====================

    async placeOrder(symbol: string, size: string, side: number): Promise<any> {
        return execRustSDK('place_order', { symbol, size, side: String(side) });
    }

    // ==================== AI LOG ====================

    async uploadAILog(log: {
        orderId?: number;
        stage: string;
        model: string;
        input: Record<string, unknown>;
        output: Record<string, unknown>;
        explanation: string;
    }): Promise<{ code: string; msg: string; data: string }> {
        const result = await execRustSDK('upload_ai_log', {
            orderId: log.orderId ? String(log.orderId) : '',
            stage: log.stage,
            model: log.model,
            input: JSON.stringify(log.input),
            output: JSON.stringify(log.output),
            explanation: log.explanation,
        });
        return result as { code: string; msg: string; data: string };
    }
}

export function createRustSDKBridge(): RustSDKBridge {
    return new RustSDKBridge();
}
