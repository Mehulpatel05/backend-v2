import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';
import {
  checkAndFlagDailyCapAbuse,
  validateHelpfulVote,
  validateReferralApplication,
  reversePoints,
} from './anti_abuse';

export const rewardsApp = new Hono<{ Bindings: Env; Variables: Variables }>();

export const DAILY_POINTS_CAP = 50;
export const DAILY_POSTS_LIMIT = 3;
export const DAILY_REPLIES_LIMIT = 5;
export const DAILY_VOTES_LIMIT = 5;
export const DAILY_LISTINGS_LIMIT = 3;
export const MONTHLY_INVITES_LIMIT = 5;
export const STREAK_BONUS_POINTS = 30;
export const DAILY_STREAK_REWARDS = [5, 10, 15, 10, 15, 20, 30];
export const BOOST_COST = 300;

const rewardsRateMap = new Map<string, { count: number; resetTime: number }>();

export function rateLimitRewards(maxRequests = 60, windowMs = 60_000) {
  return async (c: any, next: any) => {
    const user = c.get('user');
    const key = (user?.userHandle || c.req.header('x-forwarded-for') || 'anonymous')
      .replace(/^@+/, '')
      .trim()
      .toLowerCase();
    const now = Date.now();
    const current = rewardsRateMap.get(key);

    if (!current || now > current.resetTime) {
      rewardsRateMap.set(key, { count: 1, resetTime: now + windowMs });
    } else {
      current.count++;
      if (current.count > maxRequests) {
        return c.json({ success: false, error: 'Rate limit exceeded. Please wait a moment.' }, 429);
      }
    }
    await next();
  };
}

rewardsApp.use('/*', rateLimitRewards());

export function getTodayString(timezoneOffsetHours: number = 5.5): string {
  const d = new Date();
  const offset = timezoneOffsetHours * 60 * 60 * 1000;
  const istDate = new Date(d.getTime() + offset);
  return istDate.toISOString().split('T')[0];
}

export function getYesterdayString(timezoneOffsetHours: number = 5.5): string {
  const d = new Date();
  const offset = timezoneOffsetHours * 60 * 60 * 1000;
  const istYesterday = new Date(d.getTime() + offset - 24 * 60 * 60 * 1000);
  return istYesterday.toISOString().split('T')[0];
}

export async function getOrCreateDailyActivity(db: any, userHandle: string, date: string): Promise<any> {
  const clean = userHandle.replace(/^@+/, '').trim();
  let row = await db.prepare('SELECT * FROM user_daily_rewards WHERE user_handle = ? AND date = ?')
    .bind(clean, date).first();

  if (!row) {
    try {
      await db.prepare(`
        INSERT INTO user_daily_rewards (user_handle, date, posts_count, replies_count, votes_count, listings_count, daily_points)
        VALUES (?, ?, 0, 0, 0, 0, 0)
      `).bind(clean, date).run();
    } catch (_) {}
    row = await db.prepare('SELECT * FROM user_daily_rewards WHERE user_handle = ? AND date = ?')
      .bind(clean, date).first();
  }

  return row || {
    user_handle: clean,
    date,
    posts_count: 0,
    replies_count: 0,
    votes_count: 0,
    listings_count: 0,
    daily_points: 0,
  };
}

export async function getOrCreateUserRewards(db: any, userHandle: string): Promise<any> {
  const clean = userHandle.replace(/^@+/, '').trim();
  let row = await db.prepare('SELECT * FROM user_rewards WHERE user_handle = ?').bind(clean).first();
  const today = getTodayString(row?.timezone_offset || 5.5);

  if (!row) {
    let inserted = false;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const randomSuffix = Math.floor(1000 + Math.random() * 9000).toString();
      const randomCode = `NEAR-${clean.substring(0, 4).toUpperCase()}${randomSuffix}`;
      try {
        await db.prepare(`
          INSERT INTO user_rewards (user_handle, balance, lifetime_points, weekly_points, streak_count, last_streak_date, daily_points_today, daily_date, referral_code, timezone_offset)
          VALUES (?, 0, 0, 0, 0, '', 0, ?, ?, 5.5)
        `).bind(clean, today, randomCode).run();
        inserted = true;
      } catch (_) {}
    }
    row = await db.prepare('SELECT * FROM user_rewards WHERE user_handle = ?').bind(clean).first();
  } else if (row.daily_date !== today) {
    await db.prepare('UPDATE user_rewards SET daily_points_today = 0, daily_date = ? WHERE user_handle = ?')
      .bind(today, clean).run();
    row.daily_points_today = 0;
    row.daily_date = today;
  }

  await getOrCreateDailyActivity(db, clean, today);

  return row;
}

