import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';

export const rewardsApp = new Hono<{ Bindings: Env; Variables: Variables }>();

const DAILY_POINTS_CAP = 50;
const BOOST_COST = 300;

function getTodayString(): string {
  const d = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(d.getTime() + istOffset);
  return istDate.toISOString().split('T')[0];
}

function getYesterdayString(): string {
  const d = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istYesterday = new Date(d.getTime() + istOffset - 24 * 60 * 60 * 1000);
  return istYesterday.toISOString().split('T')[0];
}

export async function getOrCreateUserRewards(db: any, userHandle: string): Promise<any> {
  const clean = userHandle.replace(/^@+/, '').trim();
  let row = await db.prepare('SELECT * FROM user_rewards WHERE user_handle = ?').bind(clean).first();
  const today = getTodayString();

  if (!row) {
    const randomCode = `NEAR-${clean.substring(0, 4).toUpperCase()}${Math.floor(100 + Math.random() * 900)}`;
    await db.prepare(`
      INSERT INTO user_rewards (user_handle, balance, lifetime_points, weekly_points, streak_count, last_streak_date, daily_points_today, daily_date, referral_code)
      VALUES (?, 0, 0, 0, 0, '', 0, ?, ?)
    `).bind(clean, today, randomCode).run();

    row = await db.prepare('SELECT * FROM user_rewards WHERE user_handle = ?').bind(clean).first();
  } else if (row.daily_date !== today) {
    await db.prepare('UPDATE user_rewards SET daily_points_today = 0, daily_date = ? WHERE user_handle = ?')
      .bind(today, clean).run();
    row.daily_points_today = 0;
    row.daily_date = today;
  }

  return row;
}

