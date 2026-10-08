import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware, hashToken, SESSION_TTL_DAYS } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';
import { AppConfig } from '../../utils/config';
import { Fast2SmsService } from '../../services/fast2sms_service';
import { orchestrateAccountDeletion } from '../account_deletion';

const authApp = new Hono<{ Bindings: Env; Variables: Variables }>();

function generateSecureToken(): string {
  const buffer = new Uint8Array(32);
  crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Indian mobile numbers: 10 digits starting 6-9. */
const PHONE_RE = /^[6-9]\d{9}$/;

function normalizePhone(raw: unknown): { ok: boolean; tenDigits: string; e164: string; noPlus91: string } {
  const phone = (raw ?? '').toString().trim();
  const cleanDigits = phone.replace(/\D/g, '');
  const tenDigits = cleanDigits.length >= 10 ? cleanDigits.slice(-10) : cleanDigits;
  return {
    ok: PHONE_RE.test(tenDigits),
    tenDigits,
    e164: `+91${tenDigits}`,
    noPlus91: `91${tenDigits}`,
  };
}

/**
 * Review/QA shortcut numbers. Gated behind an explicit opt-in so the
 * '123456' backdoor cannot be used against a production deployment.
 */
const TEST_PHONES = ['0000000000', '9999999999'];

function testOtpAllowed(): boolean {
  if (AppConfig.isProduction) return false;
  return (process.env.ALLOW_TEST_OTP || '').trim().toLowerCase() === 'true';
}

function isTestPhone(tenDigits: string): boolean {
  return testOtpAllowed() && TEST_PHONES.includes(tenDigits);
}

// Rate limits for OTP sending (per phone number).
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_SENDS_PER_HOUR = 5;

// Handler for Send OTP
async function handleSendOtp(c: any) {
  const body = await c.req.json().catch(() => ({}));
  const { ok, tenDigits, e164 } = normalizePhone(
    body.phoneNumber || body.phone_number || body.phone || ''
  );

  if (!ok) {
    return c.json({ success: false, error: 'Enter a valid 10-digit Indian mobile number' }, 400);
  }

  const db = getDatabase(c);
  const testPhone = isTestPhone(tenDigits);

  // Rate limit: short resend cooldown plus an hourly cap, both per phone.
  if (!testPhone) {
    try {
      const existing = (await db.prepare(
        `SELECT send_count,
                CASE WHEN created_at > datetime('now', '-${OTP_RESEND_COOLDOWN_SECONDS} seconds') THEN 1 ELSE 0 END AS in_cooldown,
                CASE WHEN window_started_at IS NULL OR window_started_at <= datetime('now', '-1 hour') THEN 1 ELSE 0 END AS window_stale
           FROM phone_otps WHERE phone = ? LIMIT 1`
      ).bind(tenDigits).first()) as any;

      if (existing) {
        if (existing.in_cooldown === 1) {
          return c.json(
            {
              success: false,
              error: `Please wait ${OTP_RESEND_COOLDOWN_SECONDS} seconds before requesting another OTP.`,
              retryAfter: OTP_RESEND_COOLDOWN_SECONDS,
            },
            429
          );
        }
        if (existing.window_stale === 0 && (existing.send_count || 0) >= OTP_MAX_SENDS_PER_HOUR) {
          return c.json(
            {
              success: false,
              error: 'Too many OTP requests for this number. Please try again in an hour.',
            },
            429
          );
        }
      }
    } catch (rateErr) {
      console.warn('[handleSendOtp] Rate limit check failed:', rateErr);
    }
  }

  const otpCode = testPhone ? '123456' : Math.floor(100000 + Math.random() * 900000).toString();
  const requestId = `req_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

  // Store in database with 5-minute expiry
  try {
    await db.prepare(
      `INSERT INTO phone_otps (phone, otp_code, request_id, attempts, expires_at, created_at, send_count, window_started_at)
       VALUES (?, ?, ?, 0, datetime('now', '+5 minutes'), CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(phone) DO UPDATE SET
         otp_code = excluded.otp_code,
         request_id = excluded.request_id,
         attempts = 0,
         expires_at = datetime('now', '+5 minutes'),
         created_at = CURRENT_TIMESTAMP,
         send_count = CASE
           WHEN phone_otps.window_started_at IS NULL
             OR phone_otps.window_started_at <= datetime('now', '-1 hour')
           THEN 1
           ELSE phone_otps.send_count + 1
         END,
         window_started_at = CASE
           WHEN phone_otps.window_started_at IS NULL
             OR phone_otps.window_started_at <= datetime('now', '-1 hour')
           THEN CURRENT_TIMESTAMP
           ELSE phone_otps.window_started_at
         END`
    ).bind(tenDigits, otpCode, requestId).run();
  } catch (dbErr) {
    // A failure here means we cannot verify the OTP later, so do not pretend
    // the send succeeded.
    console.error('[handleSendOtp] Failed to record OTP in phone_otps table:', dbErr);
    return c.json({ success: false, error: 'Could not start verification. Please try again.' }, 500);
  }

  // Fast2SMS Delivery (bypassed only for explicitly enabled test numbers)
  if (!testPhone) {
    const f2sRes = await Fast2SmsService.sendOtp(tenDigits, otpCode);
    if (!f2sRes.success) {
      return c.json({
        success: false,
        error: f2sRes.error || 'Failed to send SMS OTP via Fast2SMS',
      }, 500);
    }
  }

  return c.json({
    success: true,
    requestId,
    request_id: requestId,
    phone: e164,
    phoneNumber: e164,
    expiresIn: 300,
    expires_in: 300,
    message: 'OTP sent successfully to ' + e164,
  });
}

authApp.post('/send-otp', handleSendOtp);
authApp.post('/otp/send', handleSendOtp);

// Handler for Verify OTP
async function handleVerifyOtp(c: any) {
  const body = await c.req.json().catch(() => ({}));
  const otp = (body.otp || body.code || '').toString().trim();
  const requestId = (body.requestId || body.request_id || '').toString().trim();
  const installationId = (body.installationId || body.installation_id || `inst_${Date.now()}`).toString().trim();

  if (!otp) {
    return c.json({ success: false, error: 'OTP code is required' }, 400);
  }

  // The phone number decides which account we log into, so it must be valid.
  // Previously an empty phone produced `phone LIKE '%'`, which matched every
  // row and logged the caller into the oldest account in the database.
  const { ok, tenDigits, e164, noPlus91 } = normalizePhone(
    body.phoneNumber || body.phone_number || body.phone || ''
  );
  if (!ok) {
    return c.json({ success: false, error: 'Enter a valid 10-digit Indian mobile number' }, 400);
  }

  const db = getDatabase(c);
  let isValidOtp = false;

  // 1. Explicitly enabled dev/review test numbers (never in production)
  if (isTestPhone(tenDigits) && (otp === '123456' || otp === '000000')) {
    isValidOtp = true;
  }

  // 2. Check local phone_otps table (used by Fast2SMS & server-generated OTPs)
  //
  // The lookup is keyed on `phone` ONLY. Matching on `request_id` as well
  // allowed an attacker to pair their own request_id and OTP with a victim's
  // phone number and take over that account.
  if (!isValidOtp) {
    try {
      const otpRow = (await db.prepare(
        `SELECT phone, otp_code, request_id, attempts,
                CASE WHEN expires_at <= datetime('now') THEN 1 ELSE 0 END AS is_expired
           FROM phone_otps
          WHERE phone = ?
          LIMIT 1`
      ).bind(tenDigits).first()) as any;

      if (!otpRow) {
        return c.json({ success: false, error: 'No pending OTP for this number. Please request a new one.' }, 400);
      }

      // Expiry is compared inside SQLite (UTC). Doing it in JS with
      // `new Date("YYYY-MM-DD HH:MM:SS")` parsed the value as local time and
      // skewed every comparison by the server's UTC offset.
      if (otpRow.is_expired === 1) {
        return c.json({ success: false, error: 'OTP has expired. Please request a new one.' }, 400);
      }

      if ((otpRow.attempts ?? 0) >= 5) {
        return c.json({ success: false, error: 'Too many incorrect attempts. Please request a new OTP.' }, 429);
      }

      // When the client supplies a requestId it must belong to this phone's
      // current OTP — a stale or foreign requestId is rejected outright.
      if (requestId && otpRow.request_id && otpRow.request_id !== requestId) {
        await db.prepare('UPDATE phone_otps SET attempts = attempts + 1 WHERE phone = ?').bind(tenDigits).run();
        return c.json({ success: false, error: 'Invalid or expired OTP' }, 400);
      }

      if (otpRow.otp_code === otp) {
        isValidOtp = true;
        try {
          await db.prepare('DELETE FROM phone_otps WHERE phone = ?').bind(tenDigits).run();
        } catch (err) {
          console.warn('[handleVerifyOtp] Failed to clear consumed OTP:', err);
        }
      } else {
        try {
          await db.prepare('UPDATE phone_otps SET attempts = attempts + 1 WHERE phone = ?').bind(tenDigits).run();
        } catch (err) {
          console.warn('[handleVerifyOtp] Failed to record failed attempt:', err);
        }
      }
    } catch (dbErr) {
      console.error('[handleVerifyOtp] phone_otps lookup error:', dbErr);
      return c.json({ success: false, error: 'Could not verify OTP. Please try again.' }, 500);
    }
  }

  if (!isValidOtp) {
    return c.json({ success: false, error: 'Invalid or expired OTP' }, 400);
  }

  // Check if user exists by phone across the stored format variants.
  // `phone LIKE '%...'` was removed: a short or empty suffix matched unrelated
  // accounts.
  // 1. First Priority: Established user account with custom chosen handle
  let user = (await db.prepare(
    `SELECT id, phone, handle, created_at, COALESCE(is_banned, 0) as is_banned FROM users
     WHERE (phone = ? OR phone = ? OR phone = ?)
       AND handle NOT LIKE 'user_%'
       AND handle NOT LIKE '@user_%'
     ORDER BY created_at ASC LIMIT 1`
  )
    .bind(e164, tenDigits, noPlus91)
    .first()) as { id: string; phone: string; handle: string; is_banned?: number } | null;

  // 2. Second Priority: Fallback to the oldest registered user account for this phone
  if (!user) {
    user = (await db.prepare(
      `SELECT id, phone, handle, created_at, COALESCE(is_banned, 0) as is_banned FROM users
       WHERE phone = ? OR phone = ? OR phone = ?
       ORDER BY created_at ASC LIMIT 1`
    )
      .bind(e164, tenDigits, noPlus91)
      .first()) as { id: string; phone: string; handle: string; is_banned?: number } | null;
  }

  if (user && Number(user.is_banned) === 1) {
    return c.json({ success: false, error: 'Your account has been suspended by administration.' }, 403);
  }

  let handle = user?.handle ? user.handle.replace(/^@+/, '').trim().toLowerCase() : '';
  let userId = user?.id || '';
  const isNewUser = !user || handle.startsWith('user_') || handle.startsWith('anon#');

  if (!isNewUser) {
    // If an accidental duplicate user was created today with a temporary user_ handle, clean it up
    try {
      await db.prepare(
        `DELETE FROM users
         WHERE (phone = ? OR phone = ? OR phone = ?)
           AND id != ? AND (handle LIKE 'user_%' OR handle LIKE '@user_%')`
      ).bind(e164, tenDigits, noPlus91, userId).run();
    } catch (err) {
      console.warn('[handleVerifyOtp] Duplicate cleanup failed:', err);
    }
  } else if (user) {
    // Existing placeholder account — reuse it instead of creating a new row on
    // every login (that previously orphaned a users+profiles pair each time).
    userId = user.id;
    handle = user.handle.replace(/^@+/, '').trim().toLowerCase();
  } else {
    const suffix = tenDigits.slice(-4);
    userId = `u_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
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
      // Returning success here would hand out a session for an account that
      // does not exist.
      console.error('[handleVerifyOtp] User creation failed:', e);
      return c.json({ success: false, error: 'Could not create your account. Please try again.' }, 500);
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
      `INSERT INTO devices (installation_id, token_hash, refresh_token_hash, user_handle, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, datetime('now', '+${SESSION_TTL_DAYS} days'))
       ON CONFLICT(installation_id) DO UPDATE SET
       token_hash = excluded.token_hash,
       refresh_token_hash = excluded.refresh_token_hash,
       user_handle = excluded.user_handle,
       last_seen_at = CURRENT_TIMESTAMP,
       expires_at = excluded.expires_at,
       revoked_at = NULL`
    )
      .bind(installationId, tokenHash, refreshTokenHash, handle)
      .run();
  } catch (e) {
    console.error('[handleVerifyOtp] Device session write failed:', e);
    return c.json({ success: false, error: 'Could not start your session. Please try again.' }, 500);
  }

  return c.json({
    success: true,
    access_token: sessionToken,
    refresh_token: refreshToken,
    sessionToken,
    expires_in: SESSION_TTL_DAYS * 86400,
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
  const rawDisplayName = body.displayName ?? body.display_name ?? body.name ?? '';
  const newDisplayName = rawDisplayName.toString().trim();

  if (!newHandle) {
    return c.json({ success: false, error: 'Handle cannot be empty' }, 400);
  }

  if (!/^[a-z0-9_]{3,30}$/.test(newHandle)) {
    return c.json({
      success: false,
      error: 'Username must be 3-30 characters long and contain only lowercase letters, numbers, and underscores (_).'
    }, 400);
  }

  const db = getDatabase(c);
  const currentUserHandle = (user.userHandle || '').replace(/^@+/, '').trim().toLowerCase();

  const currentProfile = (await db.prepare(
    'SELECT * FROM profiles WHERE LOWER(handle) = LOWER(?) OR LOWER(handle) = LOWER(?) LIMIT 1'
  ).bind(currentUserHandle, `@${currentUserHandle}`).first()) as any;

  const isInitialClaim = currentUserHandle.startsWith('user_') || currentUserHandle.startsWith('anon#');
  const handleCooldownMs = 30 * 24 * 60 * 60 * 1000;
  if (!isInitialClaim && currentProfile?.handle_updated_at) {
    const elapsed = Date.now() - new Date(currentProfile.handle_updated_at).getTime();
    if (!isNaN(elapsed) && elapsed < handleCooldownMs) {
      const daysRemaining = Math.max(1, Math.ceil((handleCooldownMs - elapsed) / (24 * 60 * 60 * 1000)));
      return c.json({
        success: false,
        code: 'HANDLE_COOLDOWN',
        daysRemaining,
        error: `Username can only be changed once every 30 days. You can change it again in ${daysRemaining} day(s).`
      }, 400);
    }
  }

  const existing = await db.prepare(
    'SELECT handle FROM users WHERE (LOWER(handle) = LOWER(?) OR LOWER(handle) = LOWER(?)) AND LOWER(handle) != LOWER(?) LIMIT 1'
  )
    .bind(newHandle, `@${newHandle}`, currentUserHandle)
    .first();

  if (existing) {
    return c.json({ success: false, error: `Username @${newHandle} is already taken. Please choose another.` }, 409);
  }

  try {
    const cascadeUpdates = [
      db.prepare('UPDATE users SET handle = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(handle) = LOWER(?) OR LOWER(handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE profiles SET handle = ?, handle_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE LOWER(handle) = LOWER(?) OR LOWER(handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE devices SET user_handle = ? WHERE LOWER(user_handle) = LOWER(?) OR LOWER(user_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE feed_posts SET author_handle = ? WHERE LOWER(author_handle) = LOWER(?) OR LOWER(author_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE feed_comments SET author_handle = ? WHERE LOWER(author_handle) = LOWER(?) OR LOWER(author_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE feed_likes SET user_handle = ? WHERE LOWER(user_handle) = LOWER(?) OR LOWER(user_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE post_votes SET user_handle = ? WHERE LOWER(user_handle) = LOWER(?) OR LOWER(user_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE bazar_shops SET owner_handle = ? WHERE LOWER(owner_handle) = LOWER(?) OR LOWER(owner_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE bazar_listings SET seller_handle = ? WHERE LOWER(seller_handle) = LOWER(?) OR LOWER(seller_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE bazar_saved SET user_handle = ? WHERE LOWER(user_handle) = LOWER(?) OR LOWER(user_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE chats SET user1_handle = ? WHERE LOWER(user1_handle) = LOWER(?) OR LOWER(user1_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE chats SET user2_handle = ? WHERE LOWER(user2_handle) = LOWER(?) OR LOWER(user2_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE chat_messages SET sender_handle = ? WHERE LOWER(sender_handle) = LOWER(?) OR LOWER(sender_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE chat_messages SET receiver_handle = ? WHERE LOWER(receiver_handle) = LOWER(?) OR LOWER(receiver_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE friendships SET user1_handle = ? WHERE LOWER(user1_handle) = LOWER(?) OR LOWER(user1_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE friendships SET user2_handle = ? WHERE LOWER(user2_handle) = LOWER(?) OR LOWER(user2_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE friend_requests SET sender_handle = ? WHERE LOWER(sender_handle) = LOWER(?) OR LOWER(sender_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE friend_requests SET receiver_handle = ? WHERE LOWER(receiver_handle) = LOWER(?) OR LOWER(receiver_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE notifications SET target_handle = ? WHERE LOWER(target_handle) = LOWER(?) OR LOWER(target_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE notifications SET sender_handle = ? WHERE LOWER(sender_handle) = LOWER(?) OR LOWER(sender_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE user_blocks SET blocker_handle = ? WHERE LOWER(blocker_handle) = LOWER(?) OR LOWER(blocker_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
      db.prepare('UPDATE user_blocks SET blocked_handle = ? WHERE LOWER(blocked_handle) = LOWER(?) OR LOWER(blocked_handle) = LOWER(?)').bind(newHandle, currentUserHandle, `@${currentUserHandle}`),
    ];

    if (newDisplayName) {
      cascadeUpdates.push(
        db.prepare('UPDATE profiles SET display_name = ? WHERE LOWER(handle) = LOWER(?)').bind(newDisplayName, newHandle)
      );
    }
    await Promise.allSettled(cascadeUpdates.map((s) => s.run()));

    const optionalTables = [
      { table: 'user_rewards', col: 'user_handle' },
      { table: 'points_ledger', col: 'user_handle' },
      { table: 'user_badges', col: 'user_handle' },
      { table: 'helpful_votes', col: 'voter_handle' },
      { table: 'helpful_votes', col: 'author_handle' },
      { table: 'referrals', col: 'inviter_handle' },
      { table: 'referrals', col: 'invitee_handle' },
      { table: 'listing_boosts', col: 'user_handle' },
      { table: 'shop_coupons', col: 'owner_handle' },
      { table: 'user_coupons', col: 'user_handle' },
      { table: 'user_feedback', col: 'user_handle' },
    ];
    await Promise.allSettled(
      optionalTables.map((opt) =>
        db.prepare(`UPDATE ${opt.table} SET ${opt.col} = ? WHERE LOWER(${opt.col}) = LOWER(?) OR LOWER(${opt.col}) = LOWER(?)`)
          .bind(newHandle, currentUserHandle, `@${currentUserHandle}`)
          .run()
      )
    );

    try {
      const userChats = await db.prepare(
        'SELECT id, canonical_id, user1_handle, user2_handle FROM chats WHERE LOWER(user1_handle) = ? OR LOWER(user2_handle) = ?'
      ).bind(newHandle, newHandle).all() as any;

      for (const chat of userChats?.results || []) {
        const u1 = (chat.user1_handle || '').replace(/^@+/, '').trim().toLowerCase();
        const u2 = (chat.user2_handle || '').replace(/^@+/, '').trim().toLowerCase();
        const targetCanonical = [u1, u2].sort().join('_');

        if (chat.canonical_id !== targetCanonical || chat.id !== targetCanonical) {
          const existing = await db.prepare(
            'SELECT id FROM chats WHERE canonical_id = ? OR id = ? LIMIT 1'
          ).bind(targetCanonical, targetCanonical).first() as any;

          await db.prepare('UPDATE chat_messages SET chat_id = ? WHERE chat_id = ? OR chat_id = ?')
            .bind(targetCanonical, chat.id, chat.canonical_id)
            .run();

          if (existing) {
            await db.prepare('DELETE FROM chats WHERE id = ?').bind(chat.id).run();
          } else {
            await db.prepare('UPDATE chats SET id = ?, canonical_id = ? WHERE id = ?')
              .bind(targetCanonical, targetCanonical, chat.id)
              .run();
          }
        }
      }
    } catch (_) {}
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
      `UPDATE devices
          SET token_hash = ?, refresh_token_hash = ?, user_handle = ?, last_seen_at = CURRENT_TIMESTAMP,
              expires_at = datetime('now', '+${SESSION_TTL_DAYS} days')
        WHERE installation_id = ?`
    )
      .bind(newTokenHash, newRefreshTokenHash, newHandle, user.installationId)
      .run();
  } catch (err) {
    console.error('[handleClaimHandle] Session rotation failed:', err);
    return c.json({ success: false, error: 'Handle saved but session refresh failed. Please sign in again.' }, 500);
  }

  return c.json({
    success: true,
    handle: newHandle,
    name: newDisplayName || newHandle,
    displayName: newDisplayName || newHandle,
    display_name: newDisplayName || newHandle,
    access_token: newAccessToken,
    refresh_token: newRefreshToken,
    sessionToken: newAccessToken,
    user: {
      handle: newHandle,
      name: newDisplayName || newHandle,
      displayName: newDisplayName || newHandle,
      display_name: newDisplayName || newHandle,
    },
    message: 'Handle claimed successfully',
  });
}


authApp.post('/claim-handle', authMiddleware, handleClaimHandle);
authApp.post('/handle/claim', authMiddleware, handleClaimHandle);
authApp.post('/profile/handle', authMiddleware, handleClaimHandle);

// Check Handle Available
authApp.get('/check-handle', async (c) => {
  const raw = c.req.query('handle') || '';
  const handle = raw.replace(/^@+/, '').trim().toLowerCase();

  if (!handle) {
    return c.json({ success: false, available: false, error: 'Handle required' }, 400);
  }

  if (!/^[a-z0-9_]{3,30}$/.test(handle)) {
    return c.json({
      success: false,
      available: false,
      error: 'Username must be 3-30 characters long and contain only lowercase letters, numbers, and underscores (_).'
    }, 400);
  }

  const db = getDatabase(c);
  const existing = await db.prepare('SELECT handle FROM users WHERE LOWER(handle) = LOWER(?) OR LOWER(handle) = LOWER(?) LIMIT 1')
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

  // Only the refresh_token_hash is accepted here. Previously an access token
  // also matched (`OR token_hash = ?`), so a leaked access token could mint
  // fresh token pairs forever.
  let session: any = null;
  try {
    session = await db.prepare(
      `SELECT installation_id, refresh_token_hash, user_handle, revoked_at,
              CASE WHEN expires_at IS NOT NULL AND expires_at <= datetime('now') THEN 1 ELSE 0 END AS is_expired
         FROM devices WHERE refresh_token_hash = ? LIMIT 1`
    )
      .bind(refreshHash)
      .first();
  } catch (e) {
    console.error('[authApp/refresh] Session lookup failed:', e);
    return c.json({ success: false, error: 'Could not refresh session. Please try again.' }, 500);
  }

  if (!session) {
    return c.json({ success: false, error: 'Unauthorized: Invalid refresh token' }, 401);
  }

  if (session.revoked_at) {
    return c.json({ success: false, error: 'Unauthorized: Session has been revoked' }, 401);
  }

  if (session.is_expired === 1) {
    return c.json({ success: false, error: 'Unauthorized: Session expired. Please sign in again.' }, 401);
  }

  const newAccess = generateSecureToken();
  const newRefresh = generateSecureToken();
  const newAccessHash = await hashToken(newAccess);
  const newRefreshHash = await hashToken(newRefresh);

  try {
    await db.prepare(
      `UPDATE devices
          SET token_hash = ?, refresh_token_hash = ?, last_seen_at = CURRENT_TIMESTAMP,
              expires_at = datetime('now', '+${SESSION_TTL_DAYS} days')
        WHERE installation_id = ?`
    )
      .bind(newAccessHash, newRefreshHash, session.installation_id)
      .run();
  } catch (e) {
    console.error('[authApp/refresh] Token rotation failed:', e);
    return c.json({ success: false, error: 'Could not refresh session. Please try again.' }, 500);
  }

  return c.json({
    success: true,
    access_token: newAccess,
    refresh_token: newRefresh,
    sessionToken: newAccess,
    token: newAccess,
    expires_in: SESSION_TTL_DAYS * 86400,
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

  const u = (await db.prepare('SELECT id, phone, handle, is_verified FROM users WHERE handle = ? OR handle = ? LIMIT 1')
    .bind(user.userHandle, `@${user.userHandle}`)
    .first()) as any;

  const profile = (await db.prepare('SELECT * FROM profiles WHERE handle = ? OR handle = ? LIMIT 1')
    .bind(user.userHandle, `@${user.userHandle}`)
    .first()) as any;

  const isVerified = (profile?.is_verified === 1) || (u?.is_verified === 1) || (profile?.bio && profile.bio.includes('[Verified]')) ? 1 : 0;

  const nameElapsed = profile?.name_updated_at ? Date.now() - new Date(profile.name_updated_at).getTime() : Infinity;
  const handleElapsed = profile?.handle_updated_at ? Date.now() - new Date(profile.handle_updated_at).getTime() : Infinity;
  const nameCooldownMs = 14 * 24 * 60 * 60 * 1000;
  const handleCooldownMs = 30 * 24 * 60 * 60 * 1000;

  const canChangeName = !profile?.name_updated_at || isNaN(nameElapsed) || nameElapsed >= nameCooldownMs;
  const canChangeHandle = !profile?.handle_updated_at || isNaN(handleElapsed) || handleElapsed >= handleCooldownMs;

  const nameDaysRemaining = canChangeName ? 0 : Math.max(1, Math.ceil((nameCooldownMs - nameElapsed) / (24 * 60 * 60 * 1000)));
  const handleDaysRemaining = canChangeHandle ? 0 : Math.max(1, Math.ceil((handleCooldownMs - handleElapsed) / (24 * 60 * 60 * 1000)));

  const nextNameChangeAt = canChangeName ? null : new Date(new Date(profile.name_updated_at).getTime() + nameCooldownMs).toISOString();
  const nextHandleChangeAt = canChangeHandle ? null : new Date(new Date(profile.handle_updated_at).getTime() + handleCooldownMs).toISOString();

  return c.json({
    success: true,
    user: {
      userId: u?.id || '',
      phoneNumber: u?.phone || '',
      handle: user.userHandle.replace(/^@+/, ''),
      name: profile?.display_name || user.userHandle.replace(/^@+/, ''),
      displayName: profile?.display_name || user.userHandle.replace(/^@+/, ''),
      display_name: profile?.display_name || user.userHandle.replace(/^@+/, ''),
      avatarUrl: profile?.avatar_r2_path || '',
      bio: profile?.bio || '',
      isVerified: isVerified === 1,
      is_verified: isVerified,
      friendCount: profile?.friend_count || 0,
      nameUpdatedAt: profile?.name_updated_at || null,
      name_updated_at: profile?.name_updated_at || null,
      handleUpdatedAt: profile?.handle_updated_at || null,
      handle_updated_at: profile?.handle_updated_at || null,
      canChangeName,
      can_change_name: canChangeName,
      nameDaysRemaining,
      name_days_remaining: nameDaysRemaining,
      nextNameChangeAt,
      next_name_change_at: nextNameChangeAt,
      canChangeHandle,
      can_change_handle: canChangeHandle,
      handleDaysRemaining,
      handle_days_remaining: handleDaysRemaining,
      nextHandleChangeAt,
      next_handle_change_at: nextHandleChangeAt,
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

  const u = (await db.prepare('SELECT id, handle, phone, is_verified FROM users WHERE handle = ? OR handle = ? LIMIT 1')
    .bind(handle, `@${handle}`)
    .first()) as any;

  if (!profile && !u) {
    return c.json({
      success: true,
      user: {
        handle: handle,
        name: handle,
        displayName: handle,
        display_name: handle,
        avatarUrl: '',
        bio: '',
        isVerified: false,
        is_verified: 0,
        friendCount: 0,
      }
    });
  }

  const isVerified = (profile?.is_verified === 1) || (u?.is_verified === 1) || (profile?.bio && profile.bio.includes('[Verified]')) ? 1 : 0;

  return c.json({
    success: true,
    user: {
      userId: u?.id || '',
      handle: handle,
      name: profile?.display_name || handle,
      displayName: profile?.display_name || handle,
      avatarUrl: profile?.avatar_r2_path || '',
      photoUrl: profile?.avatar_r2_path || '',
      bio: profile?.bio || '',
      isVerified: isVerified === 1,
      is_verified: isVerified,
      friendCount: profile?.friend_count || 0,
    },
    profile: profile ? {
      // Explicit allowlist — spreading the raw row leaked private columns
      // (notably fcm_token) from this unauthenticated endpoint.
      handle: handle,
      display_name: profile.display_name || handle,
      displayName: profile.display_name || handle,
      bio: profile.bio || '',
      avatar_r2_path: profile.avatar_r2_path || '',
      banner_r2_path: profile.banner_r2_path || '',
      friend_count: profile.friend_count || 0,
      created_at: profile.created_at,
      photoUrl: profile.avatar_r2_path || '',
      avatarUrl: profile.avatar_r2_path || '',
      isVerified: isVerified === 1,
      is_verified: isVerified,
    } : null,
  });
});

// 6. DELETE Account permanently
authApp.delete('/account', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = getDatabase(c);

  const result = await orchestrateAccountDeletion(
    db,
    user.userHandle,
    user.installationId
  );
  if (!result.success) {
    return c.json(result, 500);
  }

  return c.json(result, 200);
});

// Get Current Auth State (Me)
authApp.get('/me', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = getDatabase(c);
  const cleanHandle = user.userHandle.replace(/^@+/, '').trim();
  const profile = (await db.prepare('SELECT * FROM profiles WHERE handle = ? OR handle = ? LIMIT 1')
    .bind(cleanHandle, `@${cleanHandle}`)
    .first()) as any;

  let safeProfile: any = null;
  if (profile) {
    const { fcm_token, ...rest } = profile;
    safeProfile = rest;
  }

  return c.json({
    success: true,
    user: {
      handle: cleanHandle,
      installationId: user.installationId,
      profile: safeProfile,
    },
  });
});

export { authApp };