export async function awardPoints(db: any, params: {
  userHandle: string;
  delta: number;
  reason: string;
  action?: string;
  refType?: string;
  sourceId?: string;
  refId?: string;
  isAction?: boolean;
}): Promise<{
  success: boolean;
  awardedDelta: number;
  newBalance: number;
  capReached?: boolean;
  limitReached?: boolean;
  isDuplicate?: boolean;
  limitReason?: string;
}> {
  const clean = params.userHandle.replace(/^@+/, '').trim();
  const action = params.action || params.refType || 'unknown';
  const sourceId = params.sourceId || params.refId || '';
  const isAction = params.isAction ?? (['post', 'reply', 'vote', 'bazaar'].includes(action));

  if (sourceId && params.delta > 0) {
    const existing = await db.prepare(`
      SELECT id FROM points_ledger
      WHERE user_handle = ?
        AND (action = ? OR ref_type = ?)
        AND (source_id = ? OR ref_id = ?)
      LIMIT 1
    `).bind(clean, action, action, sourceId, sourceId).first();

    if (existing) {
      const userRewards = await getOrCreateUserRewards(db, clean);
      return {
        success: false,
        awardedDelta: 0,
        newBalance: userRewards.balance,
        isDuplicate: true,
        limitReason: 'Event has already been rewarded',
      };
    }
  }

  const rewards = await getOrCreateUserRewards(db, clean);
  const today = getTodayString(rewards.timezone_offset || 5.5);
  const daily = await getOrCreateDailyActivity(db, clean, today);

  if (isAction && params.delta > 0) {
    if (action === 'post' && (daily.posts_count || 0) >= DAILY_POSTS_LIMIT) {
      return {
        success: false,
        awardedDelta: 0,
        newBalance: rewards.balance,
        limitReached: true,
        limitReason: `Daily limit reached: maximum ${DAILY_POSTS_LIMIT} rewarded posts per day`,
      };
    }
    if (action === 'reply' && (daily.replies_count || 0) >= DAILY_REPLIES_LIMIT) {
      return {
        success: false,
        awardedDelta: 0,
        newBalance: rewards.balance,
        limitReached: true,
        limitReason: `Daily limit reached: maximum ${DAILY_REPLIES_LIMIT} rewarded replies per day`,
      };
    }
    if (action === 'vote' && (daily.votes_count || 0) >= DAILY_VOTES_LIMIT) {
      return {
        success: false,
        awardedDelta: 0,
        newBalance: rewards.balance,
        limitReached: true,
        limitReason: `Daily limit reached: maximum ${DAILY_VOTES_LIMIT} rewarded likes per day`,
      };
    }
    if (action === 'bazaar' && (daily.listings_count || 0) >= DAILY_LISTINGS_LIMIT) {
      return {
        success: false,
        awardedDelta: 0,
        newBalance: rewards.balance,
        limitReached: true,
        limitReason: `Daily limit reached: maximum ${DAILY_LISTINGS_LIMIT} rewarded listings per day`,
      };
    }
  }

  let effectiveDelta = params.delta;
  let capReached = false;

  if (isAction && params.delta > 0) {
    const remainingCap = Math.max(0, DAILY_POINTS_CAP - (daily.daily_points || 0));
    if (remainingCap <= 0) {
      return {
        success: false,
        awardedDelta: 0,
        newBalance: rewards.balance,
        capReached: true,
        limitReason: `Daily cap reached: ${DAILY_POINTS_CAP} of ${DAILY_POINTS_CAP} points used today`,
      };
    }
    if (effectiveDelta > remainingCap) {
      effectiveDelta = remainingCap;
      capReached = true;
    }
  }

  const newBalance = (rewards.balance || 0) + effectiveDelta;
  const newLifetime = Math.max(0, (rewards.lifetime_points || 0) + Math.max(0, effectiveDelta));
  const newWeekly = (rewards.weekly_points || 0) + Math.max(0, effectiveDelta);
  const newDailyPoints = (daily.daily_points || 0) + (isAction ? Math.max(0, effectiveDelta) : 0);

  const ledgerId = `led_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  try {
    await db.prepare(`
      INSERT INTO points_ledger (id, user_handle, delta, action, source_id, reason, ref_type, ref_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(ledgerId, clean, effectiveDelta, action, sourceId, params.reason, action, sourceId).run();
  } catch (err: any) {
    if (String(err).toLowerCase().includes('unique')) {
      return {
        success: false,
        awardedDelta: 0,
        newBalance: rewards.balance,
        isDuplicate: true,
        limitReason: 'Event has already been rewarded',
      };
    }
    throw err;
  }

  await db.prepare(`
    UPDATE user_rewards
    SET balance = ?, lifetime_points = ?, weekly_points = ?, daily_points_today = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_handle = ?
  `).bind(newBalance, newLifetime, newWeekly, newDailyPoints, clean).run();

  const postInc = action === 'post' ? 1 : 0;
  const replyInc = action === 'reply' ? 1 : 0;
  const voteInc = action === 'vote' ? 1 : 0;
  const listingInc = action === 'bazaar' ? 1 : 0;

  await db.prepare(`
    UPDATE user_daily_rewards
    SET posts_count = posts_count + ?,
        replies_count = replies_count + ?,
        votes_count = votes_count + ?,
        listings_count = listings_count + ?,
        daily_points = daily_points + ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_handle = ? AND date = ?
  `).bind(postInc, replyInc, voteInc, listingInc, isAction ? Math.max(0, effectiveDelta) : 0, clean, today).run();

  if (newDailyPoints >= DAILY_POINTS_CAP) {
    await checkAndFlagDailyCapAbuse(db, clean, today);
  }

  await checkAndAwardBadges(db, clean);

  return {
    success: true,
    awardedDelta: effectiveDelta,
    newBalance,
    capReached,
  };
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
  } else {
    await db.prepare("DELETE FROM user_badges WHERE (LOWER(user_handle) = ? OR LOWER(user_handle) = ?) AND badge_key = 'founding_neighbour'")
      .bind(clean, `@${clean}`).run();
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

  const today = getTodayString(rewards.timezone_offset || 5.5);
  const yesterday = getYesterdayString(rewards.timezone_offset || 5.5);

  const isStreakClaimedToday = rewards.last_streak_date === today;
  let activeStreakCount = rewards.streak_count || 0;
  let nextStreakDay = 1;
  let todayStreakPoints = DAILY_STREAK_REWARDS[0];

  if (isStreakClaimedToday) {
    nextStreakDay = activeStreakCount >= 7 ? 1 : activeStreakCount + 1;
    const streakIndex = Math.min(6, Math.max(0, activeStreakCount - 1));
    todayStreakPoints = DAILY_STREAK_REWARDS[streakIndex] || 5;
  } else if (rewards.last_streak_date === yesterday) {
    nextStreakDay = activeStreakCount >= 7 ? 1 : activeStreakCount + 1;
    const streakIndex = Math.min(6, Math.max(0, nextStreakDay - 1));
    todayStreakPoints = DAILY_STREAK_REWARDS[streakIndex] || 5;
  } else {
    activeStreakCount = 0;
    nextStreakDay = 1;
    todayStreakPoints = DAILY_STREAK_REWARDS[0];
  }

  const matureListings = await db.prepare(`
    SELECT id, title, price, image_urls_json
    FROM bazar_listings
    WHERE (seller_handle = ? OR seller_handle = ?)
      AND is_active = 1
      AND reward_credited = 0
      AND created_at <= datetime('now', '-24 hours')
    LIMIT 3
  `).bind(clean, `@${clean}`).all() as any;

  for (const item of matureListings.results || []) {
    let images: string[] = [];
    try {
      images = JSON.parse(item.image_urls_json || '[]');
    } catch (_) {}

    if (item.title && item.price > 0 && Array.isArray(images) && images.length > 0) {
      const bRes = await awardPoints(db, {
        userHandle: clean,
        delta: 10,
        reason: 'Listed an item in Bazaar for 24 hours',
        action: 'bazaar',
        sourceId: item.id,
        isAction: true,
      });
      if (bRes.success) {
        await db.prepare('UPDATE bazar_listings SET reward_credited = 1 WHERE id = ?').bind(item.id).run();
        rewards.balance = (rewards.balance || 0) + bRes.awardedDelta;
        rewards.lifetime_points = (rewards.lifetime_points || 0) + bRes.awardedDelta;
      }
    }
  }

  const daily = await getOrCreateDailyActivity(db, clean, today);

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
      streakCount: activeStreakCount,
      streakAwarded: isStreakClaimedToday,
      isStreakClaimedToday,
      nextStreakDay,
      todayStreakPoints,
      streakRewards: DAILY_STREAK_REWARDS,
      dailyPointsToday: daily.daily_points || 0,
      dailyCap: DAILY_POINTS_CAP,
      isCapReached: (daily.daily_points || 0) >= DAILY_POINTS_CAP,
      referralCode: rewards.referral_code,
      highestHelpfulBadge,
      badges: badges.results || [],
      dailyProgress: {
        posts: {
          current: daily.posts_count || 0,
          max: DAILY_POSTS_LIMIT,
          points: 5,
          isLimitReached: (daily.posts_count || 0) >= DAILY_POSTS_LIMIT,
        },
        replies: {
          current: daily.replies_count || 0,
          max: DAILY_REPLIES_LIMIT,
          points: 3,
          isLimitReached: (daily.replies_count || 0) >= DAILY_REPLIES_LIMIT,
        },
        votes: {
          current: daily.votes_count || 0,
          max: DAILY_VOTES_LIMIT,
          points: 5,
          isLimitReached: (daily.votes_count || 0) >= DAILY_VOTES_LIMIT,
        },
        likes: {
          current: daily.votes_count || 0,
          max: DAILY_VOTES_LIMIT,
          points: 5,
          isLimitReached: (daily.votes_count || 0) >= DAILY_VOTES_LIMIT,
        },
        listings: {
          current: daily.listings_count || 0,
          max: DAILY_LISTINGS_LIMIT,
          points: 10,
          isLimitReached: (daily.listings_count || 0) >= DAILY_LISTINGS_LIMIT,
        },
        dailyCap: DAILY_POINTS_CAP,
        dailyPointsUsed: daily.daily_points || 0,
        isCapReached: (daily.daily_points || 0) >= DAILY_POINTS_CAP,
      },
      progress: {
        likeCount: helpfulVotes,
        likesReceived: helpfulVotes,
        highestLikeBadge: highestHelpfulBadge,
        helpfulVotes,
        soldCount,
        nextGoalPoints,
        pointsToNextGoal,
      },
    },
  });
});