export async function awardPoints(db: any, params: {
  userHandle: string;
  delta: number;
  reason: string;
  refType: string;
  refId?: string;
  isAction?: boolean;
}): Promise<{ success: boolean; awardedDelta: number; newBalance: number; capReached?: boolean }> {
  const clean = params.userHandle.replace(/^@+/, '').trim();
  const refId = params.refId || '';
  const isAction = params.isAction ?? true;

  if (refId && params.delta > 0) {
    const existing = await db.prepare('SELECT id FROM points_ledger WHERE user_handle = ? AND ref_type = ? AND ref_id = ?')
      .bind(clean, params.refType, refId).first();
    if (existing) {
      const userRewards = await getOrCreateUserRewards(db, clean);
      return { success: true, awardedDelta: 0, newBalance: userRewards.balance };
    }
  }

  const rewards = await getOrCreateUserRewards(db, clean);
  let effectiveDelta = params.delta;
  let capReached = false;

  if (isAction && params.delta > 0) {
    const remainingCap = Math.max(0, DAILY_POINTS_CAP - rewards.daily_points_today);
    if (remainingCap <= 0) {
      return { success: false, awardedDelta: 0, newBalance: rewards.balance, capReached: true };
    }
    if (effectiveDelta > remainingCap) {
      effectiveDelta = remainingCap;
      capReached = true;
    }
  }

  const newBalance = Math.max(0, (rewards.balance || 0) + effectiveDelta);
  const newLifetime = (rewards.lifetime_points || 0) + Math.max(0, effectiveDelta);
  const newWeekly = (rewards.weekly_points || 0) + Math.max(0, effectiveDelta);
  const newDaily = (rewards.daily_points_today || 0) + (isAction ? Math.max(0, effectiveDelta) : 0);

  const ledgerId = `led_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  await db.prepare(`
    INSERT INTO points_ledger (id, user_handle, delta, reason, ref_type, ref_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(ledgerId, clean, effectiveDelta, params.reason, params.refType, refId).run();

  await db.prepare(`
    UPDATE user_rewards
    SET balance = ?, lifetime_points = ?, weekly_points = ?, daily_points_today = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_handle = ?
  `).bind(newBalance, newLifetime, newWeekly, newDaily, clean).run();

  await checkAndAwardBadges(db, clean);

  return { success: true, awardedDelta: effectiveDelta, newBalance, capReached };
}

export async function checkAndAwardBadges(db: any, userHandle: string): Promise<void> {
  const clean = userHandle.replace(/^@+/, '').trim();

  const helpfulCountRow = await db.prepare('SELECT COUNT(*) as count FROM helpful_votes WHERE author_handle = ?')
    .bind(clean).first() as any;
  const helpfulCount = helpfulCountRow?.count ?? 0;

  if (helpfulCount >= 10) {
    await awardBadgeIfNew(db, clean, 'helper');
  }
  if (helpfulCount >= 50) {
    await awardBadgeIfNew(db, clean, 'local_hero');
  }

  const soldCountRow = await db.prepare("SELECT COUNT(*) as count FROM bazar_listings WHERE (seller_handle = ? OR seller_handle = ?) AND is_active = 0")
    .bind(clean, `@${clean}`).first() as any;
  const soldCount = soldCountRow?.count ?? 0;
  if (soldCount >= 5) {
    await awardBadgeIfNew(db, clean, 'top_seller');
  }

  const isFounder = await db.prepare("SELECT 1 FROM area_founders WHERE LOWER(user_id) = LOWER(?) OR LOWER(user_id) = LOWER(?)")
    .bind(clean, `@${clean}`).first() as any;
  if (isFounder) {
    await awardBadgeIfNew(db, clean, 'founding_neighbour');
  }
}

async function awardBadgeIfNew(db: any, userHandle: string, badgeKey: string): Promise<void> {
  const badgeId = `bdg_${badgeKey}_${userHandle}`;
  try {
    await db.prepare(`
      INSERT OR IGNORE INTO user_badges (id, user_handle, badge_key, earned_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(badgeId, userHandle, badgeKey).run();
  } catch (_) {}
}

rewardsApp.get('/me', authMiddleware, async (c) => {
  const user = c.get('user');
  const clean = (user.userHandle || '').replace(/^@+/, '').trim();
  const db = getDatabase(c);

  const rewards = await getOrCreateUserRewards(db, clean);

  const today = getTodayString();
  const yesterday = getYesterdayString();
  let streakCount = rewards.streak_count || 0;
  let streakAwarded = false;

  if (rewards.last_streak_date !== today) {
    if (rewards.last_streak_date === yesterday) {
      if ((rewards.streak_count || 0) >= 7) {
        streakCount = 1;
      } else {
        streakCount = (rewards.streak_count || 0) + 1;
      }
    } else {
      streakCount = 1;
    }

    let extraPoints = 0;
    if (streakCount === 7) {
      extraPoints = 30;
      streakAwarded = true;
    }

    await db.prepare('UPDATE user_rewards SET streak_count = ?, last_streak_date = ? WHERE user_handle = ?')
      .bind(streakCount, today, clean).run();

    if (extraPoints > 0) {
      await awardPoints(db, {
        userHandle: clean,
        delta: extraPoints,
        reason: '7-day streak bonus',
        refType: 'streak',
        refId: `streak_${today}`,
        isAction: false,
      });
      rewards.balance = (rewards.balance || 0) + extraPoints;
      rewards.lifetime_points = (rewards.lifetime_points || 0) + extraPoints;
    }
  }

  const badges = await db.prepare('SELECT badge_key, earned_at FROM user_badges WHERE user_handle = ? ORDER BY earned_at DESC')
    .bind(clean).all() as any;

  const helpfulCountRow = await db.prepare('SELECT COUNT(*) as count FROM helpful_votes WHERE author_handle = ?')
    .bind(clean).first() as any;
  const helpfulVotes = helpfulCountRow?.count ?? 0;

  const soldCountRow = await db.prepare("SELECT COUNT(*) as count FROM bazar_listings WHERE (seller_handle = ? OR seller_handle = ?) AND is_active = 0")
    .bind(clean, `@${clean}`).first() as any;
  const soldCount = soldCountRow?.count ?? 0;

  let highestHelpfulBadge: string | null = null;
  const badgeKeys = (badges.results || []).map((b: any) => b.badge_key);
  if (badgeKeys.includes('local_hero')) {
    highestHelpfulBadge = 'Local Hero';
  } else if (badgeKeys.includes('helper')) {
    highestHelpfulBadge = 'Helper';
  }

  const nextGoalPoints = 300;
  const pointsToNextGoal = Math.max(0, nextGoalPoints - rewards.balance);

  const weeklySumRow = await db.prepare(`
    SELECT COALESCE(SUM(delta), 0) as weekly_sum
    FROM points_ledger
    WHERE user_handle = ? AND delta > 0 AND created_at >= datetime('now', '-7 days')
  `).bind(clean).first() as any;
  const weeklyPoints = weeklySumRow?.weekly_sum ?? rewards.weekly_points ?? 0;

  return c.json({
    success: true,
    data: {
      balance: rewards.balance,
      lifetimePoints: rewards.lifetime_points,
      weeklyPoints,
      streakCount: streakCount,
      streakAwarded,
      dailyPointsToday: rewards.daily_points_today,
      dailyCap: DAILY_POINTS_CAP,
      referralCode: rewards.referral_code,
      highestHelpfulBadge,
      badges: badges.results || [],
      progress: {
        helpfulVotes,
        soldCount,
        nextGoalPoints,
        pointsToNextGoal,
      },
    },
  });
});

rewardsApp.get('/history', authMiddleware, async (c) => {
  const user = c.get('user');
  const clean = (user.userHandle || '').replace(/^@+/, '').trim();
  const filter = c.req.query('filter') || 'all';
  const db = getDatabase(c);

  let query = 'SELECT * FROM points_ledger WHERE user_handle = ?';
  if (filter === 'earned') {
    query += ' AND delta > 0';
  } else if (filter === 'spent') {
    query += ' AND delta < 0';
  }
  query += ' ORDER BY created_at DESC LIMIT 100';

  const rows = await db.prepare(query).bind(clean).all() as any;

  return c.json({
    success: true,
    history: rows.results || [],
  });
});

rewardsApp.get('/badges', authMiddleware, async (c) => {
  const user = c.get('user');
  const clean = (user.userHandle || '').replace(/^@+/, '').trim();
  const db = getDatabase(c);

  const earnedRows = await db.prepare('SELECT badge_key, earned_at FROM user_badges WHERE user_handle = ?')
    .bind(clean).all() as any;
  const earnedMap = new Map();
  for (const b of earnedRows.results || []) {
    earnedMap.set(b.badge_key, b.earned_at);
  }

  const helpfulCountRow = await db.prepare('SELECT COUNT(*) as count FROM helpful_votes WHERE author_handle = ?')
    .bind(clean).first() as any;
  const helpfulVotes = helpfulCountRow?.count ?? 0;

  const soldCountRow = await db.prepare("SELECT COUNT(*) as count FROM bazar_listings WHERE (seller_handle = ? OR seller_handle = ?) AND is_active = 0")
    .bind(clean, `@${clean}`).first() as any;
  const soldCount = soldCountRow?.count ?? 0;

  const allBadges = [
    {
      key: 'helper',
      name: 'Helper',
      description: 'Receive 10 helpful votes on your comments and replies.',
      required: 10,
      current: helpfulVotes,
      earned: earnedMap.has('helper'),
      earnedAt: earnedMap.get('helper') || null,
    },
    {
      key: 'local_hero',
      name: 'Local Hero',
      description: 'Receive 50 helpful votes on your comments and replies.',
      required: 50,
      current: helpfulVotes,
      earned: earnedMap.has('local_hero'),
      earnedAt: earnedMap.get('local_hero') || null,
    },
    {
      key: 'top_seller',
      name: 'Top Seller',
      description: 'Successfully sell 5 items in Nearhood Bazaar.',
      required: 5,
      current: soldCount,
      earned: earnedMap.has('top_seller'),
      earnedAt: earnedMap.get('top_seller') || null,
    },
    {
      key: 'founding_neighbour',
      name: 'Founding Neighbour',
      description: 'Be among the first 100 residents of your neighbourhood.',
      required: 1,
      current: earnedMap.has('founding_neighbour') ? 1 : 0,
      earned: earnedMap.has('founding_neighbour'),
      earnedAt: earnedMap.get('founding_neighbour') || null,
    },
  ];

  return c.json({
    success: true,
    badges: allBadges,
  });
});

rewardsApp.get('/leaderboard', authMiddleware, async (c) => {
  const user = c.get('user');
  const clean = (user.userHandle || '').replace(/^@+/, '').trim();
  const db = getDatabase(c);

  const topUsers = await db.prepare(`
    SELECT r.user_handle,
      COALESCE((
        SELECT SUM(pl.delta)
        FROM points_ledger pl
        WHERE pl.user_handle = r.user_handle
          AND pl.delta > 0
          AND pl.created_at >= datetime('now', '-7 days')
      ), 0) AS calculated_weekly_points,
      r.lifetime_points,
      p.display_name, p.avatar_r2_path,
      (SELECT badge_key FROM user_badges ub WHERE ub.user_handle = r.user_handle ORDER BY CASE ub.badge_key WHEN 'local_hero' THEN 1 WHEN 'helper' THEN 2 ELSE 3 END LIMIT 1) as top_badge
    FROM user_rewards r
    LEFT JOIN profiles p ON r.user_handle = p.handle OR '@' || r.user_handle = p.handle
    ORDER BY calculated_weekly_points DESC, r.lifetime_points DESC
    LIMIT 10
  `).all() as any;

  let currentUserRank = -1;
  const results = (topUsers.results || []).map((item: any, idx: number) => {
    if (item.user_handle === clean) currentUserRank = idx + 1;
    return {
      rank: idx + 1,
      handle: item.user_handle,
      displayName: item.display_name || item.user_handle,
      avatarUrl: item.avatar_r2_path || '',
      points: item.calculated_weekly_points || 0,
      topBadge: item.top_badge || null,
    };
  });

  return c.json({
    success: true,
    leaderboard: results,
    currentUserRank,
  });
});

rewardsApp.get('/referrals/me', authMiddleware, async (c) => {
  const user = c.get('user');
  const clean = (user.userHandle || '').replace(/^@+/, '').trim();
  const db = getDatabase(c);

  const rewards = await getOrCreateUserRewards(db, clean);
  const list = await db.prepare('SELECT * FROM referrals WHERE inviter_handle = ? ORDER BY created_at DESC')
    .bind(clean).all() as any;

  return c.json({
    success: true,
    referralCode: rewards.referral_code,
    shareUrl: `https://nearhood.in/join?ref=${rewards.referral_code}`,
    invites: list.results || [],
  });
});

