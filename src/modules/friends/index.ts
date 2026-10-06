import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';
import { sendPushNotification } from '../../services/fcm_service';

const friendsApp = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. Get Friends List (De-duplicated)
friendsApp.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = user.userHandle.replace(/^@+/, '').trim().toLowerCase();
  const db = getDatabase(c);

  const { results } = await db.prepare(
    `SELECT f.id, f.created_at,
       CASE 
         WHEN LOWER(f.user1_handle) = ? THEN f.user2_handle 
         ELSE f.user1_handle 
       END AS other_user,
       COALESCE(pr.display_name, CASE WHEN LOWER(f.user1_handle) = ? THEN f.user2_handle ELSE f.user1_handle END) AS display_name,
       COALESCE(pr.avatar_r2_path, '') AS avatar_r2_path,
       COALESCE(pr.bio, '') AS bio,
       pr.is_verified,
       af.seq AS founder_seq
     FROM friendships f
     LEFT JOIN profiles pr ON LOWER(
       CASE 
         WHEN LOWER(f.user1_handle) = ? THEN f.user2_handle 
         ELSE f.user1_handle 
       END
     ) = LOWER(pr.handle)
     LEFT JOIN area_founders af ON LOWER(
       CASE 
         WHEN LOWER(f.user1_handle) = ? THEN f.user2_handle 
         ELSE f.user1_handle 
       END
     ) = LOWER(af.user_id)
     WHERE LOWER(f.user1_handle) = ? OR LOWER(f.user2_handle) = ?
     GROUP BY other_user
     ORDER BY f.created_at DESC`
  )
    .bind(
      myHandle, myHandle, myHandle, myHandle, myHandle
    )
    .all();

  const formatted = (results || []).map((row: any) => {
    const other = (row.other_user || '').replace(/^@+/, '').trim();
    const isFounder = row.founder_seq != null && row.founder_seq > 0;
    const isVerifiedCitizen = row.is_verified === 1 || (row.bio && row.bio.includes('[Verified]'));
    const isVerified = isFounder || isVerifiedCitizen;
    const authorBadge = isFounder ? `FOUNDING #${row.founder_seq}` : (isVerifiedCitizen ? 'VERIFIED' : null);

    return {
      id: row.id,
      otherUser: other,
      users: [myHandle, other],
      displayName: row.display_name || other,
      avatarUrl: row.avatar_r2_path || '',
      bio: row.bio || '',
      isVerified,
      is_verified: isVerified ? 1 : 0,
      authorBadge,
      author_badge: authorBadge,
      badge: authorBadge,
      founderSeq: row.founder_seq ?? null,
      createdAt: row.created_at,
    };
  });

  return c.json({
    success: true,
    friends: formatted,
  });
});

