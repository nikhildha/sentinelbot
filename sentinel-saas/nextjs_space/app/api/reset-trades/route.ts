import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';

// Same path logic as bot-state API
const DATA_DIR = path.resolve(process.cwd(), '..', '..', 'data');
const COMMANDS_FILE = path.join(DATA_DIR, 'commands.json');

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = (session.user as any).id;

    // 1. Delete trades from Database (Primary Source of Rule)
    // We only delete trades for bots owned by this user
    await prisma.trade.deleteMany({
      where: {
        bot: {
          userId: userId,
        },
      },
    });

    // 2. Trigger Python Bot Reset (if running)
    // We write a command file that the bot picks up
    try {
      if (!fs.existsSync(DATA_DIR)) {
        // If data dir doesn't exist, we can't notify the bot, but DB reset is done.
        console.warn('[reset-trades] Data dir not found:', DATA_DIR);
      } else {
        const command = {
          command: 'RESET_TRADES',
          user_id: userId,
          timestamp: new Date().toISOString(),
        };
        fs.writeFileSync(COMMANDS_FILE, JSON.stringify(command, null, 2));
      }
    } catch (err) {
      console.error('[reset-trades] Failed to write command file:', err);
      // Non-fatal, DB is already cleared
    }

    return NextResponse.json({ success: true, message: 'Trades reset successfully' });
  } catch (error) {
    console.error('[reset-trades] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