rewardsApp.post('/referrals/apply', authMiddleware, async (c) => {
  const user = c.get('user');
  const clean = (user.userHandle || '').replace(/^@+/, '').trim();
  const body = await c.req.json().catch(() => ({}));
  const code = (body.code || '').trim().toUpperCase();
  const db = getDatabase(c);

  if (!code) {
    return c.json({ success: false, error: 'Referral code is required' }, 400);
  }

  const inviterRewards = await db.prepare('SELECT user_handle FROM user_rewards WHERE referral_code = ?')
    .bind(code).first() as any;

  if (!inviterRewards) {
    return c.json({ success: false, error: 'Invalid referral code' }, 404);
  }

  const inviterHandle = inviterRewards.user_handle;
  if (inviterHandle === clean) {
    return c.json({ success: false, error: 'Cannot refer yourself' }, 400);
  }

  const referralId = `ref_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  try {
    await db.prepare(`
      INSERT INTO referrals (id, inviter_handle, invitee_handle, code, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
    `).bind(referralId, inviterHandle, clean, code).run();
  } catch (_) {
    return c.json({ success: false, error: 'Referral already applied' }, 400);
  }

  return c.json({ success: true, message: 'Referral applied! Post or list to earn +25 points.' });
});

rewardsApp.post('/boost', authMiddleware, async (c) => {
  const user = c.get('user');
  const clean = (user.userHandle || '').replace(/^@+/, '').trim();
  const body = await c.req.json().catch(() => ({}));
  const listingId = body.listingId || body.listing_id;
  const areaId = body.areaId || body.area_id || 'GJ-VAD';
  const db = getDatabase(c);

  if (!listingId) {
    return c.json({ success: false, error: 'Listing ID is required' }, 400);
  }

  const listing = await db.prepare('SELECT seller_handle FROM bazar_listings WHERE id = ?')
    .bind(listingId).first() as any;
  if (!listing) {
    return c.json({ success: false, error: 'Listing not found' }, 404);
  }
  const cleanSeller = (listing.seller_handle || '').replace(/^@+/, '').trim();
  if (cleanSeller !== clean) {
    return c.json({ success: false, error: 'You can only boost your own listings.' }, 403);
  }

  const activeBoost = await db.prepare('SELECT id FROM listing_boosts WHERE listing_id = ? AND ends_at > CURRENT_TIMESTAMP')
    .bind(listingId).first() as any;
  if (activeBoost) {
    return c.json({ success: false, error: 'This listing is already currently boosted.' }, 400);
  }

  const rewards = await getOrCreateUserRewards(db, clean);
  if ((rewards.balance || 0) < BOOST_COST) {
    return c.json({ success: false, error: `Insufficient points. You need ${BOOST_COST} points to boost.` }, 400);
  }

  const boostId = `boost_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await db.prepare(`
    INSERT INTO listing_boosts (id, listing_id, user_handle, area_id, starts_at, ends_at, cost_points)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
  `).bind(boostId, listingId, clean, areaId, endsAt, BOOST_COST).run();

  await awardPoints(db, {
    userHandle: clean,
    delta: -BOOST_COST,
    reason: 'Featured in your area 24h boost',
    refType: 'boost',
    refId: boostId,
    isAction: false,
  });

  return c.json({
    success: true,
    message: 'Listing featured for 24 hours!',
    endsAt,
  });
});

rewardsApp.get('/perks', authMiddleware, async (c) => {
  const db = getDatabase(c);
  const perks = await db.prepare(`
    SELECT sc.*, bs.shop_name, bs.category, bs.logo_r2_path, bs.address
    FROM shop_coupons sc
    JOIN bazar_shops bs ON sc.shop_id = bs.id
    WHERE sc.active = 1
    ORDER BY sc.created_at DESC
  `).all() as any;

  return c.json({
    success: true,
    perks: perks.results || [],
  });
});

rewardsApp.post('/coupons/unlock', authMiddleware, async (c) => {
  const user = c.get('user');
  const clean = (user.userHandle || '').replace(/^@+/, '').trim();
  const body = await c.req.json().catch(() => ({}));
  const couponId = body.couponId || body.coupon_id;
  const db = getDatabase(c);

  if (!couponId) {
    return c.json({ success: false, error: 'Coupon ID is required' }, 400);
  }

  const coupon = await db.prepare('SELECT * FROM shop_coupons WHERE id = ? AND active = 1')
    .bind(couponId).first() as any;
  if (!coupon) {
    return c.json({ success: false, error: 'Coupon not found or inactive' }, 404);
  }

  const cost = coupon.cost_points || 100;
  const rewards = await getOrCreateUserRewards(db, clean);
  if ((rewards.balance || 0) < cost) {
    return c.json({ success: false, error: `Need ${cost} points to unlock this coupon.` }, 400);
  }

  const userCouponId = `uc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const code = `NH-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await db.prepare(`
    INSERT INTO user_coupons (id, user_handle, coupon_id, code, expires_at, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)
  `).bind(userCouponId, clean, couponId, code, expiresAt).run();

  await awardPoints(db, {
    userHandle: clean,
    delta: -cost,
    reason: `Unlocked ${coupon.title} coupon`,
    refType: 'coupon',
    refId: userCouponId,
    isAction: false,
  });

  return c.json({
    success: true,
    coupon: {
      id: userCouponId,
      code,
      title: coupon.title,
      expiresAt,
    },
  });
});

rewardsApp.post('/replies/:id/helpful', authMiddleware, async (c) => {
  const user = c.get('user');
  const voterHandle = (user.userHandle || '').replace(/^@+/, '').trim();
  const replyId = c.req.param('id');
  const db = getDatabase(c);

  const comment = await db.prepare('SELECT author_handle FROM feed_comments WHERE id = ?')
    .bind(replyId).first() as any;

  if (!comment) {
    return c.json({ success: false, error: 'Reply not found' }, 404);
  }

  const authorHandle = (comment.author_handle || '').replace(/^@+/, '').trim();
  if (authorHandle === voterHandle) {
    return c.json({ success: false, error: 'Cannot vote on your own reply' }, 400);
  }

  const existingVote = await db.prepare('SELECT id FROM helpful_votes WHERE reply_id = ? AND voter_handle = ?')
    .bind(replyId, voterHandle).first();

  if (existingVote) {
    await db.prepare('DELETE FROM helpful_votes WHERE reply_id = ? AND voter_handle = ?')
      .bind(replyId, voterHandle).run();
    return c.json({ success: true, action: 'unvoted', message: 'Helpful vote removed' });
  }

  const voteId = `vote_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  await db.prepare(`
    INSERT INTO helpful_votes (id, reply_id, voter_handle, author_handle, created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(voteId, replyId, voterHandle, authorHandle).run();

  const voteCountRow = await db.prepare('SELECT COUNT(*) as count FROM helpful_votes WHERE reply_id = ?')
    .bind(replyId).first() as any;
  const voteCount = voteCountRow?.count ?? 1;

  if (voteCount <= 3) {
    await awardPoints(db, {
      userHandle: authorHandle,
      delta: 5,
      reason: 'Reply marked helpful by a neighbour',
      refType: 'helpful',
      refId: `${replyId}_${voterHandle}`,
      isAction: true,
    });
  }

  return c.json({ success: true, action: 'voted', message: 'Marked as helpful · +5 pts awarded to author' });
});
