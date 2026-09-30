import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';

const presenceApp = new Hono<{ Bindings: Env; Variables: Variables }>();

// In-memory heartbeat cache for sub-second lookup
const userHeartbeats: Map<string, number> = new Map();

// 1. Heartbeat
presenceApp.post('/heartbeat', authMiddleware, async (c) => {
  const user = c.get('user');
  const handle = user.userHandle.replace(/^@+/, '').toLowerCase();
  const now = Date.now();

  userHeartbeats.set(handle, now);

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
  let lastSeen = lastPing || (now - 300000);

  if (lastPing && (now - lastPing) < 60000) {
    isOnline = true;
  } else {
    // Check DB devices table
    try {
      const db = getDatabase(c);
      const row = (await db.prepare('SELECT last_seen_at FROM devices WHERE user_handle = ? OR user_handle = ? ORDER BY last_seen_at DESC LIMIT 1')
        .bind(handle, `@${handle}`)
        .first()) as any;

      if (row && row.last_seen_at) {
        const dbDate = new Date(row.last_seen_at).getTime();
        lastSeen = dbDate;
        if ((now - dbDate) < 60000) {
          isOnline = true;
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
