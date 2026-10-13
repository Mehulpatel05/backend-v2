import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';
import { sendPushNotification } from '../../services/fcm_service';

const notificationsApp = new Hono<{ Bindings: Env; Variables: Variables }>();

notificationsApp.use('/*', authMiddleware);

notificationsApp.get('/', async (c) => {
  const user = c.get('user');
  const sessionHandle = (user?.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const queryHandle = (c.req.query('handle') || '').replace(/^@+/, '').trim().toLowerCase();

  const handles = Array.from(new Set([sessionHandle, queryHandle].filter(Boolean)));
  if (handles.length === 0) {
    return c.json({ success: true, notifications: [], count: 0 });
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100);
  const db = getDatabase(c);

  const conditions: string[] = [];
  const params: any[] = [];
  for (const h of handles) {
    conditions.push('LOWER(target_handle) = ? OR LOWER(target_handle) = ?');
    params.push(h, `@${h}`);
  }
  params.push(limit);

  const query = `SELECT * FROM notifications WHERE (${conditions.join(' OR ')}) ORDER BY created_at DESC LIMIT ?`;
  const { results } = await db.prepare(query).bind(...params).all();

  const formatted = (results || []).map((row: any) => {
    let payload = {};
    try {
      const fromDataJson = JSON.parse(row.data_json || '{}');
      const fromPayloadJson = JSON.parse(row.payload_json || '{}');
      payload = { ...fromPayloadJson, ...fromDataJson };
    } catch (_) {}

    return {
      id: row.id,
      notification_id: row.id,
      targetHandle: (row.target_handle || '').replace(/^@+/, ''),
      senderHandle: (row.sender_handle || '').replace(/^@+/, ''),
      type: row.type || 'general',
      title: row.title || 'Nearhood',
      body: row.body || '',
      isRead: row.is_read === 1,
      createdAt: row.created_at,
      timestamp: row.created_at,
      data: payload,
      payload,
    };
  });

  return c.json({
    success: true,
    notifications: formatted,
    count: formatted.length,
  });
});

// 2. Dispatch / Send In-App Notification (authenticated caller is sender)
notificationsApp.post('/', async (c) => {
  const user = c.get('user');
  const senderHandle = user.userHandle.replace(/^@+/, '').trim().toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const rawTarget = body.target_handle || body.targetHandle || body.receiver || '';
  const targetHandle = rawTarget.replace(/^@+/, '').trim().toLowerCase();
  const title = (body.title || 'Nearhood').trim();
  let notifBody = (body.body || body.message || '').trim();
  const type = body.type || 'general';
  const payloadData = body.data || body.payload || {};

  if (!notifBody) {
    if (type === 'chat' || type === 'message') {
      notifBody = 'Sent you a message';
    } else if (type === 'friend_request') {
      notifBody = 'Sent you a friend request';
    } else if (type === 'post_like') {
      notifBody = 'Liked your post';
    } else if (type === 'post_comment') {
      notifBody = 'Commented on your post';
    } else {
      notifBody = 'You have a new update';
    }
  }

  if (!targetHandle) {
    return c.json({ success: false, error: 'target_handle is required' }, 400);
  }

  const db = getDatabase(c);

  if (['chat', 'message', 'post_comment', 'post_like', 'friend_request', 'friend_accept'].includes(type)) {
    const recent = await db.prepare(
      `SELECT id FROM notifications 
       WHERE target_handle = ? AND sender_handle = ? AND type = ? 
       AND created_at >= datetime('now', '-5 seconds') LIMIT 1`
    ).bind(targetHandle, senderHandle, type).first() as any;
    if (recent) {
      return c.json({ success: true, notificationId: recent.id, message: 'Already notified' });
    }
  }

  const notifId = `notif_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

  await db.prepare(
    `INSERT INTO notifications (id, target_handle, sender_handle, type, title, body, payload_json, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)`
  )
    .bind(
      notifId,
      targetHandle,
      senderHandle,
      type,
      title,
      notifBody,
      JSON.stringify(payloadData)
    )
    .run();

  sendPushNotification({
    targetHandle,
    title,
    body: notifBody,
    data: payloadData,
    channelId: 'nearhood_channel',
    db,
  }).catch(() => {});

  return c.json({
    success: true,
    notificationId: notifId,
    message: 'Notification dispatched successfully',
  });
});

// 3. Mark Notification as Read for authenticated user
notificationsApp.post('/:id/read', async (c) => {
  const user = c.get('user');
  const myHandle = user.userHandle.replace(/^@+/, '').trim().toLowerCase();
  const id = c.req.param('id');
  const db = getDatabase(c);

  await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND (LOWER(target_handle) = ? OR LOWER(target_handle) = ?)')
    .bind(id, myHandle, `@${myHandle}`)
    .run();

  return c.json({ success: true, message: 'Notification marked as read' });
});

notificationsApp.post('/read-all', async (c) => {
  const user = c.get('user');
  const sessionHandle = (user?.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const queryHandle = (c.req.query('handle') || '').replace(/^@+/, '').trim().toLowerCase();
  const handles = Array.from(new Set([sessionHandle, queryHandle].filter(Boolean)));
  const db = getDatabase(c);

  for (const h of handles) {
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE (LOWER(target_handle) = ? OR LOWER(target_handle) = ?)')
      .bind(h, `@${h}`)
      .run();
  }

  return c.json({ success: true, message: 'All notifications marked as read' });
});

notificationsApp.delete('/:id', async (c) => {
  const user = c.get('user');
  const sessionHandle = (user?.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const queryHandle = (c.req.query('handle') || '').replace(/^@+/, '').trim().toLowerCase();
  const handles = Array.from(new Set([sessionHandle, queryHandle].filter(Boolean)));
  const id = c.req.param('id');
  const db = getDatabase(c);

  for (const h of handles) {
    await db.prepare('DELETE FROM notifications WHERE id = ? AND (LOWER(target_handle) = ? OR LOWER(target_handle) = ?)')
      .bind(id, h, `@${h}`)
      .run();
  }

  return c.json({ success: true, message: 'Notification deleted' });
});

notificationsApp.delete('/', async (c) => {
  const user = c.get('user');
  const sessionHandle = (user?.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const queryHandle = (c.req.query('handle') || '').replace(/^@+/, '').trim().toLowerCase();
  const handles = Array.from(new Set([sessionHandle, queryHandle].filter(Boolean)));
  const db = getDatabase(c);

  for (const h of handles) {
    await db.prepare('DELETE FROM notifications WHERE LOWER(target_handle) = ? OR LOWER(target_handle) = ?')
      .bind(h, `@${h}`)
      .run();
  }

  return c.json({ success: true, message: 'All notifications cleared' });
});

notificationsApp.delete('/clear-read', async (c) => {
  const user = c.get('user');
  const sessionHandle = (user?.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const queryHandle = (c.req.query('handle') || '').replace(/^@+/, '').trim().toLowerCase();
  const handles = Array.from(new Set([sessionHandle, queryHandle].filter(Boolean)));
  const db = getDatabase(c);

  for (const h of handles) {
    await db.prepare('DELETE FROM notifications WHERE (LOWER(target_handle) = ? OR LOWER(target_handle) = ?) AND is_read = 1')
      .bind(h, `@${h}`)
      .run();
  }

  return c.json({ success: true, message: 'Read notifications cleared' });
});

export { notificationsApp };
