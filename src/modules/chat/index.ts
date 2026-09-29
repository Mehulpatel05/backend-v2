import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';

const chatApp = new Hono<{ Bindings: Env; Variables: Variables }>();

function getCanonicalChatId(user1: string, user2: string): string {
  const u1 = user1.replace('@', '').toLowerCase();
  const u2 = user2.replace('@', '').toLowerCase();
  const sorted = [u1, u2].sort();
  return `${sorted[0]}_${sorted[1]}`;
}

// 1. Get Direct Chats List for Current User
chatApp.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = getDatabase(c);

  const { results } = await db.prepare(
    `SELECT * FROM chats
     WHERE user1_handle = ? OR user2_handle = ?
     ORDER BY last_timestamp DESC`
  )
    .bind(user.userHandle, user.userHandle)
    .all();

  const formatted = (results || []).map((row: any) => {
    const isUser1 = row.user1_handle === user.userHandle;
    const otherUser = isUser1 ? row.user2_handle : row.user1_handle;
    const unreadCount = isUser1 ? row.unread_count_user1 : row.unread_count_user2;

    return {
      id: row.id,
      canonicalId: row.canonical_id,
      otherUserHandle: otherUser,
      lastMessage: row.last_message,
      lastMessageType: row.last_message_type,
      lastTimestamp: row.last_timestamp,
      unreadCount,
    };
  });

  return c.json({
    success: true,
    chats: formatted,
  });
});

// 2. Get Messages for a Chat
chatApp.get('/:chatId/messages', authMiddleware, async (c) => {
  const chatId = c.req.param('chatId');
  const limit = parseInt(c.req.query('limit') || '50');
  const before = c.req.query('before');
  const db = getDatabase(c);

  let query = 'SELECT * FROM chat_messages WHERE chat_id = ?';
  const params: any[] = [chatId];

  if (before) {
    query += ' AND created_at < ?';
    params.push(before);
  }

  query += ' ORDER BY created_at ASC LIMIT ?';
  params.push(limit);

  const { results } = await db.prepare(query).bind(...params).all();

  return c.json({
    success: true,
    messages: results || [],
  });
});

// 3. Send 1-on-1 Message
chatApp.post('/send', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));

  let receiver = (body.receiver || '').trim();
  const content = (body.content || '').trim();
  const mediaR2Path = body.mediaR2Path || '';
  const messageType = body.messageType || (mediaR2Path ? 'image' : 'text');

  if (!receiver) {
    return c.json({ success: false, error: 'Receiver handle is required' }, 400);
  }
  if (!receiver.startsWith('@')) receiver = `@${receiver}`;

  const canonicalId = getCanonicalChatId(user.userHandle, receiver);
  const now = Date.now();
  const msgId = `msg_${now}_${Math.floor(1000 + Math.random() * 9000)}`;
  const db = getDatabase(c);

  const sorted = [user.userHandle.toLowerCase(), receiver.toLowerCase()].sort();
  const user1 = sorted[0];
  const user2 = sorted[1];
  const isSenderUser1 = user.userHandle.toLowerCase() === user1;

  await db.prepare(
    `INSERT INTO chats (
      id, canonical_id, user1_handle, user2_handle,
      last_message, last_message_type, last_timestamp,
      unread_count_user1, unread_count_user2
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_id) DO UPDATE SET
      last_message = excluded.last_message,
      last_message_type = excluded.last_message_type,
      last_timestamp = excluded.last_timestamp,
      unread_count_user1 = unread_count_user1 + ${isSenderUser1 ? 0 : 1},
      unread_count_user2 = unread_count_user2 + ${isSenderUser1 ? 1 : 0},
      updated_at = CURRENT_TIMESTAMP`
  )
    .bind(
      canonicalId,
      canonicalId,
      user1,
      user2,
      content || (messageType === 'image' ? '📷 Photo' : '🎵 Voice note'),
      messageType,
      now,
      isSenderUser1 ? 0 : 1,
      isSenderUser1 ? 1 : 0
    )
    .run();

  await db.prepare(
    `INSERT INTO chat_messages (
      id, chat_id, sender_handle, receiver_handle,
      content, media_r2_path, message_type, is_read
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
  )
    .bind(
      msgId,
      canonicalId,
      user.userHandle,
      receiver,
      content,
      mediaR2Path,
      messageType
    )
    .run();

  return c.json({
    success: true,
    messageId: msgId,
    chatId: canonicalId,
    timestamp: now,
  });
});

// 4. Mark Chat Messages as Read
chatApp.post('/:chatId/read', authMiddleware, async (c) => {
  const user = c.get('user');
  const chatId = c.req.param('chatId');
  const db = getDatabase(c);

  await db.prepare(
    'UPDATE chat_messages SET is_read = 1 WHERE chat_id = ? AND receiver_handle = ?'
  )
    .bind(chatId, user.userHandle)
    .run();

  await db.prepare(
    `UPDATE chats SET
     unread_count_user1 = CASE WHEN user1_handle = ? THEN 0 ELSE unread_count_user1 END,
     unread_count_user2 = CASE WHEN user2_handle = ? THEN 0 ELSE unread_count_user2 END
     WHERE canonical_id = ?`
  )
    .bind(user.userHandle, user.userHandle, chatId)
    .run();

  return c.json({ success: true, message: 'Chat marked as read' });
});

export { chatApp };
