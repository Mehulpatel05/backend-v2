import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';

const profileApp = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. Get Profile by Handle
profileApp.get('/:handle', async (c) => {
  const raw = c.req.param('handle');
  const cleanHandle = raw.replace(/^@+/, '').trim();

  const db = getDatabase(c);
  const profile = (await db.prepare('SELECT * FROM profiles WHERE handle = ? OR handle = ? LIMIT 1')
    .bind(cleanHandle, `@${cleanHandle}`)
    .first()) as any;

  if (!profile) {
    return c.json({ success: false, error: 'Profile not found' }, 404);
  }

  const isVerified = (profile.is_verified === 1) || (profile.bio && profile.bio.includes('[Verified]')) ? 1 : 0;

  return c.json({
    success: true,
    profile: {
      ...profile,
      handle: profile.handle.replace(/^@+/, '').trim(),
      photoUrl: profile.avatar_r2_path || null,
      avatarUrl: profile.avatar_r2_path || null,
      isVerified: isVerified === 1,
      is_verified: isVerified,
    },
  });
});

// 2. Update Own Profile
profileApp.put('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const cleanUserHandle = (user.userHandle || '').replace(/^@+/, '').trim();
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
  params.push(cleanUserHandle, `@${cleanUserHandle}`);

  const db = getDatabase(c);
  const query = `UPDATE profiles SET ${updates.join(', ')} WHERE handle = ? OR handle = ?`;
  await db.prepare(query).bind(...params).run();

  const updated = (await db.prepare('SELECT * FROM profiles WHERE handle = ? OR handle = ? LIMIT 1')
    .bind(cleanUserHandle, `@${cleanUserHandle}`)
    .first()) as any;

  return c.json({
    success: true,
    profile: updated ? {
      ...updated,
      handle: updated.handle.replace(/^@+/, '').trim(),
    } : null,
    message: 'Profile updated successfully',
  });
});

export { profileApp };
