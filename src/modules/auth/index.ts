import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware, hashToken } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';

const authApp = new Hono<{ Bindings: Env; Variables: Variables }>();

function generateSecureToken(): string {
  const buffer = new Uint8Array(32);
  crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// 1. Send OTP
authApp.post('/send-otp', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const phone = (body.phone || '').trim();

  if (!phone || phone.length < 10) {
    return c.json({ success: false, error: 'Valid phone number is required' }, 400);
  }

  return c.json({
    success: true,
    message: 'OTP sent successfully to ' + phone,
    phone,
  });
});

// 2. Verify OTP & Register Device Session
authApp.post('/verify-otp', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const phone = (body.phone || '').trim();
  const otp = (body.otp || '').trim();
  const installationId = (body.installationId || '').trim();

  if (!phone || !otp || !installationId) {
    return c.json({ success: false, error: 'Phone, OTP, and installationId are required' }, 400);
  }

  const db = getDatabase(c);

  // Check if user already exists
  let user = await db.prepare('SELECT id, phone, handle FROM users WHERE phone = ? LIMIT 1')
    .bind(phone)
    .first<{ id: string; phone: string; handle: string }>();

  let handle = user?.handle || '';
  const isNewUser = !user;

  if (isNewUser) {
    const tempId = `u_${Date.now()}`;
    const tempHandle = `@user_${phone.slice(-4)}_${Math.floor(1000 + Math.random() * 9000)}`;
    await db.prepare(
      'INSERT INTO users (id, phone, handle) VALUES (?, ?, ?)'
    )
      .bind(tempId, phone, tempHandle)
      .run();

    await db.prepare(
      'INSERT INTO profiles (handle, user_id, display_name) VALUES (?, ?, ?)'
    )
      .bind(tempHandle, tempId, `User ${phone.slice(-4)}`)
      .run();

    handle = tempHandle;
  }

  // Generate Session Token
  const sessionToken = generateSecureToken();
  const tokenHash = await hashToken(sessionToken);

  // Store Device Session
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

  return c.json({
    success: true,
    isNewUser,
    handle,
    sessionToken,
    message: 'Authenticated successfully',
  });
});

// 3. Claim Handle
authApp.post('/claim-handle', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  let newHandle = (body.handle || '').trim();

  if (!newHandle) {
    return c.json({ success: false, error: 'Handle cannot be empty' }, 400);
  }

  if (!newHandle.startsWith('@')) {
    newHandle = `@${newHandle}`;
  }

  const db = getDatabase(c);

  const existing = await db.prepare('SELECT handle FROM users WHERE handle = ? LIMIT 1')
    .bind(newHandle)
    .first();

  if (existing && (existing as any).handle !== user.userHandle) {
    return c.json({ success: false, error: 'Handle is already taken' }, 409);
  }

  await db.batch([
    db.prepare('UPDATE users SET handle = ? WHERE handle = ?').bind(newHandle, user.userHandle),
    db.prepare('UPDATE profiles SET handle = ? WHERE handle = ?').bind(newHandle, user.userHandle),
    db.prepare('UPDATE devices SET user_handle = ? WHERE installation_id = ?').bind(newHandle, user.installationId),
  ]);

  return c.json({
    success: true,
    handle: newHandle,
    message: 'Handle claimed successfully',
  });
});

// 4. Get Current Auth State
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
