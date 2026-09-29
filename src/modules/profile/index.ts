import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';

const profileApp = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. Get Profile by Handle
profileApp.get('/:handle', async (c) => {
  let handle = c.req.param('handle');
  if (!handle.startsWith('@')) handle = `@${handle}`;

  const db = getDatabase(c);
  const profile = await db.prepare('SELECT * FROM profiles WHERE handle = ? LIMIT 1')
    .bind(handle)
    .first();

  if (!profile) {
    return c.json({ success: false, error: 'Profile not found' }, 404);
  }

  return c.json({
    success: true,
    profile,
  });
});

// 2. Update Own Profile
profileApp.put('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));

  const displayName = body.displayName ?? body.display_name;
  const bio = body.bio;
  const avatarR2Path = body.avatarR2Path ?? body.avatar_r2_path;
  const bannerR2Path = body.bannerR2Path ?? body.banner_r2_path;
  const fcmToken = body.fcmToken ?? body.fcm_token;

  const updates: string[] = [];
  const params: any[] = [];

  if (displayName !== undefined) {
    updates.push('display_name = ?');
    params.push(displayName);
  }
  if (bio !== undefined) {
    updates.push('bio = ?');
    params.push(bio);
  }
  if (avatarR2Path !== undefined) {
    updates.push('avatar_r2_path = ?');
    params.push(avatarR2Path);
  }
  if (bannerR2Path !== undefined) {
    updates.push('banner_r2_path = ?');
    params.push(bannerR2Path);
  }
  if (fcmToken !== undefined) {
    updates.push('fcm_token = ?');
    params.push(fcmToken);
  }

  if (updates.length === 0) {
    return c.json({ success: false, error: 'No fields provided for update' }, 400);
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(user.userHandle);

  const db = getDatabase(c);
  const query = `UPDATE profiles SET ${updates.join(', ')} WHERE handle = ?`;
  await db.prepare(query).bind(...params).run();

  const updated = await db.prepare('SELECT * FROM profiles WHERE handle = ? LIMIT 1')
    .bind(user.userHandle)
    .first();

  return c.json({
    success: true,
    profile: updated,
    message: 'Profile updated successfully',
  });
});

export { profileApp };