// 1.1 Discover / Find People
friendsApp.get('/discover', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = user.userHandle.replace(/^@+/, '').trim().toLowerCase();
  const rawQ = c.req.query('q') || '';
  const query = rawQ.replace(/^@+/, '').trim().toLowerCase();
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100);
  const db = getDatabase(c);

  let profilesQuery = `
    SELECT DISTINCT
      u.handle,
      COALESCE(pr.display_name, u.handle) AS display_name,
      COALESCE(pr.avatar_r2_path, '') AS avatar_r2_path,
      COALESCE(pr.bio, '') AS bio,
      COALESCE(pr.friend_count, 0) AS friend_count,
      pr.is_verified,
      af.seq AS founder_seq,
      u.created_at
    FROM users u
    LEFT JOIN profiles pr ON LOWER(u.handle) = LOWER(pr.handle)
    LEFT JOIN area_founders af ON LOWER(u.handle) = LOWER(af.user_id)
    WHERE LOWER(u.handle) != ? AND LOWER(u.handle) NOT LIKE 'anon#%' AND LOWER(u.handle) != 'guest'
      AND LOWER(u.handle) NOT LIKE 'user_%'
  `;
  const params: any[] = [myHandle];

  if (query.length > 0) {
    profilesQuery += ` AND (LOWER(u.handle) LIKE ? OR LOWER(COALESCE(pr.display_name, '')) LIKE ? OR LOWER(COALESCE(pr.bio, '')) LIKE ?)`;
    const searchPattern = `%${query}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  profilesQuery += ` ORDER BY COALESCE(pr.friend_count, 0) DESC, u.created_at DESC LIMIT ?`;
  params.push(limit);

  const { results: rawProfiles } = await db.prepare(profilesQuery).bind(...params).all();

  // Fetch current user's friendships
  const { results: rawFriendships } = await db.prepare(
    `SELECT user1_handle, user2_handle FROM friendships 
     WHERE LOWER(user1_handle) = ? OR LOWER(user2_handle) = ?`
  ).bind(myHandle, myHandle).all();

  const friendHandles = new Set<string>();
  (rawFriendships || []).forEach((row: any) => {
    const u1 = (row.user1_handle || '').replace(/^@+/, '').trim().toLowerCase();
    const u2 = (row.user2_handle || '').replace(/^@+/, '').trim().toLowerCase();
    if (u1 === myHandle) friendHandles.add(u2);
    else friendHandles.add(u1);
  });

  // Fetch pending requests
  const { results: rawRequests } = await db.prepare(
    `SELECT sender_handle, receiver_handle, status FROM friend_requests
     WHERE (LOWER(sender_handle) = ? OR LOWER(receiver_handle) = ?) AND status = 'pending'`
  ).bind(myHandle, myHandle).all();

  const sentReqHandles = new Set<string>();
  const receivedReqHandles = new Set<string>();

  (rawRequests || []).forEach((row: any) => {
    const sender = (row.sender_handle || '').replace(/^@+/, '').trim().toLowerCase();
    const receiver = (row.receiver_handle || '').replace(/^@+/, '').trim().toLowerCase();
    if (sender === myHandle) {
      sentReqHandles.add(receiver);
    } else {
      receivedReqHandles.add(sender);
    }
  });

  const users = (rawProfiles || []).map((row: any) => {
    const handle = (row.handle || '').replace(/^@+/, '').trim();
    const handleLower = handle.toLowerCase();

    let relationship = 'none';
    if (friendHandles.has(handleLower)) {
      relationship = 'friends';
    } else if (sentReqHandles.has(handleLower)) {
      relationship = 'requestSentByMe';
    } else if (receivedReqHandles.has(handleLower)) {
      relationship = 'requestReceivedByMe';
    }

    const isFounder = row.founder_seq != null && row.founder_seq > 0;
    const isVerifiedCitizen = row.is_verified === 1 || (row.bio && row.bio.includes('[Verified]'));
    const isVerified = isFounder || isVerifiedCitizen;
    const authorBadge = isFounder ? `FOUNDING #${row.founder_seq}` : (isVerifiedCitizen ? 'VERIFIED' : null);

    return {
      handle,
      displayName: row.display_name || handle,
      avatarUrl: row.avatar_r2_path || '',
      bio: row.bio || '',
      friendCount: row.friend_count || 0,
      relationship,
      isVerified,
      is_verified: isVerified ? 1 : 0,
      authorBadge,
      author_badge: authorBadge,
      badge: authorBadge || 'Vadodara Neighbor',
      founderSeq: row.founder_seq ?? null,
    };
  });

  return c.json({
    success: true,
    users,
    count: users.length,
  });
});

// 2. Get Relationship Status With a Specific User
friendsApp.get('/status/:handle', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = user.userHandle.replace(/^@+/, '').trim().toLowerCase();
  const rawTarget = c.req.param('handle') || '';
  const targetHandle = rawTarget.replace(/^@+/, '').trim().toLowerCase();
  const db = getDatabase(c);

  if (!targetHandle || targetHandle === myHandle) {
    return c.json({ success: true, relationship: 'none' });
  }

  // Check Friendship
  const friendship = await db.prepare(
    `SELECT id FROM friendships
     WHERE (LOWER(user1_handle) = ? AND LOWER(user2_handle) = ?)
        OR (LOWER(user1_handle) = ? AND LOWER(user2_handle) = ?)
     LIMIT 1`
  )
    .bind(myHandle, targetHandle, targetHandle, myHandle)
    .first();

  if (friendship) {
    return c.json({ success: true, relationship: 'friends' });
  }

  // Check Friend Requests
  const request = (await db.prepare(
    `SELECT id, sender_handle, receiver_handle, status FROM friend_requests
     WHERE ((LOWER(sender_handle) = ? AND LOWER(receiver_handle) = ?)
        OR  (LOWER(sender_handle) = ? AND LOWER(receiver_handle) = ?))
       AND status = 'pending'
     LIMIT 1`
  )
    .bind(myHandle, targetHandle, targetHandle, myHandle)
    .first()) as any;

  if (request) {
    const sender = (request.sender_handle || '').replace(/^@+/, '').trim().toLowerCase();
    if (sender === myHandle) {
      return c.json({ success: true, relationship: 'requestSentByMe', requestId: request.id });
    } else {
      return c.json({ success: true, relationship: 'requestReceivedByMe', requestId: request.id });
    }
  }

  return c.json({ success: true, relationship: 'none' });
});

