import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';
import { sendPushNotification } from '../../services/fcm_service';

const chatApp = new Hono<{ Bindings: Env; Variables: Variables }>();

function getCanonicalChatId(user1: string, user2: string): string {
  const u1 = user1.replace(/^@+/, '').trim().toLowerCase();
  const u2 = user2.replace(/^@+/, '').trim().toLowerCase();
  const sorted = [u1, u2].sort();
  return `${sorted[0]}_${sorted[1]}`;
}

// 1. Get Direct Chats List for Current User
chatApp.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = user.userHandle.replace(/^@+/, '').trim().toLowerCase();
  const db = getDatabase(c);

  const { results } = await db.prepare(
    `SELECT c.*,
       COALESCE(pr.display_name, CASE WHEN LOWER(c.user1_handle) = ? THEN c.user2_handle ELSE c.user1_handle END) AS other_display_name,
       COALESCE(pr.avatar_r2_path, '') AS other_avatar_r2_path,
       pr.is_verified,
       pr.bio,
       af.seq AS founder_seq
     FROM chats c
     LEFT JOIN profiles pr ON LOWER(
       CASE 
         WHEN LOWER(c.user1_handle) = ? THEN c.user2_handle 
         ELSE c.user1_handle 
       END
     ) = LOWER(pr.handle)
     LEFT JOIN area_founders af ON LOWER(
       CASE 
         WHEN LOWER(c.user1_handle) = ? THEN c.user2_handle 
         ELSE c.user1_handle 
       END
     ) = LOWER(af.user_id)
     WHERE LOWER(c.user1_handle) = ? OR LOWER(c.user2_handle) = ?
     ORDER BY c.last_timestamp DESC`
  )
    .bind(myHandle, myHandle, myHandle, myHandle, myHandle)
    .all();

  const formatted = (results || []).map((row: any) => {
    const u1 = (row.user1_handle || '').replace(/^@+/, '').trim();
    const u2 = (row.user2_handle || '').replace(/^@+/, '').trim();
    const isUser1 = u1.toLowerCase() === myHandle;
    const otherUser = isUser1 ? u2 : u1;
    const otherDisplayName = (row.other_display_name || otherUser).replace(/^@+/, '').trim();
    const unreadCount = isUser1 ? row.unread_count_user1 : row.unread_count_user2;
    const isFounder = row.founder_seq != null && row.founder_seq > 0;
    const isVerifiedCitizen = row.is_verified === 1 || (row.bio && row.bio.includes('[Verified]'));
    const isVerified = isFounder || isVerifiedCitizen;
    const authorBadge = isFounder ? `FOUNDING #${row.founder_seq}` : (isVerifiedCitizen ? 'VERIFIED' : null);

    return {
      id: row.id,
      chatId: row.canonical_id || row.id,
      canonicalId: row.canonical_id || row.id,
      otherUserHandle: otherUser,
      displayName: otherDisplayName,
      otherUserDisplayName: otherDisplayName,
      partnerDisplayName: otherDisplayName,
      partnerName: otherDisplayName,
      name: otherDisplayName,
      avatarUrl: row.other_avatar_r2_path || '',
      partnerAvatarUrl: row.other_avatar_r2_path || '',
      isVerified,
      is_verified: isVerified ? 1 : 0,
      authorBadge,
      author_badge: authorBadge,
      badge: authorBadge,
      founderSeq: row.founder_seq ?? null,
      lastMessage: row.last_message || '',
      lastMessageType: row.last_message_type || 'text',
      lastTimestamp: row.last_timestamp || Date.now(),
      unreadCount: unreadCount || 0,
      updatedAt: row.updated_at,
    };
  });

  return c.json({
    success: true,
    chats: formatted,
  });
});

// 2. Get Messages for a Chat
chatApp.get('/:chatId/messages', authMiddleware, async (c) => {
  const rawChatId = c.req.param('chatId') || '';
  const chatId = rawChatId.replace(/^@+/, '').trim().toLowerCase();
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const before = c.req.query('before');
  const db = getDatabase(c);

  let query = 'SELECT * FROM chat_messages WHERE LOWER(chat_id) = ?';
  const params: any[] = [chatId];

  if (before) {
    query += ' AND (created_at < ? OR id < ?)';
    params.push(before, before);
  }

  query += ' ORDER BY created_at ASC LIMIT ?';
  params.push(limit);

  const { results } = await db.prepare(query).bind(...params).all();

  const formatted = (results || []).map((row: any) => ({
    id: row.id,
    messageId: row.id,
    chatId: row.chat_id,
    senderHandle: (row.sender_handle || '').replace(/^@+/, '').trim(),
    receiverHandle: (row.receiver_handle || '').replace(/^@+/, '').trim(),
    content: row.content || '',
    mediaR2Path: row.media_r2_path || '',
    imageUrl: row.media_r2_path || '',
    mediaUrls: row.media_r2_path ? [row.media_r2_path] : [],
    type: row.message_type || 'text',
    messageType: row.message_type || 'text',
    isRead: row.is_read === 1,
    createdAt: row.created_at,
    timestamp: row.created_at,
  }));

  return c.json({
    success: true,
    messages: formatted,
  });
});

