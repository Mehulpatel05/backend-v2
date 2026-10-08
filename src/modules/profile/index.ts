import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';

const profileApp = new Hono<{ Bindings: Env; Variables: Variables }>();

const NAME_COOLDOWN_DAYS = 14;
const NAME_COOLDOWN_MS = NAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
const HANDLE_COOLDOWN_DAYS = 30;
const HANDLE_COOLDOWN_MS = HANDLE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

function calculateCooldown(updatedAt: string | null | undefined, cooldownMs: number) {
  if (!updatedAt) {
    return { canChange: true, daysRemaining: 0, nextAvailableAt: null };
  }
  const updatedTime = new Date(updatedAt).getTime();
  if (isNaN(updatedTime)) {
    return { canChange: true, daysRemaining: 0, nextAvailableAt: null };
  }
  const elapsed = Date.now() - updatedTime;
  if (elapsed >= cooldownMs) {
    return { canChange: true, daysRemaining: 0, nextAvailableAt: null };
  }
  const remainingMs = cooldownMs - elapsed;
  const daysRemaining = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
  const nextAvailableAt = new Date(updatedTime + cooldownMs).toISOString();
  return { canChange: false, daysRemaining, nextAvailableAt };
}

// 1. Get Profile by Handle
profileApp.get('/:handle', async (c) => {
  const raw = c.req.param('handle');
  const cleanHandle = raw.replace(/^@+/, '').trim();

  const db = getDatabase(c);
  const profile = (await db.prepare(
    `SELECT p.*, af.seq AS founder_seq, af.area_id AS founder_area_id
     FROM profiles p
     LEFT JOIN area_founders af ON (LOWER(af.user_id) = LOWER(p.handle) OR LOWER(af.user_id) = LOWER(REPLACE(p.handle, '@', '')))
     WHERE p.handle = ? OR p.handle = ? LIMIT 1`
  )
    .bind(cleanHandle, `@${cleanHandle}`)
    .first()) as any;

  if (!profile) {
    return c.json({ success: false, error: 'Profile not found' }, 404);
  }

  const isFounder = profile.founder_seq != null && profile.founder_seq > 0;
  const isVerifiedCitizen = (profile.is_verified === 1) || (profile.bio && profile.bio.includes('[Verified]'));
  const isVerified = isFounder || isVerifiedCitizen;
  const authorBadge = isFounder ? `FOUNDING #${profile.founder_seq}` : (isVerifiedCitizen ? 'VERIFIED' : null);

  const nameCooldown = calculateCooldown(profile.name_updated_at, NAME_COOLDOWN_MS);
  const handleCooldown = calculateCooldown(profile.handle_updated_at, HANDLE_COOLDOWN_MS);

  return c.json({
    success: true,
    profile: {
      handle: profile.handle.replace(/^@+/, '').trim(),
      displayName: profile.display_name || profile.handle.replace(/^@+/, '').trim(),
      display_name: profile.display_name || profile.handle.replace(/^@+/, '').trim(),
      bio: profile.bio || '',
      avatar_r2_path: profile.avatar_r2_path || '',
      banner_r2_path: profile.banner_r2_path || '',
      friend_count: profile.friend_count || 0,
      friendCount: profile.friend_count || 0,
      photoUrl: profile.avatar_r2_path || null,
      avatarUrl: profile.avatar_r2_path || null,
      isVerified,
      is_verified: isVerified ? 1 : 0,
      authorBadge,
      author_badge: authorBadge,
      badge: authorBadge,
      founderSeq: profile.founder_seq ?? null,
      founderAreaId: profile.founder_area_id ?? null,
      nameUpdatedAt: profile.name_updated_at ?? null,
      name_updated_at: profile.name_updated_at ?? null,
      handleUpdatedAt: profile.handle_updated_at ?? null,
      handle_updated_at: profile.handle_updated_at ?? null,
      canChangeName: nameCooldown.canChange,
      can_change_name: nameCooldown.canChange,
      nameDaysRemaining: nameCooldown.daysRemaining,
      name_days_remaining: nameCooldown.daysRemaining,
      nextNameChangeAt: nameCooldown.nextAvailableAt,
      next_name_change_at: nameCooldown.nextAvailableAt,
      canChangeHandle: handleCooldown.canChange,
      can_change_handle: handleCooldown.canChange,
      handleDaysRemaining: handleCooldown.daysRemaining,
      handle_days_remaining: handleCooldown.daysRemaining,
      nextHandleChangeAt: handleCooldown.nextAvailableAt,
      next_handle_change_at: handleCooldown.nextAvailableAt,
    },
  });
});

