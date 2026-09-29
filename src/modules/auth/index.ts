import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware, hashToken } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';
import { WakitService } from '../../services/wakit_service';

const authApp = new Hono<{ Bindings: Env; Variables: Variables }>();

function generateSecureToken(): string {
  const buffer = new Uint8Array(32);
  crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Handler for Send OTP
async function handleSendOtp(c: any) {
  const body = await c.req.json().catch(() => ({}));
  const rawPhone = body.phoneNumber || body.phone_number || body.phone || '';
  const phone = rawPhone.toString().trim();

  if (!phone || phone.length < 8) {
    return c.json({ success: false, error: 'Valid phone number is required' }, 400);
  }

  const cleanDigits = phone.replace(/\D/g, '');
  const e164 = cleanDigits.length === 10 ? `+91${cleanDigits}` : `+${cleanDigits}`;

  // Call Wakit WhatsApp OTP Service
  const otpRes = await WakitService.sendOtp(e164);

  if (!otpRes.success) {
    return c.json({
      success: false,
      error: otpRes.error || 'Failed to send OTP via WhatsApp gateway',
    }, 500);
  }

  const requestId = otpRes.requestId || `req_${Date.now()}`;

  return c.json({
    success: true,
    requestId,
    request_id: requestId,
    phone: e164,
    phoneNumber: e164,
    message: 'OTP sent successfully to ' + e164,
  });
}

authApp.post('/send-otp', handleSendOtp);
authApp.post('/otp/send', handleSendOtp);

// Handler for Verify OTP
async function handleVerifyOtp(c: any) {
  const body = await c.req.json().catch(() => ({}));
  const rawPhone = body.phoneNumber || body.phone_number || body.phone || '';
  const phone = rawPhone.toString().trim();
  const otp = (body.otp || body.code || '').toString().trim();
  const requestId = (body.requestId || body.request_id || '').toString().trim();
  const installationId = (body.installationId || body.installation_id || `inst_${Date.now()}`).toString().trim();

  if (!otp) {
    return c.json({ success: false, error: 'OTP code is required' }, 400);
  }

  const cleanDigits = phone.replace(/\D/g, '');
  const e164 = cleanDigits.length === 10 ? `+91${cleanDigits}` : (cleanDigits ? `+${cleanDigits}` : '');

  // Verify OTP via Wakit Gateway
  const isValidOtp = await WakitService.verifyOtp(requestId, otp, e164);
  if (!isValidOtp) {
    return c.json({ success: false, error: 'Invalid or expired OTP' }, 400);
  }

  const db = getDatabase(c);

  // Check if user exists by phone
  let user = (await db.prepare('SELECT id, phone, handle FROM users WHERE phone = ? LIMIT 1')
    .bind(e164 || `phone_${installationId.slice(-8)}`)
    .first()) as { id: string; phone: string; handle: string } | null;

  let handle = user?.handle ? user.handle.replace(/^@+/, '').trim() : '';
  let userId = user?.id || '';
  const isNewUser = !user;

  if (isNewUser) {
    userId = `u_${Date.now()}`;
    const suffix = e164 ? e164.slice(-4) : Math.floor(1000 + Math.random() * 9000).toString();
    handle = `user_${suffix}_${Math.floor(1000 + Math.random() * 9000)}`;

    try {
      await db.prepare(
        'INSERT INTO users (id, phone, handle) VALUES (?, ?, ?)'
      )
        .bind(userId, e164 || `guest_${userId}`, handle)
        .run();

      await db.prepare(
        'INSERT INTO profiles (handle, user_id, display_name) VALUES (?, ?, ?)'
      )
        .bind(handle, userId, `User ${suffix}`)
        .run();
    } catch (e) {
      console.warn('[handleVerifyOtp] User creation fallback:', e);
    }
  }

  // Generate Session Tokens
  const sessionToken = generateSecureToken();
  const refreshToken = generateSecureToken();
  const tokenHash = await hashToken(sessionToken);

  // Store Device Session
  try {
    await db.prepare(
      `INSERT INTO devices (installation_id, token_hash, user_handle, created_at, last_seen_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(installation_id) DO UPDATE SET
       token_hash = excluded.token_hash,
       user_handle = excluded.user_handle,
       last_seen_at = CURRENT_TIMESTAMP,
       revoked_at = NULL`
    )
      .bind(installationId, tokenHash, handle)
      .run();
  } catch (e) {
    console.warn('[handleVerifyOtp] Device session fallback:', e);
  }

  return c.json({
    success: true,
    access_token: sessionToken,
    refresh_token: refreshToken,
    sessionToken,
    user: {
      userId,
      phoneNumber: e164,
      handle,
      isNewUser,
    },
    message: 'Authenticated successfully',
  });
}

authApp.post('/verify-otp', handleVerifyOtp);
authApp.post('/otp/verify', handleVerifyOtp);

// Handler for Claim Handle
async function handleClaimHandle(c: any) {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  let newHandle = (body.handle || '').replace(/^@+/, '').trim();

  if (!newHandle) {
    return c.json({ success: false, error: 'Handle cannot be empty' }, 400);
  }

  const db = getDatabase(c);
  const currentUserHandle = (user.userHandle || '').replace(/^@+/, '').trim();

  const existing = await db.prepare('SELECT handle FROM users WHERE handle = ? OR handle = ? LIMIT 1')
    .bind(newHandle, `@${newHandle}`)
    .first();

  if (existing && (existing as any).handle.replace(/^@+/, '').trim() !== currentUserHandle) {
    return c.json({ success: false, error: 'Handle is already taken' }, 409);
  }

  try {
    await db.batch([
      db.prepare('UPDATE users SET handle = ? WHERE handle = ? OR handle = ?').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE profiles SET handle = ? WHERE handle = ? OR handle = ?').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE devices SET user_handle = ? WHERE installation_id = ?').bind(newHandle, user.installationId),
    ]);
  } catch (e) {
    console.warn('[handleClaimHandle] update error:', e);
  }

  return c.json({
    success: true,
    handle: newHandle,
    message: 'Handle claimed successfully',
  });
}