// Handler for Sending Message
async function handleSendMessage(c: any) {
  const user = c.get('user');
  const myHandle = (user.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const body = await c.req.json().catch(() => ({}));

  const rawReceiver = body.receiver || body.receiverHandle || body.partnerHandle || body.targetHandle || '';
  const receiver = rawReceiver.replace(/^@+/, '').trim().toLowerCase();
  const content = (body.content || body.text || body.message || '').trim();
  const mediaR2Path = body.mediaR2Path || body.imageUrl || (Array.isArray(body.mediaUrls) && body.mediaUrls.length > 0 ? body.mediaUrls[0] : '');
  const messageType = body.messageType || body.type || (mediaR2Path ? 'image' : 'text');

  if (!receiver) {
    return c.json({ success: false, error: 'Receiver handle is required' }, 400);
  }

  if (!content && !mediaR2Path) {
    return c.json({ success: false, error: 'Message content cannot be empty' }, 400);
  }

  const canonicalId = getCanonicalChatId(myHandle, receiver);
  const now = Date.now();
  const msgId = `msg_${now}_${Math.floor(1000 + Math.random() * 9000)}`;
  const db = getDatabase(c);

  const sorted = [myHandle, receiver].sort();
  const user1 = sorted[0];
  const user2 = sorted[1];
  const isSenderUser1 = myHandle === user1;

  const previewText = content || (messageType === 'image' ? '📷 Photo' : (messageType === 'voice_note' ? '🎤 Voice note' : 'Message'));

  // Ensure profiles exist for both
  try {
    await db.batch([
      db.prepare(`INSERT INTO users (id, phone, handle) VALUES (?, ?, ?) ON CONFLICT(handle) DO NOTHING`)
        .bind(`u_${receiver}`, `guest_${receiver}`, receiver),
      db.prepare(`INSERT INTO profiles (handle, user_id, display_name) VALUES (?, ?, ?) ON CONFLICT(handle) DO NOTHING`)
        .bind(receiver, `u_${receiver}`, receiver),
    ]);
  } catch (_) {}

  await db.batch([
    db.prepare(
      `INSERT INTO chats (
        id, canonical_id, user1_handle, user2_handle,
        last_message, last_message_type, last_timestamp,
        unread_count_user1, unread_count_user2, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(canonical_id) DO UPDATE SET
        last_message = excluded.last_message,
        last_message_type = excluded.last_message_type,
        last_timestamp = excluded.last_timestamp,
        unread_count_user1 = unread_count_user1 + ${isSenderUser1 ? 0 : 1},
        unread_count_user2 = unread_count_user2 + ${isSenderUser1 ? 1 : 0},
        updated_at = CURRENT_TIMESTAMP`
    ).bind(
      canonicalId,
      canonicalId,
      user1,
      user2,
      previewText,
      messageType,
      now,
      isSenderUser1 ? 0 : 1,
      isSenderUser1 ? 1 : 0
    ),
    db.prepare(
      `INSERT INTO chat_messages (
        id, chat_id, sender_handle, receiver_handle,
        content, media_r2_path, message_type, is_read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)`
    ).bind(
      msgId,
      canonicalId,
      myHandle,
      receiver,
      content,
      mediaR2Path,
      messageType
    ),
  ]);

  // Trigger Notification to Receiver
  try {
    const notifId = `notif_${now}_${Math.floor(1000 + Math.random() * 9000)}`;

    let senderDisplayName = '';
    try {
      const senderProfile = (await db.prepare('SELECT display_name FROM profiles WHERE handle = ? OR handle = ? LIMIT 1')
        .bind(myHandle, `@${myHandle}`)
        .first()) as any;
      senderDisplayName = (senderProfile?.display_name || '').trim();
    } catch (_) {}

    const notifTitle = senderDisplayName ? `${senderDisplayName} (@${myHandle})` : `@${myHandle}`;
    const payload = {
      type: 'chat',
      partnerHandle: myHandle,
      senderHandle: myHandle,
      senderName: senderDisplayName || myHandle,
      senderDisplayName: senderDisplayName || myHandle,
      chatId: canonicalId,
    };

    await db.prepare(
      `INSERT INTO notifications (id, target_handle, sender_handle, type, title, body, data_json)
       VALUES (?, ?, ?, 'chat', ?, ?, ?)`
    ).bind(
      notifId,
      receiver,
      myHandle,
      notifTitle,
      previewText,
      JSON.stringify(payload)
    ).run();

    // Send FCM Push Notification for background/killed state
    sendPushNotification({
      targetHandle: receiver,
      title: notifTitle,
      body: previewText,
      data: payload,
      channelId: 'nearhood_channel',
      db,
    }).catch((pushErr) => console.error('[Chat FCM] Push dispatch error:', pushErr));
  } catch (_) {}

  return c.json({
    success: true,
    messageId: msgId,
    chatId: canonicalId,
    timestamp: now,
    message: 'Message sent successfully',
  });
}

// 3. Send 1-on-1 Message (Dual /send and /message routes)
chatApp.post('/send', authMiddleware, handleSendMessage);
chatApp.post('/message', authMiddleware, handleSendMessage);

// 4. Mark Chat Messages as Read
chatApp.post('/:chatId/read', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = (user.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const rawChatId = c.req.param('chatId') || '';
  const chatId = rawChatId.replace(/^@+/, '').trim().toLowerCase();
  const db = getDatabase(c);

  await db.batch([
    db.prepare(
      'UPDATE chat_messages SET is_read = 1 WHERE LOWER(chat_id) = ? AND LOWER(receiver_handle) = ?'
    ).bind(chatId, myHandle),
    db.prepare(
      `UPDATE chats SET
       unread_count_user1 = CASE WHEN LOWER(user1_handle) = ? THEN 0 ELSE unread_count_user1 END,
       unread_count_user2 = CASE WHEN LOWER(user2_handle) = ? THEN 0 ELSE unread_count_user2 END
       WHERE LOWER(canonical_id) = ? OR LOWER(id) = ?`
    ).bind(myHandle, myHandle, chatId, chatId),
  ]);

  return c.json({ success: true, message: 'Chat marked as read' });
});

// 5. Get Active Chat IDs for user
chatApp.get('/ids', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = (user.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const db = getDatabase(c);

  const { results } = await db.prepare(
    `SELECT canonical_id, id FROM chats
     WHERE LOWER(user1_handle) = ? OR LOWER(user2_handle) = ?
     ORDER BY last_timestamp DESC`
  )
    .bind(myHandle, myHandle)
    .all();

  const chatIds = (results || []).map((r: any) => r.canonical_id || r.id);
  return c.json({ success: true, chatIds });
});

// 6. Edit Message
chatApp.put('/message/:messageId', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = (user.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const messageId = c.req.param('messageId');
  const body = await c.req.json().catch(() => ({}));
  const newContent = (body.content || body.text || '').trim();

  if (!newContent) {
    return c.json({ success: false, error: 'Content cannot be empty' }, 400);
  }

  const db = getDatabase(c);
  const msg = (await db.prepare(
    'SELECT * FROM chat_messages WHERE id = ? AND LOWER(sender_handle) = ? LIMIT 1'
  )
    .bind(messageId, myHandle)
    .first()) as any;

  if (!msg) {
    return c.json({ success: false, error: 'Message not found or unauthorized' }, 404);
  }

  await db.prepare(
    'UPDATE chat_messages SET content = ? WHERE id = ?'
  )
    .bind(newContent, messageId)
    .run();

  return c.json({
    success: true,
    messageId,
    content: newContent,
    message: 'Message edited successfully',
  });
});

// 7. Delete Message
chatApp.delete('/message/:messageId', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = (user.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const messageId = c.req.param('messageId');
  const body = await c.req.json().catch(() => ({}));
  const forEveryone = body.for_everyone === true || body.forEveryone === true;

  const db = getDatabase(c);

  if (forEveryone) {
    await db.prepare(
      `DELETE FROM chat_messages WHERE id = ? AND LOWER(sender_handle) = ?`
    )
      .bind(messageId, myHandle)
      .run();
  } else {
    await db.prepare(
      `DELETE FROM chat_messages WHERE id = ? AND (LOWER(sender_handle) = ? OR LOWER(receiver_handle) = ?)`
    )
      .bind(messageId, myHandle, myHandle)
      .run();
  }

  return c.json({ success: true, messageId, message: 'Message deleted successfully' });
});

export { chatApp };