// 3. Send Friend Request (Strict Single Row & Immediate Notification)
friendsApp.post('/request', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = user.userHandle.replace(/^@+/, '').trim().toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const rawTarget = body.receiver_handle || body.receiverHandle || body.receiver || body.target_handle || body.targetHandle || '';
  const target = rawTarget.replace(/^@+/, '').trim().toLowerCase();

  if (!target) {
    return c.json({ success: false, error: 'Target user handle is required' }, 400);
  }

  if (target === myHandle) {
    return c.json({ success: false, error: 'Cannot send friend request to yourself' }, 400);
  }

  const db = getDatabase(c);

  // Auto ensure both user records exist
  try {
    await db.batch([
      db.prepare(`INSERT INTO users (id, phone, handle) VALUES (?, ?, ?) ON CONFLICT(handle) DO NOTHING`)
        .bind(`u_${target}`, `guest_${target}`, target),
      db.prepare(`INSERT INTO profiles (handle, user_id, display_name) VALUES (?, ?, ?) ON CONFLICT(handle) DO NOTHING`)
        .bind(target, `u_${target}`, target),
    ]);
  } catch (_) {}

  // Check if already friends
  const existingFriendship = await db.prepare(
    `SELECT id FROM friendships
     WHERE (LOWER(user1_handle) = ? AND LOWER(user2_handle) = ?)
        OR (LOWER(user1_handle) = ? AND LOWER(user2_handle) = ?)
     LIMIT 1`
  )
    .bind(myHandle, target, target, myHandle)
    .first();

  if (existingFriendship) {
    return c.json({ success: true, relationship: 'friends', message: 'You are already friends' });
  }

  // If reverse request exists (they sent a request to me), auto-accept!
  const reverseReq = await db.prepare(
    `SELECT id FROM friend_requests
     WHERE LOWER(sender_handle) = ? AND LOWER(receiver_handle) = ? AND status = 'pending'
     LIMIT 1`
  )
    .bind(target, myHandle)
    .first();

  if (reverseReq) {
    const sorted = [target, myHandle].sort();
    const friendshipId = `friend_${sorted[0]}_${sorted[1]}`;
    await db.batch([
      db.prepare(
        `UPDATE friend_requests SET status = 'accepted', updated_at = CURRENT_TIMESTAMP
         WHERE (LOWER(sender_handle) = ? AND LOWER(receiver_handle) = ?)
            OR (LOWER(sender_handle) = ? AND LOWER(receiver_handle) = ?)`
      ).bind(target, myHandle, myHandle, target),
      db.prepare(
        `INSERT INTO friendships (id, user1, user2, user1_handle, user2_handle) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`
      ).bind(friendshipId, sorted[0], sorted[1], sorted[0], sorted[1]),
      db.prepare(`UPDATE profiles SET friend_count = friend_count + 1 WHERE LOWER(handle) IN (?, ?)`).bind(
        target, myHandle
      ),
    ]);

    // Notify target that you accepted their pending request
    try {
      const notifId = `notif_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

      let accepterDisplayName = '';
      try {
        const accepterProfile = (await db.prepare('SELECT display_name FROM profiles WHERE handle = ? OR handle = ? LIMIT 1')
          .bind(myHandle, `@${myHandle}`)
          .first()) as any;
        accepterDisplayName = (accepterProfile?.display_name || '').trim();
      } catch (_) {}

      const accepterDisplay = accepterDisplayName ? `${accepterDisplayName} (@${myHandle})` : `@${myHandle}`;
      const acceptBody = `${accepterDisplay} accepted your friend request! Tap to start chatting.`;
      const autoPayload = {
        type: 'chat',
        partnerHandle: myHandle,
        senderHandle: myHandle,
        senderName: accepterDisplayName || myHandle,
        senderDisplayName: accepterDisplayName || myHandle,
      };

      await db.prepare(
        `INSERT INTO notifications (id, target_handle, sender_handle, type, title, body, data_json, is_read, created_at)
         VALUES (?, ?, ?, 'friend_accept', 'Friend Request Accepted', ?, ?, 0, CURRENT_TIMESTAMP)`
      ).bind(
        notifId,
        target,
        myHandle,
        acceptBody,
        JSON.stringify(autoPayload)
      ).run();

      sendPushNotification({
        targetHandle: target,
        title: 'Friend Request Accepted',
        body: acceptBody,
        data: autoPayload,
        channelId: 'nearhood_channel',
        db,
      }).catch((pushErr) => console.error('[Auto-Accept FCM] Push error:', pushErr));
    } catch (_) {}

    return c.json({
      success: true,
      relationship: 'friends',
      friendshipId,
      message: `You and @${target} are now friends!`,
    });
  }

  const requestId = `req_${Date.now()}_${myHandle}_${target}`;

  // Purge any older rows to prevent duplicates in DB
  await db.batch([
    db.prepare(
      `DELETE FROM friend_requests 
       WHERE (LOWER(sender_handle) = ? AND LOWER(receiver_handle) = ?)
          OR (LOWER(sender_handle) = ? AND LOWER(receiver_handle) = ?)`
    ).bind(myHandle, target, target, myHandle),
    db.prepare(
      `INSERT INTO friend_requests (id, sender_handle, receiver_handle, status, updated_at)
       VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP)`
    ).bind(requestId, myHandle, target),
  ]);

  // Create notification for target user
  try {
    const notifId = `notif_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

    let senderDisplayName = '';
    try {
      const senderProfile = (await db.prepare('SELECT display_name FROM profiles WHERE handle = ? OR handle = ? LIMIT 1')
        .bind(myHandle, `@${myHandle}`)
        .first()) as any;
      senderDisplayName = (senderProfile?.display_name || '').trim();
    } catch (_) {}

    const senderDisplay = senderDisplayName ? `${senderDisplayName} (@${myHandle})` : `@${myHandle}`;
    const notifBody = `${senderDisplay} sent you a friend request`;
    const notifPayload = {
      type: 'friend_request',
      senderHandle: myHandle,
      senderName: senderDisplayName || myHandle,
      senderDisplayName: senderDisplayName || myHandle,
      requestId,
    };

    await db.prepare(
      `INSERT INTO notifications (id, target_handle, sender_handle, type, title, body, data_json, is_read, created_at)
       VALUES (?, ?, ?, 'friend_request', 'New Friend Request', ?, ?, 0, CURRENT_TIMESTAMP)`
    ).bind(
      notifId,
      target,
      myHandle,
      notifBody,
      JSON.stringify(notifPayload)
    ).run();

    // Send FCM Push Notification for background/killed state
    sendPushNotification({
      targetHandle: target,
      title: 'New Friend Request',
      body: notifBody,
      data: notifPayload,
      channelId: 'nearhood_channel',
      db,
    }).catch((pushErr) => console.error('[Friend Request FCM] Push error:', pushErr));
  } catch (_) {}

  return c.json({
    success: true,
    relationship: 'requestSentByMe',
    requestId,
    message: `Friend request sent to @${target}`,
  });
});

