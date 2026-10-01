import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';

const notificationsApp = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. Get User Notifications (Supports authMiddleware session OR ?handle= query param OR x-user-handle header)
notificationsApp.get('/', async (c) => {
  const queryHandle = c.req.query('handle') || c.req.header('x-user-handle') || c.req.header('user-handle') || '';
  let targetHandle = queryHandle.replace(/^@+/, '').trim().toLowerCase();

  if (!targetHandle) {
    // Try auth middleware context if available
    const authHeader = c.req.header('Authorization');
    if (authHeader) {
      try {
        await authMiddleware(c as any, async () => {});
        const user = c.get('user');
        if (user?.userHandle) {
          targetHandle = user.userHandle.replace(/^@+/, '').trim().toLowerCase();
        }
      } catch (_) {}
    }
  }

  if (!targetHandle) {
    return c.json({ success: false, error: 'User handle is required' }, 400);
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100);
  const db = getDatabase(c);

  const { results } = await db.prepare(
    `SELECT * FROM notifications 
     WHERE LOWER(target_handle) = ? 
     ORDER BY created_at DESC LIMIT ?`
  )
    .bind(targetHandle, limit)
    .all();

  const formatted = (results || []).map((row: any) => {
    // Support both data_json (chat/friends writes) and payload_json (legacy writes)
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

// 2. Dispatch / Send In-App Notification
notificationsApp.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const rawTarget = body.target_handle || body.targetHandle || body.receiver || '';
  const targetHandle = rawTarget.replace(/^@+/, '').trim().toLowerCase();
  const rawSender = body.sender_handle || body.senderHandle || body.sender || '';
  const senderHandle = rawSender.replace(/^@+/, '').trim().toLowerCase();
  const title = body.title || 'Nearhood';
  const notifBody = body.body || body.message || '';
  const type = body.type || 'general';
  const payloadData = body.data || body.payload || {};

  if (!targetHandle) {
    return c.json({ success: false, error: 'target_handle is required' }, 400);
  }

  const db = getDatabase(c);
  const notifId = `notif_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

  await db.prepare(
    `INSERT INTO notifications (id, target_handle, sender_handle, type, title, body, data_json, is_read, created_at)
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

  return c.json({
    success: true,
    notificationId: notifId,
    message: 'Notification dispatched successfully',
  });
});

// 3. Mark Notification as Read
notificationsApp.post('/:id/read', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const rawHandle = body.handle || body.user_handle || c.req.header('x-user-handle') || '';
  const handle = rawHandle.replace(/^@+/, '').trim().toLowerCase();
  const db = getDatabase(c);

  if (handle) {
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND LOWER(target_handle) = ?')
      .bind(id, handle)
      .run();
  } else {
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?')
      .bind(id)
      .run();
  }

  return c.json({ success: true, message: 'Notification marked as read' });
});

// 4. Mark All Notifications as Read for User
notificationsApp.post('/read-all', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const rawHandle = body.handle || body.user_handle || c.req.header('x-user-handle') || '';
  const handle = rawHandle.replace(/^@+/, '').trim().toLowerCase();
  const db = getDatabase(c);

  if (handle) {
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE LOWER(target_handle) = ?')
      .bind(handle)
      .run();
  }

  return c.json({ success: true, message: 'All notifications marked as read' });
});

export { notificationsApp };
