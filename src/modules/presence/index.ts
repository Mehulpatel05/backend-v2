import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';

const presenceApp = new Hono<{ Bindings: Env; Variables: Variables }>();

// In-memory heartbeat cache for sub-second lookup (capped)
const userHeartbeats: Map<string, number> = new Map();

function parseSqliteUtcDate(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  const str = String(val).trim();
  const iso = str.includes('T') ? str : `${str.replace(' ', 'T')}${str.endsWith('Z') ? '' : 'Z'}`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// 1. Heartbeat
presenceApp.post('/heartbeat', authMiddleware, async (c) => {
  const user = c.get('user');
  const handle = user.userHandle.replace(/^@+/, '').toLowerCase();
  const now = Date.now();

  userHeartbeats.set(handle, now);

  if (userHeartbeats.size > 2000) {
    const cutoff = now - 5 * 60 * 1000;
    for (const [k, v] of userHeartbeats.entries()) {
      if (v < cutoff) userHeartbeats.delete(k);
    }
  }

  const db = getDatabase(c);
  try {
    await db.prepare('UPDATE devices SET last_seen_at = CURRENT_TIMESTAMP WHERE installation_id = ?')
      .bind(user.installationId)
      .run();
  } catch (_) {}

  return c.json({
    success: true,
    timestamp: now,
    status: 'online',
  });
});

// 2. Get User Presence Status
presenceApp.get('/:handle', async (c) => {
  const raw = c.req.param('handle') || '';
  const handle = raw.replace(/^@+/, '').toLowerCase();
  const now = Date.now();

  const lastPing = userHeartbeats.get(handle);
  let isOnline = false;
  let lastSeen: number | null = lastPing || null;

  if (lastPing && (now - lastPing) < 60000) {
    isOnline = true;
  } else {
    try {
      const db = getDatabase(c);
      const row = (await db.prepare('SELECT last_seen_at FROM devices WHERE user_handle = ? OR user_handle = ? ORDER BY last_seen_at DESC LIMIT 1')
        .bind(handle, `@${handle}`)
        .first()) as any;

      if (row && row.last_seen_at) {
        const dbDate = parseSqliteUtcDate(row.last_seen_at);
        if (dbDate > 0) {
          lastSeen = dbDate;
          if ((now - dbDate) < 60000) {
            isOnline = true;
          }
        }
      }
    } catch (_) {}
  }

  return c.json({
    success: true,
    handle,
    isOnline,
    lastSeen,
  });
});

export { presenceApp };
