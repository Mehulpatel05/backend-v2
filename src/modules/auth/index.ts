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
  const tenDigits = cleanDigits.length >= 10 ? cleanDigits.slice(-10) : cleanDigits;
  const e164 = `+91${tenDigits}`;
  const noPlus91 = `91${tenDigits}`;

  // Verify OTP via Wakit Gateway
  const isValidOtp = await WakitService.verifyOtp(requestId, otp, e164);
  if (!isValidOtp) {
    return c.json({ success: false, error: 'Invalid or expired OTP' }, 400);
  }

  const db = getDatabase(c);

  // Check if user exists by phone across all variations (+91, 10-digit, 91, or suffix match)
  // 1. First Priority: Established user account with custom chosen handle
  let user = (await db.prepare(
    `SELECT id, phone, handle, created_at FROM users 
     WHERE (phone = ? OR phone = ? OR phone = ? OR phone LIKE ?)
       AND handle NOT LIKE 'user_%'
       AND handle NOT LIKE '@user_%'
     ORDER BY created_at ASC LIMIT 1`
  )
    .bind(e164, tenDigits, noPlus91, `%${tenDigits}`)
    .first()) as { id: string; phone: string; handle: string } | null;

  // 2. Second Priority: Fallback to the oldest registered user account for this phone
  if (!user) {
    user = (await db.prepare(
      `SELECT id, phone, handle, created_at FROM users 
       WHERE phone = ? OR phone = ? OR phone = ? OR phone LIKE ?
       ORDER BY created_at ASC LIMIT 1`
    )
      .bind(e164, tenDigits, noPlus91, `%${tenDigits}`)
      .first()) as { id: string; phone: string; handle: string } | null;
  }

  let handle = user?.handle ? user.handle.replace(/^@+/, '').trim().toLowerCase() : '';
  let userId = user?.id || '';
  const isNewUser = !user || handle.startsWith('user_') || handle.startsWith('anon#');

  if (!isNewUser) {
    // If an accidental duplicate user was created today with a temporary user_ handle, clean it up
    try {
      await db.prepare(
        `DELETE FROM users 
         WHERE (phone = ? OR phone = ? OR phone = ? OR phone LIKE ?)
           AND id != ? AND (handle LIKE 'user_%' OR handle LIKE '@user_%')`
      ).bind(e164, tenDigits, noPlus91, `%${tenDigits}`, userId).run();
    } catch (_) {}
  } else {
    userId = `u_${Date.now()}`;
    const suffix = tenDigits.slice(-4);
    handle = `user_${suffix}_${Math.floor(1000 + Math.random() * 9000)}`;

    try {
      await db.prepare(
        'INSERT INTO users (id, phone, handle) VALUES (?, ?, ?)'
      )
        .bind(userId, e164, handle)
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
  const refreshTokenHash = await hashToken(refreshToken);

  // Store Device Session with both access token and refresh token hashes
  try {
    await db.prepare(
      `INSERT INTO devices (installation_id, token_hash, refresh_token_hash, user_handle, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(installation_id) DO UPDATE SET
       token_hash = excluded.token_hash,
       refresh_token_hash = excluded.refresh_token_hash,
       user_handle = excluded.user_handle,
       last_seen_at = CURRENT_TIMESTAMP,
       revoked_at = NULL`
    )
      .bind(installationId, tokenHash, refreshTokenHash, handle)
      .run();
  } catch (e) {
    // If refresh_token_hash column is not yet present, fallback to token_hash only
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
    } catch (fallbackErr) {
      console.warn('[handleVerifyOtp] Device session fallback:', fallbackErr);
    }
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
  let newHandle = (body.handle || '').replace(/^@+/, '').trim().toLowerCase();

  if (!newHandle) {
    return c.json({ success: false, error: 'Handle cannot be empty' }, 400);
  }

  const db = getDatabase(c);
  const currentUserHandle = (user.userHandle || '').replace(/^@+/, '').trim().toLowerCase();

  const existing = await db.prepare('SELECT handle FROM users WHERE handle = ? OR handle = ? LIMIT 1')
    .bind(newHandle, `@${newHandle}`)
    .first();

  if (existing && (existing as any).handle.replace(/^@+/, '').trim().toLowerCase() !== currentUserHandle) {
    return c.json({ success: false, error: 'Handle is already taken' }, 409);
  }

  try {
    await db.prepare('UPDATE users SET handle = ? WHERE handle = ? OR handle = ?').bind(newHandle, currentUserHandle, `@${currentUserHandle}`).run();
    await db.prepare('UPDATE profiles SET handle = ? WHERE handle = ? OR handle = ?').bind(newHandle, currentUserHandle, `@${currentUserHandle}`).run();
    await db.prepare('UPDATE devices SET user_handle = ? WHERE installation_id = ?').bind(newHandle, user.installationId).run();
    await db.prepare('UPDATE feed_posts SET author_handle = ? WHERE author_handle = ? OR author_handle = ?').bind(newHandle, currentUserHandle, `@${currentUserHandle}`).run();
    await db.prepare('UPDATE feed_comments SET author_handle = ? WHERE author_handle = ? OR author_handle = ?').bind(newHandle, currentUserHandle, `@${currentUserHandle}`).run();
    await db.prepare('UPDATE feed_likes SET user_handle = ? WHERE user_handle = ? OR user_handle = ?').bind(newHandle, currentUserHandle, `@${currentUserHandle}`).run();
    await db.prepare('UPDATE post_votes SET user_handle = ? WHERE user_handle = ? OR user_handle = ?').bind(newHandle, currentUserHandle, `@${currentUserHandle}`).run();
    await db.prepare('UPDATE bazar_shops SET owner_handle = ? WHERE owner_handle = ? OR owner_handle = ?').bind(newHandle, currentUserHandle, `@${currentUserHandle}`).run();
    await db.prepare('UPDATE bazar_listings SET seller_handle = ? WHERE seller_handle = ? OR seller_handle = ?').bind(newHandle, currentUserHandle, `@${currentUserHandle}`).run();
  } catch (e) {
    console.warn('[handleClaimHandle] update error:', e);
  }

  // Generate fresh session tokens for the claimed handle
  const newAccessToken = generateSecureToken();
  const newRefreshToken = generateSecureToken();
  const newTokenHash = await hashToken(newAccessToken);
  const newRefreshTokenHash = await hashToken(newRefreshToken);

  try {
    await db.prepare(
      'UPDATE devices SET token_hash = ?, refresh_token_hash = ?, user_handle = ?, last_seen_at = CURRENT_TIMESTAMP WHERE installation_id = ?'
    )
      .bind(newTokenHash, newRefreshTokenHash, newHandle, user.installationId)
      .run();
  } catch (_) {
    try {
      await db.prepare(
        'UPDATE devices SET token_hash = ?, user_handle = ?, last_seen_at = CURRENT_TIMESTAMP WHERE installation_id = ?'
      )
        .bind(newTokenHash, newHandle, user.installationId)
        .run();
    } catch (_) {}
  }

  return c.json({
    success: true,
    handle: newHandle,
    access_token: newAccessToken,
    refresh_token: newRefreshToken,
    sessionToken: newAccessToken,
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

// Refresh Token: strictly verify refresh token and issue rotated access + refresh tokens
authApp.post('/refresh', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const refreshToken = (body.refresh_token || body.refreshToken || '').toString().trim();

  if (!refreshToken) {
    return c.json({ success: false, error: 'Refresh token is required' }, 400);
  }

  const db = getDatabase(c);
  const refreshHash = await hashToken(refreshToken);

  let session: any = null;
  try {
    session = await db.prepare(
      'SELECT installation_id, token_hash, refresh_token_hash, user_handle, revoked_at FROM devices WHERE refresh_token_hash = ? OR token_hash = ? LIMIT 1'
    )
      .bind(refreshHash, refreshHash)
      .first();
  } catch (e) {
    // Fallback if column not yet added
    session = await db.prepare(
      'SELECT installation_id, token_hash, user_handle, revoked_at FROM devices WHERE token_hash = ? LIMIT 1'
    )
      .bind(refreshHash)
      .first();
  }

  if (!session) {
    return c.json({ success: false, error: 'Unauthorized: Invalid refresh token' }, 401);
  }

  if (session.revoked_at) {
    return c.json({ success: false, error: 'Unauthorized: Session has been revoked' }, 401);
  }

  const newAccess = generateSecureToken();
  const newRefresh = generateSecureToken();
  const newAccessHash = await hashToken(newAccess);
  const newRefreshHash = await hashToken(newRefresh);

  try {
    await db.prepare(
      'UPDATE devices SET token_hash = ?, refresh_token_hash = ?, last_seen_at = CURRENT_TIMESTAMP WHERE installation_id = ?'
    )
      .bind(newAccessHash, newRefreshHash, session.installation_id)
      .run();
  } catch (e) {
    try {
      await db.prepare(
        'UPDATE devices SET token_hash = ?, last_seen_at = CURRENT_TIMESTAMP WHERE installation_id = ?'
      )
        .bind(newAccessHash, session.installation_id)
        .run();
    } catch (_) {}
  }

  return c.json({
    success: true,
    access_token: newAccess,
    refresh_token: newRefresh,
    sessionToken: newAccess,
    token: newAccess,
    expires_in: 30 * 86400,
  });
});


// Avatar Update / Removal
authApp.post('/profile/avatar', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const avatarUrl = body.avatarUrl || body.avatar_url || body.avatar_r2_path || '';

  const db = getDatabase(c);
  await db.prepare('UPDATE profiles SET avatar_r2_path = ?, updated_at = CURRENT_TIMESTAMP WHERE handle = ? OR handle = ?')
    .bind(avatarUrl, user.userHandle, `@${user.userHandle}`)
    .run();

  return c.json({
    success: true,
    avatarUrl,
    message: 'Avatar updated successfully',
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
