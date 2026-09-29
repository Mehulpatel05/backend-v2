import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';

const notificationsApp = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. Get User Notifications
notificationsApp.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const limit = parseInt(c.req.query('limit') || '50');
  const db = getDatabase(c);

  const { results } = await db.prepare(
    'SELECT * FROM notifications WHERE target_handle = ? ORDER BY created_at DESC LIMIT ?'
  )
    .bind(user.userHandle, limit)
    .all();

  const formatted = (results || []).map((row: any) => ({
    ...row,
    payload: JSON.parse(row.payload_json || '{}'),
  }));

  return c.json({
    success: true,
    notifications: formatted,
  });
});

// 2. Mark Notification as Read
notificationsApp.post('/:id/read', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDatabase(c);

  await db.prepare(
    'UPDATE notifications SET is_read = 1 WHERE id = ? AND target_handle = ?'
  )
    .bind(id, user.userHandle)
    .run();

  return c.json({ success: true, message: 'Notification marked as read' });
});

export { notificationsApp };
