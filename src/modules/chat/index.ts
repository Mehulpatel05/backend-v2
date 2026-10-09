import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';
import { sendPushNotification } from '../../services/fcm_service';
import { isBlockedBetween } from '../../utils/blocks';

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

  const formatted: any[] = [];
  const seenPartners = new Set<string>();

  for (const row of results || []) {
    const u1 = (row.user1_handle || '').replace(/^@+/, '').trim();
    const u2 = (row.user2_handle || '').replace(/^@+/, '').trim();
    const isUser1 = u1.toLowerCase() === myHandle;
    const otherUser = isUser1 ? u2 : u1;
    const partnerKey = otherUser.toLowerCase();

    if (!partnerKey || partnerKey === myHandle) continue;

    if (seenPartners.has(partnerKey)) {
      continue;
    }
    seenPartners.add(partnerKey);

    const otherDisplayName = (row.other_display_name || otherUser).replace(/^@+/, '').trim();
    const unreadCount = isUser1 ? row.unread_count_user1 : row.unread_count_user2;
    const isFounder = row.founder_seq != null && row.founder_seq > 0;
    const isVerifiedCitizen = row.is_verified === 1 || (row.bio && row.bio.includes('[Verified]'));
    const isVerified = isFounder || isVerifiedCitizen;
    const authorBadge = isFounder ? `FOUNDING #${row.founder_seq}` : (isVerifiedCitizen ? 'VERIFIED' : null);

    formatted.push({
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
    });
  }

  return c.json({
    success: true,
    chats: formatted,
  });
});