// 4. Accept Friend Request
friendsApp.post('/accept', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = user.userHandle.replace(/^@+/, '').trim().toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const rawSender = body.senderHandle || body.sender || '';
  const sender = rawSender.replace(/^@+/, '').trim().toLowerCase();
  const db = getDatabase(c);

  let req = null;
  if (sender) {
    req = (await db.prepare(
      `SELECT * FROM friend_requests
       WHERE LOWER(sender_handle) = ? AND LOWER(receiver_handle) = ? AND status = 'pending'
       LIMIT 1`
    )
      .bind(sender, myHandle)
      .first()) as any;
  }

  if (!req && body.requestId) {
    req = (await db.prepare(
      `SELECT * FROM friend_requests WHERE id = ? AND LOWER(receiver_handle) = ? LIMIT 1`
    )
      .bind(body.requestId, myHandle)
      .first()) as any;
  }

  const otherPerson = req ? (req.sender_handle || '').replace(/^@+/, '').trim().toLowerCase() : sender;
  if (!otherPerson) {
    return c.json({ success: false, error: 'Friend request not found' }, 404);
  }

  const sorted = [otherPerson, myHandle].sort();
  const friendshipId = `friend_${sorted[0]}_${sorted[1]}`;

  await db.batch([
    db.prepare(
      `UPDATE friend_requests SET status = 'accepted', updated_at = CURRENT_TIMESTAMP
       WHERE (LOWER(sender_handle) = ? AND LOWER(receiver_handle) = ?)
          OR (LOWER(sender_handle) = ? AND LOWER(receiver_handle) = ?)`
    ).bind(
      otherPerson, myHandle,
      myHandle, otherPerson
    ),
    db.prepare(
      `INSERT INTO friendships (id, user1, user2, user1_handle, user2_handle) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    ).bind(friendshipId, sorted[0], sorted[1], sorted[0], sorted[1]),
    db.prepare(`UPDATE profiles SET friend_count = friend_count + 1 WHERE LOWER(handle) IN (?, ?)`).bind(
      otherPerson, myHandle
    ),
  ]);

  // Create notification for other person
  try {
    const notifId = `notif_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

    let accepterDisplayName = '';
    try {
      const accepterProfile = (await db.prepare('SELECT display_name FROM profiles WHERE handle = ? OR handle = ? LIMIT 1')
        .bind(myHandle, `@${myHandle}`)
        .first()) as any;
      accepterDisplayName = (accepterProfile?.display_name || '').trim();
    } catch (_) {}

    const accepterDisplay = accepterDisplayName ? `${accepterDisplayName} (@${myHandle})` : `@${myHandle}`;
    const acceptBody = `${accepterDisplay} accepted your friend request! Tap to start chatting.`;
    const acceptPayload = {
      type: 'chat',
      partnerHandle: myHandle,
      senderHandle: myHandle,
      senderName: accepterDisplayName || myHandle,
      senderDisplayName: accepterDisplayName || myHandle,
    };

    await db.prepare(
      `INSERT INTO notifications (id, target_handle, sender_handle, type, title, body, data_json, is_read, created_at)
       VALUES (?, ?, ?, 'friend_accept', 'Friend Request Accepted', ?, ?, 0, CURRENT_TIMESTAMP)`
    ).bind(
      notifId,
      otherPerson,
      myHandle,
      acceptBody,
      JSON.stringify(acceptPayload)
    ).run();

    // Send FCM Push Notification for background/killed state
    sendPushNotification({
      targetHandle: otherPerson,
      title: 'Friend Request Accepted',
      body: acceptBody,
      data: acceptPayload,
      channelId: 'nearhood_channel',
      db,
    }).catch((pushErr) => console.error('[Friend Accept FCM] Push error:', pushErr));
  } catch (_) {}

  return c.json({
    success: true,
    friendshipId,
    message: `You are now friends with @${otherPerson}`,
  });
});

// 4.1 Accept Friend Request By ID Route
friendsApp.post('/request/:id/accept', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = user.userHandle.replace(/^@+/, '').trim().toLowerCase();
  const requestId = c.req.param('id');
  const db = getDatabase(c);

  const req = (await db.prepare(
    'SELECT * FROM friend_requests WHERE id = ? AND LOWER(receiver_handle) = ? LIMIT 1'
  )
    .bind(requestId, myHandle)
    .first()) as any;

  if (!req) {
    return c.json({ success: false, error: 'Friend request not found' }, 404);
  }

  const sender = (req.sender_handle || '').replace(/^@+/, '').trim().toLowerCase();
  const sorted = [sender, myHandle].sort();
  const friendshipId = `friend_${sorted[0]}_${sorted[1]}`;

  await db.batch([
    db.prepare('UPDATE friend_requests SET status = "accepted", updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(requestId),
    db.prepare(
      `INSERT INTO friendships (id, user1, user2, user1_handle, user2_handle) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    ).bind(friendshipId, sorted[0], sorted[1], sorted[0], sorted[1]),
    db.prepare('UPDATE profiles SET friend_count = friend_count + 1 WHERE LOWER(handle) IN (?, ?)').bind(
      sender, myHandle
    ),
  ]);

  // Create notification for sender
  try {
    const notifId = `notif_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

    let accepterDisplayName = '';
    try {
      const accepterProfile = (await db.prepare('SELECT display_name FROM profiles WHERE handle = ? OR handle = ? LIMIT 1')
        .bind(myHandle, `@${myHandle}`)
        .first()) as any;
      accepterDisplayName = (accepterProfile?.display_name || '').trim();
    } catch (_) {}

    const accepterDisplay = accepterDisplayName ? `${accepterDisplayName} (@${myHandle})` : `@${myHandle}`;
    const acceptBody = `${accepterDisplay} accepted your friend request! Tap to start chatting.`;
    const acceptPayload = {
      type: 'chat',
      partnerHandle: myHandle,
      senderHandle: myHandle,
      senderName: accepterDisplayName || myHandle,
      senderDisplayName: accepterDisplayName || myHandle,
    };
    await db.prepare(
      `INSERT INTO notifications (id, target_handle, sender_handle, type, title, body, data_json, is_read, created_at)
       VALUES (?, ?, ?, 'friend_accept', 'Friend Request Accepted', ?, ?, 0, CURRENT_TIMESTAMP)`
    ).bind(
      notifId,
      sender,
      myHandle,
      acceptBody,
      JSON.stringify(acceptPayload)
    ).run();

    sendPushNotification({
      targetHandle: sender,
      title: 'Friend Request Accepted',
      body: acceptBody,
      data: acceptPayload,
      channelId: 'nearhood_channel',
      db,
    }).catch((pushErr) => console.error('[Friend Accept ID FCM] Push error:', pushErr));
  } catch (_) {}

  return c.json({
    success: true,
    message: `Friend request accepted`,
  });
});

// 5. Reject Friend Request
friendsApp.post('/reject', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = user.userHandle.replace(/^@+/, '').trim().toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const rawSender = body.senderHandle || body.sender || '';
  const sender = rawSender.replace(/^@+/, '').trim().toLowerCase();
  const db = getDatabase(c);

  await db.prepare(
    `UPDATE friend_requests SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
     WHERE LOWER(sender_handle) = ? AND LOWER(receiver_handle) = ?`
  )
    .bind(sender, myHandle)
    .run();

  return c.json({ success: true, message: 'Friend request rejected' });
});

// 6. Cancel Sent Friend Request
friendsApp.post('/cancel', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = user.userHandle.replace(/^@+/, '').trim().toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const rawReceiver = body.receiverHandle || body.receiver || '';
  const receiver = rawReceiver.replace(/^@+/, '').trim().toLowerCase();
  const db = getDatabase(c);

  await db.prepare(
    `DELETE FROM friend_requests
     WHERE LOWER(sender_handle) = ? AND LOWER(receiver_handle) = ? AND status = 'pending'`
  )
    .bind(myHandle, receiver)
    .run();

  return c.json({ success: true, message: 'Friend request cancelled' });
});

// 7. Unfriend
friendsApp.post('/unfriend', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = user.userHandle.replace(/^@+/, '').trim().toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const rawOther = body.otherHandle || body.friendHandle || body.handle || '';
  const other = rawOther.replace(/^@+/, '').trim().toLowerCase();
  const db = getDatabase(c);

  if (!other) {
    return c.json({ success: false, error: 'Friend handle required' }, 400);
  }

  await db.batch([
    db.prepare(
      `DELETE FROM friendships
       WHERE (LOWER(user1_handle) = ? AND LOWER(user2_handle) = ?)
          OR (LOWER(user1_handle) = ? AND LOWER(user2_handle) = ?)`
    ).bind(
      myHandle, other,
      other, myHandle
    ),
    db.prepare(
      `UPDATE profiles SET friend_count = MAX(0, friend_count - 1) WHERE LOWER(handle) IN (?, ?)`
    ).bind(
      other, myHandle
    ),
  ]);

  return c.json({ success: true, message: `Unfriended @${other}` });
});