authApp.post('/claim-handle', authMiddleware, handleClaimHandle);
authApp.post('/handle/claim', authMiddleware, handleClaimHandle);
authApp.post('/profile/handle', authMiddleware, handleClaimHandle);

// Check Handle Available
authApp.get('/check-handle', async (c) => {
  const raw = c.req.query('handle') || '';
  const handle = raw.replace(/^@+/, '').trim();

  if (!handle) {
    return c.json({ success: false, available: false, error: 'Handle required' }, 400);
  }

  const db = getDatabase(c);
  const existing = await db.prepare('SELECT handle FROM users WHERE handle = ? OR handle = ? LIMIT 1')
    .bind(handle, `@${handle}`)
    .first();

  return c.json({
    success: true,
    available: !existing,
    handle,
  });
});

// Refresh Token
authApp.post('/refresh', async (c) => {
  const newAccess = generateSecureToken();
  const newRefresh = generateSecureToken();
  return c.json({
    success: true,
    access_token: newAccess,
    refresh_token: newRefresh,
  });
});

// 5. GET Profile for Current Logged in User
authApp.get('/profile', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = getDatabase(c);

  const u = (await db.prepare('SELECT id, phone, handle FROM users WHERE handle = ? OR handle = ? LIMIT 1')
    .bind(user.userHandle, `@${user.userHandle}`)
    .first()) as any;

  const profile = (await db.prepare('SELECT * FROM profiles WHERE handle = ? OR handle = ? LIMIT 1')
    .bind(user.userHandle, `@${user.userHandle}`)
    .first()) as any;

  return c.json({
    success: true,
    user: {
      userId: u?.id || '',
      phoneNumber: u?.phone || '',
      handle: user.userHandle.replace(/^@+/, ''),
      displayName: profile?.display_name || user.userHandle.replace(/^@+/, ''),
      avatarUrl: profile?.avatar_r2_path || '',
      bio: profile?.bio || '',
      friendCount: profile?.friend_count || 0,
    },
  });
});

// 5.1 GET Public Profile by handle
authApp.get('/profile/:handle', async (c) => {
  const rawParam = c.req.param('handle') || '';
  const handle = rawParam.replace(/^@+/, '').trim();
  const db = getDatabase(c);

  const profile = (await db.prepare('SELECT * FROM profiles WHERE handle = ? OR handle = ? LIMIT 1')
    .bind(handle, `@${handle}`)
    .first()) as any;

  const u = (await db.prepare('SELECT id, handle, phone FROM users WHERE handle = ? OR handle = ? LIMIT 1')
    .bind(handle, `@${handle}`)
    .first()) as any;

  if (!profile && !u) {
    return c.json({
      success: true,
      user: {
        handle: handle,
        displayName: handle,
        avatarUrl: '',
        bio: '',
        friendCount: 0,
      }
    });
  }

  return c.json({
    success: true,
    user: {
      userId: u?.id || '',
      handle: handle,
      displayName: profile?.display_name || handle,
      avatarUrl: profile?.avatar_r2_path || '',
      bio: profile?.bio || '',
      friendCount: profile?.friend_count || 0,
    },
    profile: profile ? {
      ...profile,
      handle: handle,
    } : null,
  });
});

// 6. DELETE Account permanently
authApp.delete('/account', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = getDatabase(c);

  try {
    await db.batch([
      db.prepare('DELETE FROM devices WHERE user_handle = ? OR installation_id = ?').bind(user.userHandle, user.installationId),
      db.prepare('DELETE FROM profiles WHERE handle = ?').bind(user.userHandle),
      db.prepare('DELETE FROM bazar_listings WHERE seller_handle = ?').bind(user.userHandle),
      db.prepare('DELETE FROM bazar_shops WHERE owner_handle = ?').bind(user.userHandle),
      db.prepare('DELETE FROM bazar_saved WHERE user_handle = ?').bind(user.userHandle),
      db.prepare('DELETE FROM feed_posts WHERE author_handle = ?').bind(user.userHandle),
      db.prepare('DELETE FROM feed_likes WHERE user_handle = ?').bind(user.userHandle),
      db.prepare('DELETE FROM feed_comments WHERE author_handle = ?').bind(user.userHandle),
      db.prepare('DELETE FROM friend_requests WHERE sender_handle = ? OR receiver_handle = ?').bind(user.userHandle, user.userHandle),
      db.prepare('DELETE FROM friendships WHERE user1_handle = ? OR user2_handle = ?').bind(user.userHandle, user.userHandle),
      db.prepare('DELETE FROM notifications WHERE target_handle = ? OR sender_handle = ?').bind(user.userHandle, user.userHandle),
      db.prepare('DELETE FROM users WHERE handle = ?').bind(user.userHandle),
    ]);
  } catch (e) {
    console.error('[deleteAccount] D1 batch delete error:', e);
  }

  return c.json({
    success: true,
    message: 'Account deleted permanently',
  });
});

// Get Current Auth State (Me)
authApp.get('/me', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = getDatabase(c);
  const profile = await db.prepare('SELECT * FROM profiles WHERE handle = ? LIMIT 1')
    .bind(user.userHandle)
    .first();

  return c.json({
    success: true,
    user: {
      handle: user.userHandle,
      installationId: user.installationId,
      profile: profile || null,
    },
  });
});

export { authApp };