rewardsApp.post('/streak/claim', authMiddleware, async (c) => {
  const user = c.get('user');
  const clean = (user.userHandle || '').replace(/^@+/, '').trim();
  const db = getDatabase(c);

  const rewards = await getOrCreateUserRewards(db, clean);
  const today = getTodayString(rewards.timezone_offset || 5.5);
  const yesterday = getYesterdayString(rewards.timezone_offset || 5.5);

  if (rewards.last_streak_date === today) {
    return c.json({
      success: false,
      error: 'Daily streak reward already claimed for today',
      alreadyClaimed: true,
      streakCount: rewards.streak_count || 1,
      balance: rewards.balance || 0,
    }, 400);
  }

  let newStreak = 1;
  if (rewards.last_streak_date === yesterday) {
    newStreak = ((rewards.streak_count || 0) % 7) + 1;
  } else {
    newStreak = 1;
  }

  const pointsToAward = DAILY_STREAK_REWARDS[newStreak - 1] || 5;

  await db.prepare('UPDATE user_rewards SET streak_count = ?, last_streak_date = ? WHERE user_handle = ?')
    .bind(newStreak, today, clean).run();

  const awardRes = await awardPoints(db, {
    userHandle: clean,
    delta: pointsToAward,
    reason: `Day ${newStreak} daily streak reward (+${pointsToAward} coins)`,
    action: 'streak',
    sourceId: `streak_${today}_${clean}`,
    isAction: false,
  });

  return c.json({
    success: true,
    data: {
      streakCount: newStreak,
      pointsAwarded: pointsToAward,
      newBalance: awardRes.newBalance,
      isStreakClaimedToday: true,
      nextStreakDay: newStreak >= 7 ? 1 : newStreak + 1,
      todayStreakPoints: pointsToAward,
      streakRewards: DAILY_STREAK_REWARDS,
      message: `Claimed Day ${newStreak} reward! +${pointsToAward} coins added.`,
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

  const earnedRows = await db.prepare(
    'SELECT badge_key, earned_at FROM user_badges WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ?'
  ).bind(clean, `@${clean}`).all() as any;
  const earnedMap = new Map();
  for (const b of earnedRows.results || []) {
    earnedMap.set(b.badge_key, b.earned_at);
  }

  const founderRow = await db.prepare(
    'SELECT 1 FROM area_founders WHERE LOWER(user_id) = ? OR LOWER(user_id) = ?'
  ).bind(clean, `@${clean}`).first() as any;

  if (!founderRow && earnedMap.has('founding_neighbour')) {
    earnedMap.delete('founding_neighbour');
    await db.prepare(
      "DELETE FROM user_badges WHERE (LOWER(user_handle) = ? OR LOWER(user_handle) = ?) AND badge_key = 'founding_neighbour'"
    ).bind(clean, `@${clean}`).run();
  } else if (founderRow && !earnedMap.has('founding_neighbour')) {
    earnedMap.set('founding_neighbour', new Date().toISOString());
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
      description: 'Receive 10 likes on your comments and replies.',
      required: 10,
      current: helpfulVotes,
      earned: earnedMap.has('helper'),
      earnedAt: earnedMap.get('helper') || null,
    },
    {
      key: 'local_hero',
      name: 'Local Hero',
      description: 'Receive 50 likes on your comments and replies.',
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
  const deviceId = (body.deviceId || body.device_id || '').trim();
  const db = getDatabase(c);

  const validation = await validateReferralApplication(db, clean, code, deviceId);
  if (!validation.success) {
    return c.json({ success: false, error: validation.error }, 400);
  }

  const referralId = `ref_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  try {
    await db.prepare(`
      INSERT INTO referrals (id, inviter_handle, invitee_handle, code, status, device_id, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)
    `).bind(referralId, validation.inviterHandle, clean, code, deviceId).run();
  } catch (_) {
    return c.json({ success: false, error: 'Referral already applied' }, 400);
  }

  return c.json({ success: true, message: 'Referral applied! Post in your neighbourhood to earn +25 points for both of you.' });
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

  const listing = (await db.prepare('SELECT seller_handle FROM bazar_listings WHERE id = ?')
    .bind(listingId).first()) as any;
  if (!listing) {
    return c.json({ success: false, error: 'Listing not found' }, 404);
  }
  const cleanSeller = (listing.seller_handle || '').replace(/^@+/, '').trim();
  if (cleanSeller !== clean) {
    return c.json({ success: false, error: 'You can only boost your own listings.' }, 403);
  }

  const activeBoost = (await db.prepare('SELECT id FROM listing_boosts WHERE listing_id = ? AND ends_at > datetime("now")')
    .bind(listingId).first()) as any;
  if (activeBoost) {
    return c.json({ success: false, error: 'This listing is already currently boosted.' }, 400);
  }

  await getOrCreateUserRewards(db, clean);
  const boostCost = BOOST_COST;
  const deductRes = await db.prepare(
    'UPDATE user_rewards SET balance = balance - ? WHERE user_handle = ? AND balance >= ?'
  ).bind(boostCost, clean, boostCost).run();

  if (deductRes.meta?.changes === 0) {
    return c.json({ success: false, error: `Insufficient points. You need ${boostCost} points to boost.` }, 400);
  }

  const boostId = `boost_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  try {
    await db.prepare(`
      INSERT INTO listing_boosts (id, listing_id, user_handle, area_id, starts_at, ends_at, cost_points)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now', '+1 day'), ?)
    `).bind(boostId, listingId, clean, areaId, boostCost).run();

    await db.prepare(`
      INSERT INTO points_ledger (id, user_handle, delta, reason, ref_type, ref_id)
      VALUES (?, ?, ?, 'Featured in your area 24h boost', 'boost', ?)
    `).bind(`pl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`, clean, -boostCost, boostId).run();
  } catch (err) {
    await db.prepare('UPDATE user_rewards SET balance = balance + ? WHERE user_handle = ?').bind(boostCost, clean).run().catch(() => {});
    return c.json({ success: false, error: 'Could not boost listing. Points have been refunded.' }, 500);
  }

  return c.json({
    success: true,
    message: 'Listing featured for 24 hours!',
    endsAt,
  });
});

export const CURATED_SHOP_PERKS = [
  {
    id: 'perk_chai_10off',
    shop_id: 'shop_apna_chai',
    shop_name: 'Apna Chai & Cafe',
    category: 'Food & Cafe',
    logo_r2_path: '',
    address: 'Nearhood Partner · Vadodara',
    title: '10% OFF on Hot Beverages & Snacks',
    cost_points: 50,
    daily_limit: 10,
    active: 1,
    code_prefix: 'CHAI10',
  },
  {
    id: 'perk_bakery_50off',
    shop_id: 'shop_royal_bakery',
    shop_name: 'Royal Bakeries & Confectionery',
    category: 'Food & Cafe',
    logo_r2_path: '',
    address: 'Nearhood Partner · Vadodara',
    title: '₹50 OFF on Cakes & Pastries (Min ₹200)',
    cost_points: 100,
    daily_limit: 10,
    active: 1,
    code_prefix: 'BAKE50',
  },
  {
    id: 'perk_grocery_100off',
    shop_id: 'shop_aone_mart',
    shop_name: 'A-One Daily Mart & Groceries',
    category: 'Groceries',
    logo_r2_path: '',
    address: 'Nearhood Partner · Vadodara',
    title: '₹100 OFF on Daily Groceries (Min ₹500)',
    cost_points: 150,
    daily_limit: 10,
    active: 1,
    code_prefix: 'GROC100',
  },
  {
    id: 'perk_delivery_free',
    shop_id: 'shop_nh_delivery',
    shop_name: 'Nearhood Express Delivery',
    category: 'Services',
    logo_r2_path: '',
    address: 'Nearhood Community',
    title: 'Free Home Delivery Voucher',
    cost_points: 40,
    daily_limit: 15,
    active: 1,
    code_prefix: 'FREEDEL',
  },
  {
    id: 'perk_salon_100off',
    shop_id: 'shop_glamour_salon',
    shop_name: 'Glamour Unisex Salon & Spa',
    category: 'Services',
    logo_r2_path: '',
    address: 'Nearhood Partner · Vadodara',
    title: 'Flat ₹100 OFF on Salon Services',
    cost_points: 180,
    daily_limit: 10,
    active: 1,
    code_prefix: 'GLAM100',
  },
  {
    id: 'perk_pharmacy_15off',
    shop_id: 'shop_city_pharmacy',
    shop_name: 'City Care Medicos & Pharmacy',
    category: 'Healthcare',
    logo_r2_path: '',
    address: 'Nearhood Partner · Vadodara',
    title: '15% OFF on Wellness & Healthcare',
    cost_points: 120,
    daily_limit: 10,
    active: 1,
    code_prefix: 'MED15',
  },
  {
    id: 'perk_dining_150off',
    shop_id: 'shop_taste_punjab',
    shop_name: 'Taste of Punjab Family Restaurant',
    category: 'Food & Cafe',
    logo_r2_path: '',
    address: 'Nearhood Partner · Vadodara',
    title: '₹150 OFF on Family Dinner (Min ₹750)',
    cost_points: 250,
    daily_limit: 5,
    active: 1,
    code_prefix: 'DINE150',
  },
  {
    id: 'perk_bazar_boost',
    shop_id: 'shop_nh_bazar',
    shop_name: 'Nearhood Community Bazar',
    category: 'Bazar Boost',
    logo_r2_path: '',
    address: 'Nearhood Community',
    title: '24-Hour Listing Boost in Bazar',
    cost_points: 300,
    daily_limit: 5,
    active: 1,
    code_prefix: 'BOOST24',
  },
];

rewardsApp.get('/perks', authMiddleware, async (c) => {
  const db = getDatabase(c);
  let dbPerks: any[] = [];
  try {
    const perksRes = (await db.prepare(`
      SELECT sc.*, bs.shop_name, bs.category, bs.logo_r2_path, bs.address
      FROM shop_coupons sc
      JOIN bazar_shops bs ON sc.shop_id = bs.id
      WHERE sc.active = 1
      ORDER BY sc.created_at DESC
    `).all()) as any;
    dbPerks = perksRes.results || [];
  } catch (_) {}

  const seenIds = new Set(dbPerks.map((p: any) => p.id));
  const combined = [...dbPerks];
  for (const perk of CURATED_SHOP_PERKS) {
    if (!seenIds.has(perk.id)) {
      combined.push(perk);
    }
  }

  return c.json({
    success: true,
    perks: combined,
  });
});

rewardsApp.get('/my-coupons', authMiddleware, async (c) => {
  const user = c.get('user');
  const clean = (user.userHandle || '').replace(/^@+/, '').trim();
  const db = getDatabase(c);

  try {
    const rows = (await db.prepare(`
      SELECT uc.id, uc.code, uc.coupon_id, uc.expires_at, uc.status, uc.created_at
      FROM user_coupons uc
      WHERE uc.user_handle = ? OR uc.user_handle = ?
      ORDER BY uc.created_at DESC
    `).bind(clean, `@${clean}`).all()) as any;

    const list = (rows.results || []).map((row: any) => {
      const match = CURATED_SHOP_PERKS.find(p => p.id === row.coupon_id);
      return {
        id: row.id,
        code: row.code,
        title: match ? match.title : 'Shop Discount Coupon',
        expiresAt: row.expires_at,
        status: row.status,
      };
    });

    return c.json({
      success: true,
      coupons: list,
    });
  } catch (_) {
    return c.json({
      success: true,
      coupons: [],
    });
  }
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

  let couponTitle = '';
  let cost = 100;
  let codePrefix = 'PERK';

  let dbCoupon: any = null;
  try {
    dbCoupon = (await db.prepare('SELECT * FROM shop_coupons WHERE id = ? AND active = 1')
      .bind(couponId).first()) as any;
  } catch (_) {}

  const curated = CURATED_SHOP_PERKS.find(p => p.id === couponId);

  if (!dbCoupon && !curated) {
    return c.json({ success: false, error: 'Coupon not found or inactive' }, 404);
  }

  if (dbCoupon) {
    if (dbCoupon.expires_at && new Date(dbCoupon.expires_at).getTime() < Date.now()) {
      return c.json({ success: false, error: 'This coupon has expired' }, 400);
    }
    couponTitle = dbCoupon.title;
    cost = dbCoupon.cost_points || 100;
  } else if (curated) {
    couponTitle = curated.title;
    cost = curated.cost_points;
    codePrefix = curated.code_prefix;
  }

  await getOrCreateUserRewards(db, clean);

  const deductRes = await db.prepare(
    'UPDATE user_rewards SET balance = balance - ? WHERE user_handle = ? AND balance >= ?'
  ).bind(cost, clean, cost).run();

  if (deductRes.meta?.changes === 0) {
    return c.json({ success: false, error: `Need ${cost} points to unlock this coupon.` }, 400);
  }

  const userCouponId = `uc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const code = `NH-${codePrefix}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    await db.prepare(`
      INSERT INTO user_coupons (id, user_handle, coupon_id, code, expires_at, status, created_at)
      VALUES (?, ?, ?, ?, datetime('now', '+7 days'), 'active', CURRENT_TIMESTAMP)
    `).bind(userCouponId, clean, couponId, code).run();

    await db.prepare(`
      INSERT INTO points_ledger (id, user_handle, delta, reason, ref_type, ref_id)
      VALUES (?, ?, ?, ?, 'coupon', ?)
    `).bind(`pl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`, clean, -cost, `Unlocked ${couponTitle} coupon`, userCouponId).run();
  } catch (err) {
    await db.prepare('UPDATE user_rewards SET balance = balance + ? WHERE user_handle = ?').bind(cost, clean).run().catch(() => {});
    return c.json({ success: false, error: 'Could not unlock coupon. Points have been refunded.' }, 500);
  }

  return c.json({
    success: true,
    coupon: {
      id: userCouponId,
      code,
      title: couponTitle,
      expiresAt,
    },
  });
});

export async function handleReplyLikeOrVote(c: any) {
  const user = c.get('user');
  const voterHandle = (user?.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  if (!voterHandle) {
    return c.json({ success: false, error: 'Unauthorized: Missing user handle' }, 401);
  }
  const replyId = c.req.param('id') || c.req.param('commentId');
  const db = getDatabase(c);

  const comment = await db.prepare('SELECT author_handle, post_id FROM feed_comments WHERE id = ?')
    .bind(replyId).first() as any;

  if (!comment) {
    return c.json({ success: false, error: 'Reply not found' }, 404);
  }

  const authorHandle = (comment.author_handle || '').replace(/^@+/, '').trim().toLowerCase();
  if (authorHandle === voterHandle) {
    return c.json({ success: false, error: 'Cannot like your own comment' }, 400);
  }

  const existingVote = await db.prepare(
    'SELECT id, is_rewarded FROM helpful_votes WHERE reply_id = ? AND (LOWER(voter_handle) = ? OR LOWER(voter_handle) = ?)'
  ).bind(replyId, voterHandle, `@${voterHandle}`).first() as any;

  if (existingVote) {
    await db.prepare(
      'DELETE FROM helpful_votes WHERE reply_id = ? AND (LOWER(voter_handle) = ? OR LOWER(voter_handle) = ?)'
    ).bind(replyId, voterHandle, `@${voterHandle}`).run();

    if (existingVote.is_rewarded === 1) {
      await reversePoints(db, `${replyId}_${voterHandle}`, 'vote' as any).catch(() => {});
    }

    const countRow = (await db.prepare(
      'SELECT COUNT(*) as count FROM helpful_votes WHERE reply_id = ?'
    ).bind(replyId).first()) as any;
    const currentLikeCount = countRow?.count ?? 0;

    return c.json({
      success: true,
      action: 'unliked',
      isLiked: false,
      liked_by_me: false,
      likedByMe: false,
      likeCount: currentLikeCount,
      like_count: currentLikeCount,
      message: 'Like removed',
    });
  }

  const voteCheck = await validateHelpfulVote(db, voterHandle, authorHandle, replyId || '');

  let isRewarded = 0;
  let pointsAwarded = 0;
  let rewardMessage = '';

  if (voteCheck.eligible) {
    const awardRes = await awardPoints(db, {
      userHandle: authorHandle,
      delta: 5,
      reason: 'Comment liked by a neighbour',
      action: 'vote',
      sourceId: `${replyId}_${voterHandle}`,
      isAction: true,
    });

    if (awardRes.success && awardRes.awardedDelta > 0) {
      isRewarded = 1;
      pointsAwarded = awardRes.awardedDelta;
      rewardMessage = ' · +5 pts awarded to author';
    } else {
      rewardMessage = awardRes.limitReason ? ` (${awardRes.limitReason})` : '';
    }
  } else {
    rewardMessage = voteCheck.reason ? ` (${voteCheck.reason})` : '';
  }

  const voteId = `vote_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  await db.prepare(`
    INSERT OR IGNORE INTO helpful_votes (id, reply_id, voter_handle, author_handle, is_rewarded, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(voteId, replyId, voterHandle, authorHandle, isRewarded).run();

  if (authorHandle && authorHandle !== voterHandle) {
    try {
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const payload = {
        type: 'comment_like',
        commentId: replyId,
        postId: comment.post_id || '',
        senderHandle: voterHandle,
        likerHandle: voterHandle,
      };
      await db.prepare(`
        INSERT INTO notifications (id, target_handle, sender_handle, type, title, body, payload_json, is_read, created_at)
        VALUES (?, ?, ?, 'comment_like', 'Nearhood', ?, ?, 0, CURRENT_TIMESTAMP)
      `).bind(
        notifId,
        authorHandle,
        voterHandle,
        `@${voterHandle} liked your comment ❤️`,
        JSON.stringify(payload)
      ).run().catch(() => {});
    } catch (_) {}
  }

  const countRow = (await db.prepare(
    'SELECT COUNT(*) as count FROM helpful_votes WHERE reply_id = ?'
  ).bind(replyId).first()) as any;
  const currentLikeCount = countRow?.count ?? 0;

  return c.json({
    success: true,
    action: 'liked',
    isLiked: true,
    liked_by_me: true,
    likedByMe: true,
    likeCount: currentLikeCount,
    like_count: currentLikeCount,
    pointsAwarded,
    message: `Liked${rewardMessage}`,
  });
}

rewardsApp.post('/replies/:id/helpful', authMiddleware, handleReplyLikeOrVote);
rewardsApp.post('/replies/:id/like', authMiddleware, handleReplyLikeOrVote);
rewardsApp.post('/comments/:id/like', authMiddleware, handleReplyLikeOrVote);

rewardsApp.post('/bazaar/:id/claim', authMiddleware, async (c) => {
  const user = c.get('user');
  const clean = (user.userHandle || '').replace(/^@+/, '').trim();
  const listingId = c.req.param('id');
  const db = getDatabase(c);

  const listing = await db.prepare('SELECT * FROM bazar_listings WHERE id = ?')
    .bind(listingId).first() as any;

  if (!listing) {
    return c.json({ success: false, error: 'Listing not found' }, 404);
  }

  const cleanSeller = (listing.seller_handle || '').replace(/^@+/, '').trim();
  if (cleanSeller !== clean) {
    return c.json({ success: false, error: 'Unauthorized: you can only claim rewards for your own listings' }, 403);
  }

  if (listing.is_active !== 1) {
    return c.json({ success: false, error: 'Deleted or inactive listings are not eligible for rewards' }, 400);
  }

  if (listing.reward_credited === 1) {
    return c.json({ success: false, error: 'Listing reward has already been claimed' }, 400);
  }

  const createdTime = new Date(listing.created_at).getTime();
  const now = Date.now();
  if (now - createdTime < 24 * 60 * 60 * 1000) {
    const hoursLeft = Math.ceil((24 * 60 * 60 * 1000 - (now - createdTime)) / (1000 * 60 * 60));
    return c.json({ success: false, error: `Listing must be live for 24 hours. ${hoursLeft} hours remaining.` }, 400);
  }

  if (!listing.title || listing.title.trim().length === 0) {
    return c.json({ success: false, error: 'Listing must have a title to earn rewards' }, 400);
  }

  if (!listing.price || Number(listing.price) <= 0) {
    return c.json({ success: false, error: 'Listing must have a valid price to earn rewards' }, 400);
  }

  let images: string[] = [];
  try {
    images = JSON.parse(listing.image_urls_json || '[]');
  } catch (_) {}

  if (!Array.isArray(images) || images.length === 0) {
    return c.json({ success: false, error: 'Listing must include at least one photo to earn rewards' }, 400);
  }

  const awardRes = await awardPoints(db, {
    userHandle: clean,
    delta: 10,
    reason: 'Listed an item in Bazaar for 24 hours',
    action: 'bazaar',
    sourceId: listingId,
    isAction: true,
  });

  if (!awardRes.success) {
    return c.json({ success: false, error: awardRes.limitReason || 'Could not award points' }, 400);
  }

  await db.prepare('UPDATE bazar_listings SET reward_credited = 1 WHERE id = ?').bind(listingId).run();

  return c.json({
    success: true,
    pointsAwarded: awardRes.awardedDelta,
    newBalance: awardRes.newBalance,
    message: 'Bazaar listing reward credited: +10 pts',
  });
});

rewardsApp.get('/abuse', authMiddleware, async (c) => {
  const db = getDatabase(c);
  const rows = await db.prepare(`
    SELECT * FROM abuse_flags
    ORDER BY created_at DESC
    LIMIT 50
  `).all() as any;

  return c.json({
    success: true,
    flags: rows.results || [],
  });
});
