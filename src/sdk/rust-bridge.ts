/**
 * Rust SDK Bridge v2
 * Calls the weex-cli binary (built from Rust SDK) for all WEEX operations
 * 
 * This provides native Rust performance with TypeScript integration.
 */

import { execSync } from 'child_process';

const CLI_PATH = process.env.WEEX_CLI_PATH || '/usr/local/bin/weex-cli';

export interface RustSDKConfig {
    apiKey: string;
    secretKey: string;
    passphrase: string;
    baseUrl: string;
}

interface CLIResult {
    success: boolean;
    data?: any;
    error?: string;
}

/**
 * Execute Rust CLI command and return parsed JSON result
 */
function execRustCLI(command: string, args: string[] = []): CLIResult {
    const env = {
        ...process.env,
        WEEX_API_KEY: process.env.WEEX_API_KEY,
        WEEX_SECRET_KEY: process.env.WEEX_SECRET_KEY,
        WEEX_PASSPHRASE: process.env.WEEX_PASSPHRASE,
        WEEX_BASE_URL: process.env.WEEX_BASE_URL || 'https://api-contract.weex.com',
    };

    const cmd = `${CLI_PATH} ${command} ${args.join(' ')}`;

    try {
        const output = execSync(cmd, {
            env,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024, // 10MB
            timeout: 30000, // 30s timeout
        });

        return JSON.parse(output.trim());
    } catch (error: any) {
        // Try to parse error output
        if (error.stdout) {
            try {
                return JSON.parse(error.stdout.trim());
            } catch {
                // Fall through
            }
        }
        return { success: false, error: error.message || 'CLI execution failed' };
    }
}

export interface RustSDKBridge {
    getTicker(symbol: string): Promise<any>;
    getDepth(symbol: string): Promise<any>;
    getCandles(symbol: string, granularity?: string, limit?: number): Promise<any>;
    getFundingRate(symbol: string): Promise<any>;
    getAssets(): Promise<any>;
    getPositions(): Promise<any>;
    getOrderHistory(symbol: string): Promise<any>;
    placeOrder(symbol: string, side: number, size: number): Promise<any>;
    uploadAILog(log: any): Promise<any>;
}

export function createRustSDKBridge(): RustSDKBridge {
    return {
        async getTicker(symbol: string): Promise<any> {
            const result = execRustCLI('ticker', ['--symbol', symbol]);
            if (!result.success) throw new Error(result.error);
            return result.data;
        },

        async getDepth(symbol: string): Promise<any> {
            const result = execRustCLI('depth', ['--symbol', symbol]);
            if (!result.success) throw new Error(result.error);
            return result.data;
        },

        async getCandles(symbol: string, granularity = '1H', limit = 50): Promise<any> {
            const result = execRustCLI('candles', [
                '--symbol', symbol,
                '--granularity', granularity,
                '--limit', limit.toString()
            ]);
            if (!result.success) throw new Error(result.error);
            return result.data;
        },

        async getFundingRate(symbol: string): Promise<any> {
            const result = execRustCLI('funding', ['--symbol', symbol]);
            if (!result.success) throw new Error(result.error);
            return result.data;
        },

        async getAssets(): Promise<any> {
            const result = execRustCLI('assets', []);
            if (!result.success) throw new Error(result.error);
            // Parse if string
            if (typeof result.data === 'string') {
                try {
                    return JSON.parse(result.data);
                } catch {
                    return result.data;
                }
            }
            return Array.isArray(result.data) ? result.data : [result.data];
        },

        async getPositions(): Promise<any> {
            const result = execRustCLI('positions', []);
            if (!result.success) throw new Error(result.error);
            return result.data;
        },

        async getOrderHistory(symbol: string): Promise<any> {
            const result = execRustCLI('order-history', ['--symbol', symbol]);
            if (!result.success) throw new Error(result.error);
            return result.data;
        },

        async placeOrder(symbol: string, side: number, size: number): Promise<any> {
            // Convert WEEX side numbers to CLI strings
            // 1=open_long (buy), 2=close_short (buy), 3=open_short (sell), 4=close_long (sell)
            const sideStr = (side === 1 || side === 2) ? 'buy' : 'sell';
            const result = execRustCLI('order', [
                '--symbol', symbol,
                '--side', sideStr,
                '--size', size.toString()
            ]);
            if (!result.success) throw new Error(result.error);
            return result.data;
        },

        async uploadAILog(log: any): Promise<any> {
            // Write JSON to temp file to avoid shell escaping issues
            const fs = require('fs');
            const path = require('path');
            const tempDir = '/tmp';
            const tempFile = path.join(tempDir, `weex_ai_log_${Date.now()}.json`);

            try {
                // Prepare log data
                const logData = {
                    stage: log.stage || 'Decision Making',
                    model: log.model || 'gpt-5.2',
                    input: log.input || {},
                    output: log.output || {},
                    explanation: log.explanation || 'AI decision made'
                };
                if (log.orderId) {
                    (logData as any).orderId = log.orderId;
                }

                // Write to temp file
                fs.writeFileSync(tempFile, JSON.stringify(logData));

                // Call CLI with file path
                const inputJson = JSON.stringify(logData.input).replace(/'/g, "'\\''");
                const outputJson = JSON.stringify(logData.output).replace(/'/g, "'\\''");
                const explanation = (logData.explanation || '').substring(0, 500).replace(/'/g, "'\\''").replace(/\n/g, ' ');

                const result = execRustCLI('ai-log', [
                    '--stage', logData.stage,
                    '--model', logData.model,
                    '--input', `'${inputJson}'`,
                    '--output', `'${outputJson}'`,
                    '--explanation', `'${explanation}'`
                ]);

                // Cleanup
                try { fs.unlinkSync(tempFile); } catch { }

                return result;
            } catch (error: any) {
                console.log(`   ⚠️ AI log upload failed: ${error.message}`);
                try { fs.unlinkSync(tempFile); } catch { }
                return { success: false, error: error.message };
            }
        }
    };
}
