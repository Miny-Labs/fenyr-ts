/**
 * Trading Tools
 * Zod-validated tool definitions for GPT function calling
 */

import { z } from 'zod';

// Tool schemas for validation
export const MarketDataSchema = z.object({
    symbol: z.string().describe('Trading pair (e.g., cmt_btcusdt)'),
});

export const TechnicalIndicatorsSchema = z.object({
    symbol: z.string().describe('Trading pair'),
    indicators: z.array(z.enum(['rsi', 'ema_20', 'ema_50', 'macd', 'bollinger'])).describe('Indicators to calculate'),
});

export const ExecuteTradeSchema = z.object({
    symbol: z.string().describe('Trading pair'),
    action: z.enum(['open_long', 'close_long', 'open_short', 'close_short']).describe('Trade action'),
    size: z.string().describe('Position size in base currency'),
    confidence: z.number().min(0).max(1).describe('Confidence level 0-1'),
    reasoning: z.string().describe('Detailed reasoning for the trade'),
});

export const RiskAssessmentSchema = z.object({
    symbol: z.string().describe('Trading pair'),
    proposedAction: z.enum(['buy', 'sell', 'hold']).describe('Proposed action'),
    proposedSize: z.string().describe('Proposed position size'),
});

// OpenAI tool definitions
export const TRADING_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'get_market_data',
            description: 'Get current market data including price, orderbook, volume. Use to understand market conditions.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Trading pair (e.g., cmt_btcusdt)' },
                },
                required: ['symbol'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'get_technical_indicators',
            description: 'Calculate RSI, EMA, MACD from price data. Use for technical analysis signals.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Trading pair' },
                    indicators: {
                        type: 'array',
                        items: { type: 'string', enum: ['rsi', 'ema_20', 'ema_50', 'macd', 'bollinger'] },
                        description: 'Indicators to calculate',
                    },
                },
                required: ['symbol', 'indicators'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'get_account_status',
            description: 'Get account balance, equity, and open positions. Check capital and exposure.',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'get_funding_rate',
            description: 'Get current funding rate for futures. Useful for funding arbitrage.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Trading pair' },
                },
                required: ['symbol'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'get_open_interest',
            description: 'Get open interest data. Indicates market positioning.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Trading pair' },
                },
                required: ['symbol'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'get_order_history',
            description: 'Get recent order history. Review past trades.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Trading pair' },
                    limit: { type: 'number', description: 'Max orders to return' },
                },
                required: ['symbol'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'execute_trade',
            description: 'Execute a market order. Only use when confident (>0.7). Must provide reasoning.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Trading pair' },
                    action: { type: 'string', enum: ['open_long', 'close_long', 'open_short', 'close_short'] },
                    size: { type: 'string', description: 'Position size' },
                    confidence: { type: 'number', description: 'Confidence 0-1' },
                    reasoning: { type: 'string', description: 'Trade reasoning' },
                },
                required: ['symbol', 'action', 'size', 'confidence', 'reasoning'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'set_leverage',
            description: 'Set leverage for a symbol. Max 20x for competition.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Trading pair' },
                    leverage: { type: 'number', description: 'Leverage (1-20)' },
                },
                required: ['symbol', 'leverage'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'place_trigger_order',
            description: 'Place a trigger/stop order. For stop-loss or take-profit.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Trading pair' },
                    size: { type: 'string', description: 'Order size' },
                    side: { type: 'number', description: '1=open_long, 3=open_short' },
                    triggerPrice: { type: 'string', description: 'Price to trigger at' },
                },
                required: ['symbol', 'size', 'side', 'triggerPrice'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'close_all_positions',
            description: 'Close all open positions for a symbol. Emergency exit.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Trading pair' },
                },
                required: ['symbol'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'send_message_to_agent',
            description: 'Send a message to another agent for collaboration. Multi-agent communication.',
            parameters: {
                type: 'object',
                properties: {
                    targetAgent: { type: 'string', enum: ['market_analyst', 'sentiment', 'risk_manager', 'executor'] },
                    message: { type: 'string', description: 'Message content' },
                    context: { type: 'object', description: 'Additional context' },
                },
                required: ['targetAgent', 'message'],
            },
        },
    },
];

// Action to side mapping
export const ACTION_TO_SIDE: Record<string, number> = {
    open_long: 1,
    close_short: 2,
    open_short: 3,
    close_long: 4,
};
