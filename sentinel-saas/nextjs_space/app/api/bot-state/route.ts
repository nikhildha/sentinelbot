import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';

// ─── Engine API URL (Railway internal) or local file fallback ────────────────
const ENGINE_API_URL = process.env.ENGINE_API_URL; // e.g. http://sentinelbot-engine.railway.internal:3001

// Sentinelbot reads directly from its own data/ folder (local dev)
const DATA_DIR = path.resolve(process.cwd(), '..', '..', 'data');

function readJSON(filename: string, fallback: any = {}) {
    try {
        const filepath = path.join(DATA_DIR, filename);
        if (fs.existsSync(filepath)) {
            return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
        }
    } catch { /* silent */ }
    return fallback;
}

async function fetchEngineData() {
    if (!ENGINE_API_URL) return null;
    try {
        const res = await fetch(`${ENGINE_API_URL}/api/all`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(8000),
        });
        if (res.ok) return await res.json();
    } catch (err) {
        console.error('[bot-state] Engine API fetch failed:', err);
    }
    return null;
}

export async function GET() {
    try {
        // Get session to filter trades by user
        const session = await getServerSession(authOptions);
        const userId = (session?.user as any)?.id;
        const isAdmin = (session?.user as any)?.role === 'admin';

        // Try fetching from engine API first (production), fall back to local files
        const engineData = await fetchEngineData();

        let multi: any, tradebook: any, engineState: any;

        if (engineData) {
            // Production: data from engine Express API
            multi = engineData.multi || {};
            tradebook = engineData.tradebook || { trades: [], summary: {} };
            engineState = engineData.engine || { status: 'running' };
        } else {
            // Local dev: read from filesystem
            multi = readJSON('multi_bot_state.json', {
                coin_states: {},
                last_analysis_time: null,
                analysis_interval_seconds: 300,
                deployed_count: 0,
            });
            tradebook = readJSON('tradebook.json', { trades: [], stats: {} });
            engineState = readJSON('engine_state.json', { status: 'stopped' });
        }

        // Build the response shape that the dashboard expects
        const coinStates = multi.coin_states || {};
        const allTrades = tradebook.trades || [];

        // Filter trades by user: for now, single-engine setup — all authenticated users see all trades
        // Engine-side user_ids don't match SaaS Prisma user IDs, so we can't filter by userId
        // Filter trades by user
        let trades: any[];
        if (session) {
            // Strictly filter by user_id to prevent data leakage
            // Trades without user_id are considered "system" or "legacy" and only visible to admin if needed
            // But for safety, we default to showing ONLY what matches the user ID
            // If user is admin and wants to see everything, we could add specific logic, 
            // but the request is about isolation.

            // Note: tradebook trades from engine might have user_id if configured
            trades = allTrades.filter((t: any) => t.user_id === userId);

            // Fallback: If no trades match user_id (e.g. legacy system), and user is admin, 
            // maybe we want to show them? For now, strict isolation is safer.
            // If the admin is running the bot, the bot should be configured with their user_id.
        } else {
            trades = [];
        }

        const activeTrades = trades.filter((t: any) => (t.status || '').toUpperCase() === 'ACTIVE');

        // Filter active_positions in multi-state to match the user's active trades
        // multi.active_positions is keyed by symbol
        // We only keep symbols that the user has an ACTIVE trade for
        const userActiveSymbols = new Set(activeTrades.map((t: any) => t.symbol));

        const allActivePositions = multi.active_positions || {};
        const filteredActivePositions = Object.fromEntries(
            Object.entries(allActivePositions).filter(([sym, _]) => userActiveSymbols.has(sym))
        );

        return NextResponse.json({
            state: {
                regime: multi.macro_regime || coinStates?.BTCUSDT?.regime || 'WAITING',
                confidence: coinStates?.BTCUSDT?.confidence || 0,
                symbol: 'BTCUSDT',
                btc_price: coinStates?.BTCUSDT?.price || null,
                timestamp: multi.last_analysis_time || multi.timestamp || null,
            },
            multi: {
                ...multi,
                coins_scanned: Object.keys(coinStates).length,
                eligible_count: Object.values(coinStates).filter((c: any) => (c.action || '').includes('ELIGIBLE')).length,
                deployed_count: multi.deployed_count || 0,
                total_trades: trades.length,
                active_positions: filteredActivePositions,
                coin_states: coinStates,
                cycle: multi.cycle || 0,
                timestamp: multi.last_analysis_time || multi.timestamp || null,
            },
            scanner: { coins: Object.keys(coinStates) },
            tradebook: {
                trades,
                summary: tradebook.stats || tradebook.summary || {},
            },
            engine: engineState,
        });
    } catch (err) {
        return NextResponse.json({
            state: { regime: 'WAITING', confidence: 0, symbol: 'BTCUSDT', timestamp: null },
            multi: { coins_scanned: 0, eligible_count: 0, deployed_count: 0, total_trades: 0, active_positions: {}, coin_states: {}, cycle: 0, timestamp: null },
            scanner: { coins: [] },
            tradebook: { trades: [], summary: {} },
            error: String(err),
        });
    }
}