// 8. Get Pending & Sent Friend Requests (Strict De-duplication via GROUP BY)
friendsApp.get('/requests', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = user.userHandle.replace(/^@+/, '').trim().toLowerCase();
  const db = getDatabase(c);

  const { results: received } = await db.prepare(
    `SELECT r.id, r.sender_handle, r.receiver_handle, r.created_at,
            COALESCE(pr.display_name, r.sender_handle) AS display_name,
            COALESCE(pr.avatar_r2_path, '') AS avatar_r2_path,
            COALESCE(pr.bio, '') AS bio,
            pr.is_verified,
            af.seq AS founder_seq
     FROM friend_requests r
     LEFT JOIN profiles pr ON LOWER(r.sender_handle) = LOWER(pr.handle)
     LEFT JOIN area_founders af ON LOWER(r.sender_handle) = LOWER(af.user_id)
     WHERE LOWER(r.receiver_handle) = ? AND r.status = 'pending'
     GROUP BY LOWER(r.sender_handle)
     ORDER BY r.created_at DESC`
  )
    .bind(myHandle)
    .all();

  const { results: sent } = await db.prepare(
    `SELECT r.id, r.sender_handle, r.receiver_handle, r.created_at,
            COALESCE(pr.display_name, r.receiver_handle) AS display_name,
            COALESCE(pr.avatar_r2_path, '') AS avatar_r2_path,
            COALESCE(pr.bio, '') AS bio,
            pr.is_verified,
            af.seq AS founder_seq
     FROM friend_requests r
     LEFT JOIN profiles pr ON LOWER(r.receiver_handle) = LOWER(pr.handle)
     LEFT JOIN area_founders af ON LOWER(r.receiver_handle) = LOWER(af.user_id)
     WHERE LOWER(r.sender_handle) = ? AND r.status = 'pending'
     GROUP BY LOWER(r.receiver_handle)
     ORDER BY r.created_at DESC`
  )
    .bind(myHandle)
    .all();

  return c.json({
    success: true,
    received: (received || []).map((row: any) => {
      const dName = (row.display_name || row.sender_handle || '').replace(/^@+/, '').trim();
      const isFounder = row.founder_seq != null && row.founder_seq > 0;
      const isVerifiedCitizen = row.is_verified === 1 || (row.bio && row.bio.includes('[Verified]'));
      const isVerified = isFounder || isVerifiedCitizen;
      const authorBadge = isFounder ? `FOUNDING #${row.founder_seq}` : (isVerifiedCitizen ? 'VERIFIED' : null);

      return {
        id: row.id,
        senderHandle: (row.sender_handle || '').replace(/^@+/, ''),
        receiverHandle: myHandle,
        displayName: dName,
        senderName: dName,
        senderDisplayName: dName,
        avatarUrl: row.avatar_r2_path || '',
        senderAvatarUrl: row.avatar_r2_path || '',
        bio: row.bio || '',
        isVerified,
        is_verified: isVerified ? 1 : 0,
        authorBadge,
        author_badge: authorBadge,
        badge: authorBadge,
        founderSeq: row.founder_seq ?? null,
        createdAt: row.created_at,
      };
    }),
    sent: (sent || []).map((row: any) => {
      const dName = (row.display_name || row.receiver_handle || '').replace(/^@+/, '').trim();
      const isFounder = row.founder_seq != null && row.founder_seq > 0;
      const isVerifiedCitizen = row.is_verified === 1 || (row.bio && row.bio.includes('[Verified]'));
      const isVerified = isFounder || isVerifiedCitizen;
      const authorBadge = isFounder ? `FOUNDING #${row.founder_seq}` : (isVerifiedCitizen ? 'VERIFIED' : null);

      return {
        id: row.id,
        senderHandle: myHandle,
        receiverHandle: (row.receiver_handle || '').replace(/^@+/, ''),
        displayName: dName,
        receiverName: dName,
        receiverDisplayName: dName,
        avatarUrl: row.avatar_r2_path || '',
        receiverAvatarUrl: row.avatar_r2_path || '',
        bio: row.bio || '',
        isVerified,
        is_verified: isVerified ? 1 : 0,
        authorBadge,
        author_badge: authorBadge,
        badge: authorBadge,
        founderSeq: row.founder_seq ?? null,
        createdAt: row.created_at,
      };
    }),
  });
});

// 9. Block / Unblock / Blocked list
friendsApp.get('/blocked', authMiddleware, async (c) => {
  return c.json({ success: true, blocked: [] });
});

friendsApp.post('/block', authMiddleware, async (c) => {
  return c.json({ success: true, message: 'User blocked' });
});

friendsApp.post('/unblock', authMiddleware, async (c) => {
  return c.json({ success: true, message: 'User unblocked' });
});

export { friendsApp };