// 2. Update Own Profile
profileApp.put('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const cleanUserHandle = (user.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const body = await c.req.json().catch(() => ({}));

  const rawNewHandle = body.handle ?? body.username ?? body.userHandle;
  const displayName = body.displayName ?? body.display_name ?? body.name ?? body.fullName;
  const bio = body.bio;
  const avatarR2Path = body.avatarR2Path ?? body.avatar_r2_path;
  const bannerR2Path = body.bannerR2Path ?? body.banner_r2_path;
  const fcmToken = body.fcmToken ?? body.fcm_token;

  let targetHandle = cleanUserHandle;
  const db = getDatabase(c);

  // Fetch current profile to verify cooldowns and current values
  const currentProfile = (await db.prepare(
    'SELECT * FROM profiles WHERE LOWER(handle) = LOWER(?) OR LOWER(handle) = LOWER(?) LIMIT 1'
  )
    .bind(cleanUserHandle, `@${cleanUserHandle}`)
    .first()) as any;

  let handleChanged = false;
  let nameChanged = false;

  // 1. Handle Username / Handle Change
  if (rawNewHandle !== undefined) {
    const cleanNewHandle = String(rawNewHandle).replace(/^@+/, '').trim().toLowerCase();

    // Check format
    if (!/^[a-z0-9_]{3,30}$/.test(cleanNewHandle)) {
      return c.json({
        success: false,
        error: 'Username must be 3-30 characters long and contain only lowercase letters, numbers, and underscores (_).'
      }, 400);
    }

    if (cleanNewHandle !== cleanUserHandle) {
      const isInitialHandle = cleanUserHandle.startsWith('user_') || cleanUserHandle.startsWith('anon#');
      if (!isInitialHandle) {
        // 30 Days Cooldown Check for Username
        const handleCooldown = calculateCooldown(currentProfile?.handle_updated_at, HANDLE_COOLDOWN_MS);
        if (!handleCooldown.canChange) {
          const nextDateStr = new Date(handleCooldown.nextAvailableAt!).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
          });
          return c.json({
            success: false,
            code: 'HANDLE_COOLDOWN',
            daysRemaining: handleCooldown.daysRemaining,
            nextAvailableAt: handleCooldown.nextAvailableAt,
            error: `Username can only be changed once every 30 days. You can change it again in ${handleCooldown.daysRemaining} day(s) (${nextDateStr}).`
          }, 400);
        }
      }

      // Check uniqueness in users table
      const existing = (await db.prepare(
        'SELECT id, handle FROM users WHERE (LOWER(handle) = ? OR LOWER(handle) = ?) AND LOWER(handle) != ? LIMIT 1'
      )
        .bind(cleanNewHandle, `@${cleanNewHandle}`, cleanUserHandle)
        .first()) as { id: string; handle: string } | null;

      if (existing) {
        return c.json({
          success: false,
          error: `Username @${cleanNewHandle} is already taken. Please choose another.`
        }, 409);
      }

      // Perform cascading update across all relational tables
      const cascadeUpdates = [
        db.prepare('UPDATE users SET handle = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(handle) = ? OR LOWER(handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE profiles SET handle = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(handle) = ? OR LOWER(handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE devices SET user_handle = ? WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE feed_posts SET author_handle = ? WHERE LOWER(author_handle) = ? OR LOWER(author_handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE feed_likes SET user_handle = ? WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE feed_comments SET author_handle = ? WHERE LOWER(author_handle) = ? OR LOWER(author_handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE bazar_shops SET owner_handle = ? WHERE LOWER(owner_handle) = ? OR LOWER(owner_handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE bazar_listings SET seller_handle = ? WHERE LOWER(seller_handle) = ? OR LOWER(seller_handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE bazar_saved SET user_handle = ? WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE chats SET user1_handle = ? WHERE LOWER(user1_handle) = ? OR LOWER(user1_handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE chats SET user2_handle = ? WHERE LOWER(user2_handle) = ? OR LOWER(user2_handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE chat_messages SET sender_handle = ? WHERE LOWER(sender_handle) = ? OR LOWER(sender_handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE chat_messages SET receiver_handle = ? WHERE LOWER(receiver_handle) = ? OR LOWER(receiver_handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE friendships SET user1_handle = ? WHERE LOWER(user1_handle) = ? OR LOWER(user1_handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE friendships SET user2_handle = ? WHERE LOWER(user2_handle) = ? OR LOWER(user2_handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE friend_requests SET sender_handle = ? WHERE LOWER(sender_handle) = ? OR LOWER(sender_handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE friend_requests SET receiver_handle = ? WHERE LOWER(receiver_handle) = ? OR LOWER(receiver_handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE notifications SET target_handle = ? WHERE LOWER(target_handle) = ? OR LOWER(target_handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE notifications SET sender_handle = ? WHERE LOWER(sender_handle) = ? OR LOWER(sender_handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE user_blocks SET blocker_handle = ? WHERE LOWER(blocker_handle) = ? OR LOWER(blocker_handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
        db.prepare('UPDATE user_blocks SET blocked_handle = ? WHERE LOWER(blocked_handle) = ? OR LOWER(blocked_handle) = ?').bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`),
      ];

      // Perform fast concurrent cascading updates across all relational tables
      await Promise.allSettled(cascadeUpdates.map((stmt) => stmt.run()));

      // Safe parallel update for optional tables
      const optionalTables: Array<{ table: string; col: string }> = [
        { table: 'area_founders', col: 'user_id' },
        { table: 'founding_requests', col: 'user_id' },
        { table: 'points_ledger', col: 'user_handle' },
        { table: 'user_rewards', col: 'user_handle' },
        { table: 'user_badges', col: 'user_handle' },
        { table: 'helpful_votes', col: 'voter_handle' },
        { table: 'helpful_votes', col: 'author_handle' },
        { table: 'referrals', col: 'inviter_handle' },
        { table: 'referrals', col: 'invitee_handle' },
        { table: 'listing_boosts', col: 'user_handle' },
        { table: 'shop_coupons', col: 'owner_handle' },
        { table: 'user_coupons', col: 'user_handle' },
      ];

      const optionalUpdates = optionalTables.map((opt) =>
        db.prepare(`UPDATE ${opt.table} SET ${opt.col} = ? WHERE LOWER(${opt.col}) = ? OR LOWER(${opt.col}) = ?`)
          .bind(cleanNewHandle, cleanUserHandle, `@${cleanUserHandle}`)
          .run()
      );
      await Promise.allSettled(optionalUpdates);

      handleChanged = true;
      targetHandle = cleanNewHandle;
    }
  }

  // 2. Handle Full Name Change with 14 Days Cooldown Check
  if (displayName !== undefined) {
    const cleanNewName = String(displayName).trim();
    if (cleanNewName.length === 0) {
      return c.json({
        success: false,
        error: 'Full name cannot be empty.'
      }, 400);
    }
    const currentName = (currentProfile?.display_name || '').trim();

    if (cleanNewName.toLowerCase() !== currentName.toLowerCase()) {
      const isInitialName = currentName.startsWith('User ') || currentName.length === 0;
      if (!isInitialName) {
        const nameCooldown = calculateCooldown(currentProfile?.name_updated_at, NAME_COOLDOWN_MS);
        if (!nameCooldown.canChange) {
          const nextDateStr = new Date(nameCooldown.nextAvailableAt!).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
          });
          return c.json({
            success: false,
            code: 'NAME_COOLDOWN',
            daysRemaining: nameCooldown.daysRemaining,
            nextAvailableAt: nameCooldown.nextAvailableAt,
            error: `Full name can only be changed once every 14 days. You can change it again in ${nameCooldown.daysRemaining} day(s) (${nextDateStr}).`
          }, 400);
        }
      }
      nameChanged = true;
    }
  }

  // 3. Update Profile Fields (displayName, bio, avatar, banner, fcm, cooldowns)
  const updates: string[] = [];
  const params: any[] = [];

  if (displayName !== undefined) {
    updates.push('display_name = ?');
    params.push(String(displayName).trim());
  }
  if (bio !== undefined) {
    updates.push('bio = ?');
    params.push(String(bio).trim());
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
  if (nameChanged) {
    updates.push('name_updated_at = CURRENT_TIMESTAMP');
  }
  if (handleChanged) {
    updates.push('handle_updated_at = CURRENT_TIMESTAMP');
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(targetHandle, `@${targetHandle}`);

    const query = `UPDATE profiles SET ${updates.join(', ')} WHERE LOWER(handle) = LOWER(?) OR LOWER(handle) = LOWER(?)`;
    try {
      await db.prepare(query).bind(...params).run();
    } catch (e: any) {
      // Column fallback if migration not yet applied
      console.warn('[ProfileUpdate] Column migration fallback:', e);
      try {
        await db.prepare('ALTER TABLE profiles ADD COLUMN name_updated_at TIMESTAMP NULL').run();
      } catch (_) {}
      try {
        await db.prepare('ALTER TABLE profiles ADD COLUMN handle_updated_at TIMESTAMP NULL').run();
      } catch (_) {}
      await db.prepare(query).bind(...params).run();
    }
  }

  const updated = (await db.prepare(
    `SELECT p.*, af.seq AS founder_seq, af.area_id AS founder_area_id
     FROM profiles p
     LEFT JOIN area_founders af ON (LOWER(af.user_id) = LOWER(p.handle) OR LOWER(af.user_id) = LOWER(REPLACE(p.handle, '@', '')))
     WHERE LOWER(p.handle) = LOWER(?) OR LOWER(p.handle) = LOWER(?) LIMIT 1`
  )
    .bind(targetHandle, `@${targetHandle}`)
    .first()) as any;

  const isFounder = updated?.founder_seq != null && updated.founder_seq > 0;
  const isVerifiedCitizen = (updated?.is_verified === 1) || (updated?.bio && updated.bio.includes('[Verified]'));
  const isVerified = isFounder || isVerifiedCitizen;
  const authorBadge = isFounder ? `FOUNDING #${updated.founder_seq}` : (isVerifiedCitizen ? 'VERIFIED' : null);

  const nameCooldown = calculateCooldown(updated?.name_updated_at, NAME_COOLDOWN_MS);
  const handleCooldown = calculateCooldown(updated?.handle_updated_at, HANDLE_COOLDOWN_MS);

  return c.json({
    success: true,
    profile: updated ? {
      ...updated,
      handle: updated.handle.replace(/^@+/, '').trim(),
      displayName: updated.display_name,
      display_name: updated.display_name,
      name: updated.display_name,
      fullName: updated.display_name,
      photoUrl: updated.avatar_r2_path || null,
      avatarUrl: updated.avatar_r2_path || null,
      isVerified,
      is_verified: isVerified ? 1 : 0,
      authorBadge,
      author_badge: authorBadge,
      badge: authorBadge,
      founderSeq: updated.founder_seq ?? null,
      founderAreaId: updated.founder_area_id ?? null,
      nameUpdatedAt: updated.name_updated_at ?? null,
      name_updated_at: updated.name_updated_at ?? null,
      handleUpdatedAt: updated.handle_updated_at ?? null,
      handle_updated_at: updated.handle_updated_at ?? null,
      canChangeName: nameCooldown.canChange,
      can_change_name: nameCooldown.canChange,
      nameDaysRemaining: nameCooldown.daysRemaining,
      name_days_remaining: nameCooldown.daysRemaining,
      nextNameChangeAt: nameCooldown.nextAvailableAt,
      next_name_change_at: nameCooldown.nextAvailableAt,
      canChangeHandle: handleCooldown.canChange,
      can_change_handle: handleCooldown.canChange,
      handleDaysRemaining: handleCooldown.daysRemaining,
      handle_days_remaining: handleCooldown.daysRemaining,
      nextHandleChangeAt: handleCooldown.nextAvailableAt,
      next_handle_change_at: handleCooldown.nextAvailableAt,
    } : null,
    message: 'Profile updated successfully',
  });
});

export { profileApp };
