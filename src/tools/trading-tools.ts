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
    // ==================== ADVANCED QUANT TOOLS ====================
    {
        type: 'function' as const,
        function: {
            name: 'calculate_obi',
            description: 'Calculate Order Book Imbalance (OBI). Measures buy vs sell pressure. OBI > 0.15 = bullish, OBI < -0.15 = bearish. 56-58% accuracy for short-term direction.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Trading pair' },
                    levels: { type: 'number', description: 'Number of orderbook levels (default 10)' },
                },
                required: ['symbol'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'calculate_vpin',
            description: 'Calculate VPIN (Volume-Synchronized Probability of Informed Trading). Detects toxic flow. VPIN > 0.7 = high volatility expected, avoid trading. VPIN < 0.3 = safe to trade.',
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
            name: 'get_kelly_size',
            description: 'Calculate optimal position size using Kelly Criterion. Based on win rate and avg win/loss from trade history. Returns recommended position as percentage of equity.',
            parameters: {
                type: 'object',
                properties: {
                    accountEquity: { type: 'number', description: 'Total account equity in USD' },
                    currentPrice: { type: 'number', description: 'Current asset price' },
                },
                required: ['accountEquity', 'currentPrice'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'analyze_open_interest',
            description: 'Analyze Open Interest trend. Rising price + rising OI = strong bullish. Falling price + falling OI = capitulation (potential bottom). Use for trend confirmation.',
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
            name: 'get_funding_arbitrage',
            description: 'Analyze funding rate arbitrage opportunity. High positive funding = go short perp. High negative funding = go long perp. Returns expected return and annualized yield.',
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
            name: 'check_liquidation_risk',
            description: 'Check if price is near liquidation clusters. Helps identify potential cascade events and smart entry/exit points.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Trading pair' },
                    currentPrice: { type: 'number', description: 'Current price' },
                    leverage: { type: 'number', description: 'Typical leverage used' },
                },
                required: ['symbol', 'currentPrice'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'get_execution_recommendation',
            description: 'Get smart order execution recommendation. Analyzes market conditions and suggests TWAP, VWAP, iceberg, or market order based on size and liquidity.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Trading pair' },
                    orderSize: { type: 'number', description: 'Order size in base currency' },
                },
                required: ['symbol', 'orderSize'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'execute_twap',
            description: 'Execute order using TWAP (Time-Weighted Average Price). Splits order evenly over time to reduce market impact. Good for large orders.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Trading pair' },
                    side: { type: 'string', enum: ['buy', 'sell'], description: 'Order side' },
                    totalSize: { type: 'number', description: 'Total order size' },
                    durationMinutes: { type: 'number', description: 'Duration to execute over' },
                },
                required: ['symbol', 'side', 'totalSize', 'durationMinutes'],
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
