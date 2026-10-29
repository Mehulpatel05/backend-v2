import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { getDatabase } from '../../db/db_context';
import { sendPushNotification } from '../../services/fcm_service';
import { authMiddleware } from '../../middleware/auth';

export const callsApp = new Hono<{ Bindings: Env; Variables: Variables }>();

callsApp.use('*', authMiddleware);

function getVerifiedHandle(c: any): string {
  const verifiedUser = c.get('user');
  return (verifiedUser?.userHandle || verifiedUser?.handle || '').replace(/^@+/, '').trim().toLowerCase();
}

function ensureUtcIso(val: any): string {
  if (!val) return new Date().toISOString();
  let s = String(val).trim();
  if (!s.endsWith('Z') && !s.includes('+') && !/-\d\d:\d\d$/.test(s)) {
    s = s.replace(' ', 'T') + 'Z';
  }
  return s;
}

callsApp.post('/initiate', async (c) => {
  const verifiedHandle = getVerifiedHandle(c);
  if (!verifiedHandle) {
    return c.json({ success: false, error: 'Unauthorized caller identity' }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const caller = (body.caller || body.callerHandle || '').replace(/^@+/, '').trim();
  const receiver = (body.receiver || body.receiverHandle || '').replace(/^@+/, '').trim();
  const callType = 'audio';
  const sdpOffer = body.sdpOffer || body.sdp_offer || '';

  if (!caller || !receiver || !sdpOffer) {
    return c.json({ success: false, error: 'Missing required parameters' }, 400);
  }

  if (caller.toLowerCase() !== verifiedHandle) {
    return c.json({ success: false, error: 'Unauthorized caller identity' }, 403);
  }

  const db = getDatabase(c);

  try {
    const blockCheck = await db.prepare(
      'SELECT 1 FROM user_blocks WHERE (LOWER(blocker_handle) = ? OR LOWER(blocker_handle) = ?) AND (LOWER(blocked_handle) = ? OR LOWER(blocked_handle) = ?) LIMIT 1'
    )
      .bind(receiver.toLowerCase(), `@${receiver.toLowerCase()}`, caller.toLowerCase(), `@${caller.toLowerCase()}`)
      .first();

    if (blockCheck) {
      return c.json({ success: false, error: 'Recipient is not accepting calls from you' }, 403);
    }

    const prefRow = (await db.prepare(
      'SELECT call_privacy FROM user_preferences WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ? LIMIT 1'
    )
      .bind(receiver.toLowerCase(), `@${receiver.toLowerCase()}`)
      .first()) as any;

    const callPrivacy = prefRow?.call_privacy || 'everyone';
    if (callPrivacy === 'nobody') {
      return c.json({ success: false, error: 'Recipient is not accepting calls' }, 403);
    }

    if (callPrivacy === 'contacts' || callPrivacy === 'friends') {
      const friendCheck = await db.prepare(
        'SELECT 1 FROM friendships WHERE ((LOWER(user1_handle) = ? OR LOWER(user1_handle) = ?) AND (LOWER(user2_handle) = ? OR LOWER(user2_handle) = ?)) OR ((LOWER(user2_handle) = ? OR LOWER(user2_handle) = ?) AND (LOWER(user1_handle) = ? OR LOWER(user1_handle) = ?)) LIMIT 1'
      )
        .bind(
          caller.toLowerCase(), `@${caller.toLowerCase()}`,
          receiver.toLowerCase(), `@${receiver.toLowerCase()}`,
          caller.toLowerCase(), `@${caller.toLowerCase()}`,
          receiver.toLowerCase(), `@${receiver.toLowerCase()}`
        )
        .first();

      if (!friendCheck) {
        return c.json({ success: false, error: 'Only friends can call this user' }, 403);
      }
    }

    const rawCallId = (body.callId || body.id || '').toString().trim();
    const id = rawCallId && rawCallId.startsWith('call_')
      ? rawCallId
      : `call_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

    await db.prepare(
      'INSERT INTO calls (id, caller_handle, receiver_handle, call_type, status, sdp_offer, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)'
    )
      .bind(id, caller, receiver, callType, 'calling', sdpOffer)
      .run();

    sendPushNotification({
      targetHandle: receiver,
      title: 'Incoming Audio Call',
      body: `@${caller} is calling you...`,
      channelId: 'nearhood_calls',
      data: {
        type: 'call_incoming',
        callId: id,
        callerHandle: caller,
        receiverHandle: receiver,
        callType: callType,
      },
      db,
    }).catch(() => {});

    return c.json({ success: true, callId: id }, 201);
  } catch (e: any) {
    return c.json({ success: false, error: e.message || 'Failed to initiate call' }, 500);
  }
});

callsApp.get('/active', async (c) => {
  const verifiedHandle = getVerifiedHandle(c);
  if (!verifiedHandle) {
    return c.json({ success: false, error: 'Unauthorized handle access' }, 401);
  }

  const handle = (c.req.query('handle') || '').replace(/^@+/, '').trim().toLowerCase();
  const targetHandle = handle || verifiedHandle;

  if (targetHandle !== verifiedHandle) {
    return c.json({ success: false, error: 'Unauthorized handle access' }, 403);
  }

  const db = getDatabase(c);
  try {
    const row = (await db.prepare(
      "SELECT * FROM calls WHERE (LOWER(receiver_handle) = ? OR LOWER(receiver_handle) = ?) AND status IN ('calling', 'ringing') AND created_at >= datetime('now', '-45 seconds') ORDER BY created_at DESC LIMIT 1"
    )
      .bind(targetHandle, `@${targetHandle}`)
      .first()) as any;

    if (!row) {
      return c.json({ success: true, call: null });
    }

    let callerCandidates = [];
    let receiverCandidates = [];
    try {
      callerCandidates = JSON.parse(row.caller_candidates_json || '[]');
    } catch (_) {}
    try {
      receiverCandidates = JSON.parse(row.receiver_candidates_json || '[]');
    } catch (_) {}

    return c.json({
      success: true,
      call: {
        id: row.id,
        callerHandle: row.caller_handle,
        receiverHandle: row.receiver_handle,
        callType: row.call_type,
        status: row.status,
        createdAt: ensureUtcIso(row.created_at),
        startedAt: ensureUtcIso(row.created_at),
        endedAt: row.ended_at ? ensureUtcIso(row.ended_at) : null,
        durationSeconds: row.duration_seconds || 0,
        sdpOffer: row.sdp_offer,
        sdpAnswer: row.sdp_answer,
        callerIceCandidates: callerCandidates,
        receiverIceCandidates: receiverCandidates,
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || 'Failed to fetch active call' }, 500);
  }
});

callsApp.get('/:id', async (c) => {
  const verifiedHandle = getVerifiedHandle(c);
  if (!verifiedHandle) {
    return c.json({ success: false, error: 'Unauthorized to view this call' }, 401);
  }

  const id = c.req.param('id');
  const db = getDatabase(c);

  try {
    const row = (await db.prepare('SELECT * FROM calls WHERE id = ? LIMIT 1').bind(id).first()) as any;
    if (!row) {
      return c.json({ success: false, error: 'Call not found' }, 404);
    }

    const callerClean = (row.caller_handle || '').replace(/^@+/, '').trim().toLowerCase();
    const receiverClean = (row.receiver_handle || '').replace(/^@+/, '').trim().toLowerCase();

    if (verifiedHandle !== callerClean && verifiedHandle !== receiverClean) {
      return c.json({ success: false, error: 'Unauthorized to view this call' }, 403);
    }

    let callerCandidates = [];
    let receiverCandidates = [];
    try {
      callerCandidates = JSON.parse(row.caller_candidates_json || '[]');
    } catch (_) {}
    try {
      receiverCandidates = JSON.parse(row.receiver_candidates_json || '[]');
    } catch (_) {}

    return c.json({
      success: true,
      call: {
        id: row.id,
        callerHandle: row.caller_handle,
        receiverHandle: row.receiver_handle,
        callType: row.call_type,
        status: row.status,
        createdAt: ensureUtcIso(row.created_at),
        startedAt: ensureUtcIso(row.created_at),
        endedAt: row.ended_at ? ensureUtcIso(row.ended_at) : null,
        durationSeconds: row.duration_seconds || 0,
        sdpOffer: row.sdp_offer,
        sdpAnswer: row.sdp_answer,
        callerIceCandidates: callerCandidates,
        receiverIceCandidates: receiverCandidates,
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || 'Failed to fetch call' }, 500);
  }
});

callsApp.post('/:id/answer', async (c) => {
  const verifiedHandle = getVerifiedHandle(c);
  if (!verifiedHandle) {
    return c.json({ success: false, error: 'Unauthorized to answer call' }, 401);
  }

  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const sdpAnswer = body.sdpAnswer || body.sdp_answer || '';

  if (!sdpAnswer) {
    return c.json({ success: false, error: 'Missing sdpAnswer' }, 400);
  }

  const db = getDatabase(c);
  try {
    const row = (await db.prepare('SELECT caller_handle, receiver_handle FROM calls WHERE id = ? LIMIT 1').bind(id).first()) as any;
    if (!row) {
      return c.json({ success: false, error: 'Call not found' }, 404);
    }

    const receiverClean = (row.receiver_handle || '').replace(/^@+/, '').trim().toLowerCase();
    if (verifiedHandle !== receiverClean) {
      return c.json({ success: false, error: 'Only the call recipient can answer' }, 403);
    }

    await db.prepare("UPDATE calls SET sdp_answer = ?, status = 'connected' WHERE id = ?").bind(sdpAnswer, id).run();
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || 'Failed to answer call' }, 500);
  }
});

callsApp.post('/:id/ice', async (c) => {
  const verifiedHandle = getVerifiedHandle(c);
  if (!verifiedHandle) {
    return c.json({ success: false, error: 'Unauthorized candidate submission' }, 401);
  }

  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const handle = (body.handle || verifiedHandle).replace(/^@+/, '').trim().toLowerCase();
  const candidate = body.candidate;

  if (!candidate) {
    return c.json({ success: false, error: 'Missing candidate' }, 400);
  }

  if (handle !== verifiedHandle) {
    return c.json({ success: false, error: 'Unauthorized candidate submission' }, 403);
  }

  const db = getDatabase(c);
  try {
    const row = (await db.prepare('SELECT caller_handle, receiver_handle, caller_candidates_json, receiver_candidates_json FROM calls WHERE id = ? LIMIT 1').bind(id).first()) as any;
    if (!row) {
      return c.json({ success: false, error: 'Call not found' }, 404);
    }

    const callerClean = (row.caller_handle || '').replace(/^@+/, '').trim().toLowerCase();
    const receiverClean = (row.receiver_handle || '').replace(/^@+/, '').trim().toLowerCase();

    if (verifiedHandle === callerClean) {
      let list = [];
      try {
        list = JSON.parse(row.caller_candidates_json || '[]');
      } catch (_) {}
      list.push(candidate);
      await db.prepare('UPDATE calls SET caller_candidates_json = ? WHERE id = ?').bind(JSON.stringify(list), id).run();
    } else if (verifiedHandle === receiverClean) {
      let list = [];
      try {
        list = JSON.parse(row.receiver_candidates_json || '[]');
      } catch (_) {}
      list.push(candidate);
      await db.prepare('UPDATE calls SET receiver_candidates_json = ? WHERE id = ?').bind(JSON.stringify(list), id).run();
    } else {
      return c.json({ success: false, error: 'Unauthorized call participant' }, 403);
    }

    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || 'Failed to update ICE candidate' }, 500);
  }
});

callsApp.post('/:id/status', async (c) => {
  const verifiedHandle = getVerifiedHandle(c);
  if (!verifiedHandle) {
    return c.json({ success: false, error: 'Unauthorized to update call status' }, 401);
  }

  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const status = (body.status || 'ended').toLowerCase();
  const durationSeconds = Number.isInteger(body.durationSeconds) ? body.durationSeconds : (Number(body.durationSeconds) || 0);

  const db = getDatabase(c);
  try {
    const row = (await db.prepare('SELECT caller_handle, receiver_handle, status FROM calls WHERE id = ? LIMIT 1').bind(id).first()) as any;
    if (!row) {
      return c.json({ success: false, error: 'Call not found' }, 404);
    }

    const callerClean = (row.caller_handle || '').replace(/^@+/, '').trim().toLowerCase();
    const receiverClean = (row.receiver_handle || '').replace(/^@+/, '').trim().toLowerCase();

    if (verifiedHandle !== callerClean && verifiedHandle !== receiverClean) {
      return c.json({ success: false, error: 'Unauthorized to update call status' }, 403);
    }

    await db.prepare('UPDATE calls SET status = ?, duration_seconds = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(status, durationSeconds, id)
      .run();

    if (status === 'missed' || status === 'ended' || status === 'rejected' || status === 'cancelled') {
      const targetPushHandle = verifiedHandle === callerClean ? row.receiver_handle : row.caller_handle;
      sendPushNotification({
        targetHandle: targetPushHandle,
        title: 'Call Ended',
        body: 'Call ended',
        channelId: 'nearhood_calls',
        data: {
          type: 'call_cancelled',
          callId: id,
        },
        db,
      }).catch(() => {});
    }

    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || 'Failed to update call status' }, 500);
  }
});
