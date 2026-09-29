import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';

const friendsApp = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. Get Friends List
friendsApp.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = getDatabase(c);

  const { results } = await db.prepare(
    `SELECT f.*, pr.display_name, pr.avatar_r2_path, pr.bio
     FROM friendships f
     JOIN profiles pr ON (
       CASE WHEN f.user1_handle = ? THEN f.user2_handle ELSE f.user1_handle END
     ) = pr.handle
     WHERE f.user1_handle = ? OR f.user2_handle = ?`
  )
    .bind(user.userHandle, user.userHandle, user.userHandle)
    .all();

  return c.json({
    success: true,
    friends: results || [],
  });
});

// 2. Send Friend Request
friendsApp.post('/request', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  let receiver = (body.receiver || '').trim();

  if (!receiver) {
    return c.json({ success: false, error: 'Receiver handle is required' }, 400);
  }
  if (!receiver.startsWith('@')) receiver = `@${receiver}`;

  if (receiver.toLowerCase() === user.userHandle.toLowerCase()) {
    return c.json({ success: false, error: 'Cannot send friend request to yourself' }, 400);
  }

  const requestId = `req_${Date.now()}`;
  const db = getDatabase(c);

  await db.prepare(
    `INSERT INTO friend_requests (id, sender_handle, receiver_handle, status)
     VALUES (?, ?, ?, 'pending')
     ON CONFLICT(sender_handle, receiver_handle) DO UPDATE SET
       status = 'pending',
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(requestId, user.userHandle, receiver)
    .run();

  return c.json({
    success: true,
    requestId,
    message: 'Friend request sent',
  });
});

// 3. Accept Friend Request
friendsApp.post('/request/:id/accept', authMiddleware, async (c) => {
  const user = c.get('user');
  const requestId = c.req.param('id');
  const db = getDatabase(c);

  const req = await db.prepare(
    'SELECT * FROM friend_requests WHERE id = ? AND receiver_handle = ? LIMIT 1'
  )
    .bind(requestId, user.userHandle)
    .first<any>();

  if (!req) {
    return c.json({ success: false, error: 'Friend request not found' }, 404);
  }

  const sorted = [req.sender_handle.toLowerCase(), user.userHandle.toLowerCase()].sort();
  const friendshipId = `friend_${sorted[0]}_${sorted[1]}`;

  await db.batch([
    db.prepare('UPDATE friend_requests SET status = "accepted" WHERE id = ?').bind(requestId),
    db.prepare(
      'INSERT INTO friendships (id, user1_handle, user2_handle) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'
    ).bind(friendshipId, sorted[0], sorted[1]),
    db.prepare('UPDATE profiles SET friend_count = friend_count + 1 WHERE handle IN (?, ?)').bind(
      req.sender_handle,
      user.userHandle
    ),
  ]);

  return c.json({
    success: true,
    message: 'Friend request accepted',
  });
});

export { friendsApp };