// 2. Get Messages for a Chat
chatApp.get('/:chatId/messages', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = (user.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const rawChatId = c.req.param('chatId') || '';
  const chatId = rawChatId.replace(/^@+/, '').trim().toLowerCase();
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const before = c.req.query('before');
  const db = getDatabase(c);

  const parts = chatId.split('_');
  const isParticipantByNaming = parts.length === 2 && (parts[0] === myHandle || parts[1] === myHandle);

  const chatRow = await db.prepare(
    `SELECT canonical_id, user1_handle, user2_handle FROM chats
     WHERE (LOWER(canonical_id) = ? OR LOWER(id) = ?)
       AND (LOWER(REPLACE(user1_handle, '@', '')) = ? OR LOWER(REPLACE(user2_handle, '@', '')) = ?)
     LIMIT 1`
  ).bind(chatId, chatId, myHandle, myHandle).first();

  if (!chatRow && !isParticipantByNaming) {
    return c.json({ success: false, error: 'Forbidden: You are not a participant in this conversation' }, 403);
  }

  let query = `
    SELECT * FROM (
      SELECT * FROM chat_messages
      WHERE LOWER(chat_id) = ?
        AND NOT (LOWER(REPLACE(sender_handle, '@', '')) = ? AND COALESCE(deleted_by_sender, 0) = 1)
        AND NOT (LOWER(REPLACE(receiver_handle, '@', '')) = ? AND COALESCE(deleted_by_receiver, 0) = 1)
  `;
  const params: any[] = [chatId, myHandle, myHandle];

  if (before) {
    if (/^\d+$/.test(before)) {
      const date = new Date(parseInt(before, 10));
      if (!isNaN(date.getTime())) {
        query += ' AND created_at < ?';
        params.push(date.toISOString().replace('T', ' ').substring(0, 19));
      } else {
        query += ' AND created_at < ?';
        params.push(before);
      }
    } else {
      query += ' AND created_at < ?';
      params.push(before);
    }
  }

  query += `
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    ) sub
    ORDER BY created_at ASC, id ASC
  `;
  params.push(limit);

  const { results } = await db.prepare(query).bind(...params).all();

  const formatted = (results || []).map((row: any) => {
    let mediaUrls: string[] = [];
    if (row.media_urls_json) {
      try {
        const parsed = typeof row.media_urls_json === 'string'
          ? JSON.parse(row.media_urls_json)
          : row.media_urls_json;
        if (Array.isArray(parsed)) {
          mediaUrls = parsed.filter((u: any) => typeof u === 'string' && u.trim().length > 0);
        }
      } catch (_) {}
    }
    if (mediaUrls.length === 0 && row.media_r2_path) {
      mediaUrls = [row.media_r2_path];
    }
    const mediaR2Path = row.media_r2_path || (mediaUrls.length > 0 ? mediaUrls[0] : '');
    const resolvedType = row.message_type || (mediaUrls.length > 1 ? 'image_group' : (mediaR2Path ? 'image' : 'text'));

    return {
      id: row.id,
      messageId: row.id,
      chatId: row.chat_id,
      senderHandle: (row.sender_handle || '').replace(/^@+/, '').trim(),
      receiverHandle: (row.receiver_handle || '').replace(/^@+/, '').trim(),
      content: row.content || '',
      mediaR2Path: mediaR2Path,
      imageUrl: mediaR2Path,
      mediaUrls: mediaUrls,
      media_urls_json: row.media_urls_json || JSON.stringify(mediaUrls),
      type: resolvedType,
      messageType: resolvedType,
      isRead: row.is_read === 1,
      createdAt: row.created_at,
      timestamp: row.created_at,
    };
  });

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

  const rawMediaUrls: string[] = Array.isArray(body.mediaUrls)
    ? body.mediaUrls.filter((u: any) => typeof u === 'string' && u.trim().length > 0)
    : [];
  let mediaR2Path = body.mediaR2Path || body.imageUrl || (rawMediaUrls.length > 0 ? rawMediaUrls[0] : '');
  if (mediaR2Path && !rawMediaUrls.includes(mediaR2Path)) {
    rawMediaUrls.unshift(mediaR2Path);
  }
  if (!mediaR2Path && rawMediaUrls.length > 0) {
    mediaR2Path = rawMediaUrls[0];
  }
  const mediaUrlsJson = JSON.stringify(rawMediaUrls);
  const messageType = body.messageType || body.type || (rawMediaUrls.length > 1 ? 'image_group' : (mediaR2Path ? 'image' : 'text'));

  if (!receiver) {
    return c.json({ success: false, error: 'Receiver handle is required' }, 400);
  }

  if (receiver === myHandle) {
    return c.json({ success: false, error: 'Cannot send message to yourself' }, 400);
  }

  if (!content && !mediaR2Path && rawMediaUrls.length === 0) {
    return c.json({ success: false, error: 'Message content cannot be empty' }, 400);
  }

  const db = getDatabase(c);

  // Check if users are blocked
  if (await isBlockedBetween(db, myHandle, receiver)) {
    return c.json({ success: false, error: 'Cannot send message: user is blocked' }, 403);
  }

  // Ensure receiver exists
  const receiverUser = await db.prepare(
    'SELECT handle FROM users WHERE LOWER(handle) = ? OR LOWER(handle) = ? LIMIT 1'
  ).bind(receiver, `@${receiver}`).first();
  if (!receiverUser) {
    return c.json({ success: false, error: 'Receiver user not found' }, 404);
  }

  const canonicalId = getCanonicalChatId(myHandle, receiver);
  const now = Date.now();
  const msgId = `msg_${now}_${Math.floor(1000 + Math.random() * 9000)}`;

  const sorted = [myHandle, receiver].sort();
  const user1 = sorted[0];
  const user2 = sorted[1];
  const isSenderUser1 = myHandle === user1;

  const previewText = content || (
    messageType === 'image_group' || rawMediaUrls.length > 1
      ? `📷 ${rawMediaUrls.length} photos`
      : (messageType === 'image' || mediaR2Path ? '📷 Photo' : (messageType === 'voice_note' ? '🎤 Voice note' : 'Message'))
  );

  // 1. Insert chat message first
  await db.prepare(
    `INSERT INTO chat_messages (
      id, chat_id, sender_handle, receiver_handle,
      content, media_r2_path, media_urls_json, message_type, is_read, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)`
  ).bind(
    msgId,
    canonicalId,
    myHandle,
    receiver,
    content,
    mediaR2Path,
    mediaUrlsJson,
    messageType
  ).run();

  // 2. Update/create chat summary with bound increment values
  await db.prepare(
    `INSERT INTO chats (
      id, canonical_id, user1_handle, user2_handle,
      last_message, last_message_type, last_timestamp,
      unread_count_user1, unread_count_user2, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(canonical_id) DO UPDATE SET
      last_message = excluded.last_message,
      last_message_type = excluded.last_message_type,
      last_timestamp = excluded.last_timestamp,
      unread_count_user1 = unread_count_user1 + ?,
      unread_count_user2 = unread_count_user2 + ?,
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
    isSenderUser1 ? 1 : 0,
    isSenderUser1 ? 0 : 1,
    isSenderUser1 ? 1 : 0
  ).run();

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
      `INSERT INTO notifications (id, target_handle, sender_handle, type, title, body, payload_json)
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
    mediaUrls: rawMediaUrls,
    mediaR2Path: mediaR2Path,
    imageUrl: mediaR2Path,
    messageType: messageType,
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

  const parts = chatId.split('_');
  const isParticipantByNaming = parts.length === 2 && (parts[0] === myHandle || parts[1] === myHandle);

  const chatRow = await db.prepare(
    `SELECT canonical_id, user1_handle, user2_handle FROM chats 
     WHERE (LOWER(canonical_id) = ? OR LOWER(id) = ?)
       AND (LOWER(REPLACE(user1_handle, '@', '')) = ? OR LOWER(REPLACE(user2_handle, '@', '')) = ?)
     LIMIT 1`
  ).bind(chatId, chatId, myHandle, myHandle).first();

  if (!chatRow && !isParticipantByNaming) {
    return c.json({ success: false, error: 'Forbidden: You are not a participant in this conversation' }, 403);
  }

  const partnerHandle = parts.length === 2 ? (parts[0] === myHandle ? parts[1] : parts[0]) : '';

  const batchQueries: any[] = [
    db.prepare(
      'UPDATE chat_messages SET is_read = 1 WHERE LOWER(chat_id) = ? AND LOWER(receiver_handle) = ?'
    ).bind(chatId, myHandle),
    db.prepare(
      `UPDATE chats SET
       unread_count_user1 = CASE WHEN LOWER(user1_handle) = ? THEN 0 ELSE unread_count_user1 END,
       unread_count_user2 = CASE WHEN LOWER(user2_handle) = ? THEN 0 ELSE unread_count_user2 END
       WHERE LOWER(canonical_id) = ? OR LOWER(id) = ?`
    ).bind(myHandle, myHandle, chatId, chatId),
  ];

  if (partnerHandle) {
    batchQueries.push(
      db.prepare(
        `UPDATE notifications SET is_read = 1
         WHERE (LOWER(target_handle) = ? OR LOWER(target_handle) = ?)
           AND type = 'chat'
           AND (LOWER(sender_handle) = ? OR LOWER(sender_handle) = ?)`
      ).bind(myHandle, `@${myHandle}`, partnerHandle, `@${partnerHandle}`)
    );
  }

  await db.batch(batchQueries);

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
    'SELECT * FROM chat_messages WHERE id = ? AND LOWER(REPLACE(sender_handle, "@", "")) = ? LIMIT 1'
  )
    .bind(messageId, myHandle)
    .first()) as any;

  if (!msg) {
    return c.json({ success: false, error: 'Message not found or unauthorized' }, 404);
  }

  const createdAtMs = new Date(msg.created_at).getTime();
  const fifteenMinutesMs = 15 * 60 * 1000;
  if (!isNaN(createdAtMs) && Date.now() - createdAtMs > fifteenMinutesMs) {
    return c.json({ success: false, error: 'Edit window expired (15 minutes limit)' }, 403);
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
  const msg = (await db.prepare(
    'SELECT * FROM chat_messages WHERE id = ? LIMIT 1'
  )
    .bind(messageId)
    .first()) as any;

  if (!msg) {
    return c.json({ success: false, error: 'Message not found' }, 404);
  }

  const sender = (msg.sender_handle || '').replace(/^@+/, '').trim().toLowerCase();
  const receiver = (msg.receiver_handle || '').replace(/^@+/, '').trim().toLowerCase();

  if (myHandle !== sender && myHandle !== receiver) {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }

  if (forEveryone) {
    if (myHandle !== sender) {
      return c.json({ success: false, error: 'Only the sender can delete this message for everyone' }, 403);
    }
    const createdAtMs = new Date(msg.created_at).getTime();
    const fortyEightHoursMs = 48 * 60 * 60 * 1000;
    if (!isNaN(createdAtMs) && Date.now() - createdAtMs > fortyEightHoursMs) {
      return c.json({ success: false, error: 'Delete window expired (48 hours limit)' }, 403);
    }
    await db.prepare('DELETE FROM chat_messages WHERE id = ?').bind(messageId).run();
  } else {
    if (myHandle === sender) {
      if (Number(msg.deleted_by_receiver) === 1) {
        await db.prepare('DELETE FROM chat_messages WHERE id = ?').bind(messageId).run();
      } else {
        await db.prepare('UPDATE chat_messages SET deleted_by_sender = 1 WHERE id = ?').bind(messageId).run();
      }
    } else {
      if (Number(msg.deleted_by_sender) === 1) {
        await db.prepare('DELETE FROM chat_messages WHERE id = ?').bind(messageId).run();
      } else {
        await db.prepare('UPDATE chat_messages SET deleted_by_receiver = 1 WHERE id = ?').bind(messageId).run();
      }
    }
  }

  return c.json({ success: true, messageId, message: 'Message deleted successfully' });
});

export { chatApp };
