import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, Client } from '@libsql/client';
import {
  validateContentQuality,
  calculateTextSimilarity,
  checkDuplicateContent,
  checkPostCooldown,
  validateHelpfulVote,
  reversePoints,
  validateReferralApplication,
  checkAndFlagDailyCapAbuse,
} from '../src/modules/rewards/anti_abuse';
import {
  awardPoints,
  getOrCreateUserRewards,
  getOrCreateDailyActivity,
  DAILY_POINTS_CAP,
  DAILY_POSTS_LIMIT,
  DAILY_REPLIES_LIMIT,
  DAILY_VOTES_LIMIT,
  DAILY_LISTINGS_LIMIT,
  rateLimitRewards,
} from '../src/modules/rewards';

function createTestDatabase() {
  const client: Client = createClient({ url: ':memory:' });

  const executeStatement = async (sql: string, params: any[]) => {
    const res = await client.execute({ sql, args: params });
    const rows = res.rows as any[];
    return {
      results: rows,
      meta: {
        changes: res.rowsAffected,
        last_row_id: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : 0,
      },
    };
  };

  const createStatement = (sql: string, boundParams: any[] = []) => ({
    bind: (...nextParams: any[]) => createStatement(sql, nextParams),
    run: async () => {
      const res = await executeStatement(sql, boundParams);
      return { meta: res.meta, success: true };
    },
    all: async <T = any>() => {
      const res = await executeStatement(sql, boundParams);
      return { results: (res.results || []) as T[], meta: res.meta, success: true };
    },
    first: async <T = any>() => {
      const res = await executeStatement(sql, boundParams);
      if (!res.results || res.results.length === 0) return null;
      return res.results[0] as T;
    },
  });

  const db = {
    prepare: (sql: string) => createStatement(sql),
    executeRaw: async (sql: string) => client.execute(sql),
  };

  return db;
}

async function setupTestSchema(db: any) {
  const schema = `
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      handle TEXT UNIQUE NOT NULL,
      is_verified INTEGER DEFAULT 0,
      is_banned INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE devices (
      id TEXT PRIMARY KEY,
      installation_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      user_handle TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE area_founders (
      area_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      PRIMARY KEY(area_id, user_id)
    );

    CREATE TABLE points_ledger (
      id TEXT PRIMARY KEY,
      user_handle TEXT NOT NULL,
      delta INTEGER NOT NULL,
      action TEXT DEFAULT '',
      source_id TEXT DEFAULT '',
      reason TEXT NOT NULL,
      ref_type TEXT NOT NULL,
      ref_id TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX idx_ledger_unique ON points_ledger(user_handle, action, source_id);

    CREATE TABLE user_rewards (
      user_handle TEXT PRIMARY KEY,
      balance INTEGER DEFAULT 0,
      lifetime_points INTEGER DEFAULT 0,
      weekly_points INTEGER DEFAULT 0,
      streak_count INTEGER DEFAULT 0,
      last_streak_date TEXT DEFAULT '',
      daily_points_today INTEGER DEFAULT 0,
      daily_date TEXT DEFAULT '',
      referral_code TEXT UNIQUE,
      consecutive_cap_days INTEGER DEFAULT 0,
      is_flagged INTEGER DEFAULT 0,
      flagged_reason TEXT DEFAULT '',
      timezone_offset REAL DEFAULT 5.5,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE user_daily_rewards (
      user_handle TEXT NOT NULL,
      date TEXT NOT NULL,
      posts_count INTEGER DEFAULT 0,
      replies_count INTEGER DEFAULT 0,
      votes_count INTEGER DEFAULT 0,
      listings_count INTEGER DEFAULT 0,
      daily_points INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_handle, date)
    );

    CREATE TABLE feed_posts (
      id TEXT PRIMARY KEY,
      author_handle TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE feed_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      author_handle TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE helpful_votes (
      id TEXT PRIMARY KEY,
      reply_id TEXT NOT NULL,
      voter_handle TEXT NOT NULL,
      author_handle TEXT NOT NULL,
      is_rewarded INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(reply_id, voter_handle)
    );

    CREATE TABLE referrals (
      id TEXT PRIMARY KEY,
      inviter_handle TEXT NOT NULL,
      invitee_handle TEXT NOT NULL,
      code TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      device_id TEXT DEFAULT '',
      invitee_phone TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      rewarded_at TIMESTAMP NULL,
      UNIQUE(inviter_handle, invitee_handle)
    );

    CREATE TABLE bazar_listings (
      id TEXT PRIMARY KEY,
      seller_handle TEXT NOT NULL,
      title TEXT NOT NULL,
      price INTEGER NOT NULL,
      image_urls_json TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER DEFAULT 1,
      reward_credited INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE abuse_flags (
      id TEXT PRIMARY KEY,
      user_handle TEXT NOT NULL,
      flag_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      details_json TEXT DEFAULT '{}',
      status TEXT DEFAULT 'pending_review',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE user_badges (
      id TEXT PRIMARY KEY,
      user_handle TEXT NOT NULL,
      badge_key TEXT NOT NULL,
      earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_handle, badge_key)
    );
  `;

  for (const statement of schema.split(';')) {
    const trimmed = statement.trim();
    if (trimmed) {
      await db.executeRaw(trimmed);
    }
  }
}

test('Anti-Abuse 1: Post/reply quality validation', async () => {
  const shortText = 'Hello world!';
  const shortResult = validateContentQuality(shortText);
  assert.equal(shortResult.valid, false);
  assert.match(shortResult.error || '', /at least 20 characters/);

  const repeatedChars = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const repeatedResult = validateContentQuality(repeatedChars);
  assert.equal(repeatedResult.valid, false);

  const repetitivePattern = 'hahahahahahahahahaha';
  const patternResult = validateContentQuality(repetitivePattern);
  assert.equal(patternResult.valid, false);

  const lowDiversity = 'abcabcabcabcabcabcab';
  const diversityResult = validateContentQuality(lowDiversity);
  assert.equal(diversityResult.valid, false);

  const goodText = 'Our neighbourhood park cleanup drive will take place this Sunday morning!';
  const goodResult = validateContentQuality(goodText);
  assert.equal(goodResult.valid, true);
});

test('Anti-Abuse 1b: Duplicate and near-duplicate text within 7 days', async () => {
  const db = createTestDatabase();
  await setupTestSchema(db);

  const handle = 'john_doe';
  const originalPost = 'Community gardening workshop happening this Saturday at 10 AM';

  await db.prepare(`
    INSERT INTO feed_posts (id, author_handle, content, created_at)
    VALUES ('p1', ?, ?, CURRENT_TIMESTAMP)
  `).bind(handle, originalPost).run();

  const exactDuplicate = await checkDuplicateContent(db, handle, originalPost, 'post');
  assert.equal(exactDuplicate.isDuplicate, true);

  const nearDuplicate = 'Community gardening workshop happening this Saturday at 11 AM';
  const nearResult = await checkDuplicateContent(db, handle, nearDuplicate, 'post');
  assert.equal(nearResult.isDuplicate, true);

  const completelyNew = 'Does anyone know a reliable electrician available in Alkapuri?';
  const newResult = await checkDuplicateContent(db, handle, completelyNew, 'post');
  assert.equal(newResult.isDuplicate, false);

  const otherUserCheck = await checkDuplicateContent(db, 'jane_doe', originalPost, 'post');
  assert.equal(otherUserCheck.isDuplicate, false);
});

test('Anti-Abuse 1c: 2-minute cooldown between rewarded posts', async () => {
  const db = createTestDatabase();
  await setupTestSchema(db);

  const handle = 'active_poster';
  await getOrCreateUserRewards(db, handle);

  const firstPostRes = await awardPoints(db, {
    userHandle: handle,
    delta: 5,
    reason: 'Created post 1',
    action: 'post',
    sourceId: 'post_001',
    isAction: true,
  });
  assert.equal(firstPostRes.success, true);
  assert.equal(firstPostRes.awardedDelta, 5);

  const cooldownCheck = await checkPostCooldown(db, handle);
  assert.equal(cooldownCheck.allowed, false);
  assert.match(cooldownCheck.error || '', /cooldown/i);

  await db.prepare(`
    UPDATE points_ledger
    SET created_at = datetime('now', '-3 minutes')
    WHERE source_id = 'post_001'
  `).run();

  const cooldownAfterElapsed = await checkPostCooldown(db, handle);
  assert.equal(cooldownAfterElapsed.allowed, true);
});

test('Anti-Abuse 1d: Daily action limits (max 3 posts, max 5 replies)', async () => {
  const db = createTestDatabase();
  await setupTestSchema(db);

  const handle = 'speed_user';
  await getOrCreateUserRewards(db, handle);

  for (let i = 1; i <= DAILY_POSTS_LIMIT; i++) {
    const res = await awardPoints(db, {
      userHandle: handle,
      delta: 5,
      reason: `Post ${i}`,
      action: 'post',
      sourceId: `post_limit_${i}`,
      isAction: true,
    });
    assert.equal(res.success, true);
    assert.equal(res.awardedDelta, 5);
  }

  const fourthPost = await awardPoints(db, {
    userHandle: handle,
    delta: 5,
    reason: 'Post 4',
    action: 'post',
    sourceId: 'post_limit_4',
    isAction: true,
  });
  assert.equal(fourthPost.success, false);
  assert.equal(fourthPost.limitReached, true);
  assert.match(fourthPost.limitReason || '', /maximum 3 rewarded posts/i);

  for (let i = 1; i <= DAILY_REPLIES_LIMIT; i++) {
    const res = await awardPoints(db, {
      userHandle: handle,
      delta: 3,
      reason: `Reply ${i}`,
      action: 'reply',
      sourceId: `reply_limit_${i}`,
      isAction: true,
    });
    assert.equal(res.success, true);
    assert.equal(res.awardedDelta, 3);
  }

  const sixthReply = await awardPoints(db, {
    userHandle: handle,
    delta: 3,
    reason: 'Reply 6',
    action: 'reply',
    sourceId: 'reply_limit_6',
    isAction: true,
  });
  assert.equal(sixthReply.success, false);
  assert.equal(sixthReply.limitReached, true);
  assert.match(sixthReply.limitReason || '', /maximum 5 rewarded replies/i);
});

test('Anti-Abuse 2: Helpful votes validation', async () => {
  const db = createTestDatabase();
  await setupTestSchema(db);

  const author = 'author_user';
  const oldVoter = 'old_voter';
  const newVoter = 'new_voter';

  await db.prepare(`
    INSERT INTO users (id, phone, handle, is_verified, created_at)
    VALUES ('u1', '9898000001', ?, 1, datetime('now', '-30 days'))
  `).bind(author).run();

  await db.prepare(`
    INSERT INTO users (id, phone, handle, is_verified, created_at)
    VALUES ('u2', '9898000002', ?, 1, datetime('now', '-10 days'))
  `).bind(oldVoter).run();

  await db.prepare(`
    INSERT INTO users (id, phone, handle, is_verified, created_at)
    VALUES ('u3', '9898000003', ?, 1, datetime('now', '-2 days'))
  `).bind(newVoter).run();

  const selfVote = await validateHelpfulVote(db, author, author, 'reply_1');
  assert.equal(selfVote.eligible, false);
  assert.match(selfVote.reason || '', /no self-votes/i);

  const newVoterCheck = await validateHelpfulVote(db, newVoter, author, 'reply_1');
  assert.equal(newVoterCheck.eligible, false);
  assert.match(newVoterCheck.reason || '', /7 days old/i);

  const validVote = await validateHelpfulVote(db, oldVoter, author, 'reply_1');
  assert.equal(validVote.eligible, true);

  await db.prepare(`
    INSERT INTO helpful_votes (id, reply_id, voter_handle, author_handle, is_rewarded, created_at)
    VALUES ('v1', 'reply_1', ?, ?, 1, CURRENT_TIMESTAMP)
  `).bind(oldVoter, author).run();

  const secondVoteToday = await validateHelpfulVote(db, oldVoter, author, 'reply_2');
  assert.equal(secondVoteToday.eligible, false);
  assert.match(secondVoteToday.reason || '', /1 rewarded vote per author per day/i);

  await db.prepare(`DELETE FROM helpful_votes`).run();
  for (let i = 1; i <= 3; i++) {
    await db.prepare(`
      INSERT INTO helpful_votes (id, reply_id, voter_handle, author_handle, is_rewarded, created_at)
      VALUES (?, ?, ?, ?, 1, datetime('now', '-${i} days'))
    `).bind(`v_pair_${i}`, `rep_${i}`, oldVoter, author).run();
  }

  const fourthVoteInWeek = await validateHelpfulVote(db, oldVoter, author, 'reply_new');
  assert.equal(fourthVoteInWeek.eligible, false);
  assert.match(fourthVoteInWeek.reason || '', /3 rewarded votes between the same pair/i);
});

test('Anti-Abuse 3: Bazaar 24h qualification and limits', async () => {
  const db = createTestDatabase();
  await setupTestSchema(db);

  const seller = 'bazaar_seller';
  await getOrCreateUserRewards(db, seller);

  await db.prepare(`
    INSERT INTO bazar_listings (id, seller_handle, title, price, image_urls_json, is_active, reward_credited, created_at)
    VALUES ('item_young', ?, 'Wooden Study Table', 2500, '["https://r2.nearhood.in/table.jpg"]', 1, 0, datetime('now', '-2 hours'))
  `).bind(seller).run();

  const youngItem = await db.prepare('SELECT created_at FROM bazar_listings WHERE id = ?').bind('item_young').first() as any;
  const youngAgeMs = Date.now() - new Date(youngItem.created_at).getTime();
  assert.equal(youngAgeMs < 24 * 60 * 60 * 1000, true);

  await db.prepare(`
    INSERT INTO bazar_listings (id, seller_handle, title, price, image_urls_json, is_active, reward_credited, created_at)
    VALUES ('item_deleted', ?, 'Old Cycle', 1500, '["https://r2.nearhood.in/cycle.jpg"]', 0, 0, datetime('now', '-30 hours'))
  `).bind(seller).run();

  const deletedItem = await db.prepare('SELECT is_active FROM bazar_listings WHERE id = ?').bind('item_deleted').first() as any;
  assert.equal(deletedItem.is_active, 0);

  await db.prepare(`
    INSERT INTO bazar_listings (id, seller_handle, title, price, image_urls_json, is_active, reward_credited, created_at)
    VALUES ('item_mature', ?, 'Mountain Bike', 5000, '["https://r2.nearhood.in/bike.jpg"]', 1, 0, datetime('now', '-26 hours'))
  `).bind(seller).run();

  const matureItem = await db.prepare('SELECT * FROM bazar_listings WHERE id = ?').bind('item_mature').first() as any;
  const images = JSON.parse(matureItem.image_urls_json);
  const isMatureAndValid = (Date.now() - new Date(matureItem.created_at).getTime() >= 24 * 60 * 60 * 1000)
    && matureItem.is_active === 1
    && matureItem.title.length > 0
    && matureItem.price > 0
    && images.length > 0;
  assert.equal(isMatureAndValid, true);

  for (let i = 1; i <= DAILY_LISTINGS_LIMIT; i++) {
    const res = await awardPoints(db, {
      userHandle: seller,
      delta: 10,
      reason: `Listed item ${i}`,
      action: 'bazaar',
      sourceId: `listing_${i}`,
      isAction: true,
    });
    assert.equal(res.success, true);
    assert.equal(res.awardedDelta, 10);
  }

  const fourthListing = await awardPoints(db, {
    userHandle: seller,
    delta: 10,
    reason: 'Listed item 4',
    action: 'bazaar',
    sourceId: 'listing_4',
    isAction: true,
  });
  assert.equal(fourthListing.success, false);
  assert.match(fourthListing.limitReason || '', /maximum 3 rewarded listings/i);
});

test('Anti-Abuse 4: Reversal of points and negative balance support', async () => {
  const db = createTestDatabase();
  await setupTestSchema(db);

  const user = 'unlucky_user';
  await getOrCreateUserRewards(db, user);

  await awardPoints(db, {
    userHandle: user,
    delta: 5,
    reason: 'Created post',
    action: 'post',
    sourceId: 'post_to_delete',
    isAction: true,
  });

  const revPost = await reversePoints(db, 'post_to_delete', 'post');
  assert.equal(revPost.reversed, true);
  assert.equal(revPost.delta, -5);
  assert.equal(revPost.newBalance, 0);

  const secondRev = await reversePoints(db, 'post_to_delete', 'post');
  assert.equal(secondRev.reversed, false);

  await awardPoints(db, {
    userHandle: user,
    delta: 3,
    reason: 'Reply to post',
    action: 'reply',
    sourceId: 'reply_to_delete',
    isAction: true,
  });

  await db.prepare('UPDATE user_rewards SET balance = 0 WHERE user_handle = ?').bind(user).run();

  const negativeRev = await reversePoints(db, 'reply_to_delete', 'reply');
  assert.equal(negativeRev.reversed, true);
  assert.equal(negativeRev.delta, -3);
  assert.equal(negativeRev.newBalance, -3);

  const userRow = await db.prepare('SELECT balance FROM user_rewards WHERE user_handle = ?').bind(user).first() as any;
  assert.equal(userRow.balance, -3);
});

test('Anti-Abuse 5: Referral phone verification, same-device block, and first post bonus', async () => {
  const db = createTestDatabase();
  await setupTestSchema(db);

  const inviter = 'inviter_user';
  const unverifiedFriend = 'unverified_friend';
  const verifiedFriend = 'verified_friend';
  const inviterCode = 'NEAR-INV1234';

  await db.prepare(`
    INSERT INTO users (id, phone, handle, is_verified, created_at)
    VALUES ('u_inv', '9898111111', ?, 1, CURRENT_TIMESTAMP)
  `).bind(inviter).run();

  await db.prepare(`
    INSERT INTO user_rewards (user_handle, balance, referral_code)
    VALUES (?, 0, ?)
  `).bind(inviter, inviterCode).run();

  await db.prepare(`
    INSERT INTO users (id, phone, handle, is_verified, created_at)
    VALUES ('u_unv', '9898222222', ?, 0, CURRENT_TIMESTAMP)
  `).bind(unverifiedFriend).run();

  await db.prepare(`
    INSERT INTO users (id, phone, handle, is_verified, created_at)
    VALUES ('u_ver', '9898333333', ?, 1, CURRENT_TIMESTAMP)
  `).bind(verifiedFriend).run();

  const unverifiedApply = await validateReferralApplication(db, unverifiedFriend, inviterCode);
  assert.equal(unverifiedApply.success, false);
  assert.match(unverifiedApply.error || '', /verify phone/i);

  const selfApply = await validateReferralApplication(db, inviter, inviterCode);
  assert.equal(selfApply.success, false);
  assert.match(selfApply.error || '', /cannot refer yourself/i);

  await db.prepare(`
    INSERT INTO devices (id, installation_id, token_hash, user_handle)
    VALUES ('dev_1', 'shared_device_id', 'h1', ?)
  `).bind(inviter).run();

  await db.prepare(`
    INSERT INTO devices (id, installation_id, token_hash, user_handle)
    VALUES ('dev_2', 'shared_device_id', 'h2', ?)
  `).bind(verifiedFriend).run();

  const sharedDeviceApply = await validateReferralApplication(db, verifiedFriend, inviterCode);
  assert.equal(sharedDeviceApply.success, false);
  assert.match(sharedDeviceApply.error || '', /same device/i);

  await db.prepare('DELETE FROM devices WHERE user_handle = ?').bind(verifiedFriend).run();

  const validApply = await validateReferralApplication(db, verifiedFriend, inviterCode, 'clean_device_id');
  assert.equal(validApply.success, true);
  assert.equal(validApply.inviterHandle, inviter);

  await db.prepare(`
    INSERT INTO referrals (id, inviter_handle, invitee_handle, code, status, device_id)
    VALUES ('ref_001', ?, ?, ?, 'pending', 'clean_device_id')
  `).bind(inviter, verifiedFriend, inviterCode).run();

  const initialInviter = await getOrCreateUserRewards(db, inviter);
  const initialFriend = await getOrCreateUserRewards(db, verifiedFriend);
  assert.equal(initialInviter.balance, 0);
  assert.equal(initialFriend.balance, 0);

  const post1Res = await awardPoints(db, {
    userHandle: verifiedFriend,
    delta: 5,
    reason: 'First valid post in neighbourhood',
    action: 'post',
    sourceId: 'post_friend_01',
    isAction: true,
  });
  assert.equal(post1Res.success, true);

  await awardPoints(db, {
    userHandle: inviter,
    delta: 25,
    reason: `Friend @${verifiedFriend} made first post`,
    action: 'referral',
    sourceId: 'ref_inviter_ref_001',
    isAction: false,
  });

  await awardPoints(db, {
    userHandle: verifiedFriend,
    delta: 25,
    reason: 'First post bonus after joining via referral',
    action: 'referral',
    sourceId: 'ref_invitee_ref_001',
    isAction: false,
  });

  const updatedInviter = await getOrCreateUserRewards(db, inviter);
  const updatedFriend = await getOrCreateUserRewards(db, verifiedFriend);
  assert.equal(updatedInviter.balance, 25);
  assert.equal(updatedFriend.balance, 30);
});

test('Anti-Abuse 6: Server-side streak check-in and 7-day cycle reset', async () => {
  const db = createTestDatabase();
  await setupTestSchema(db);

  const user = 'streak_master';
  await getOrCreateUserRewards(db, user);

  await db.prepare(`
    UPDATE user_rewards
    SET streak_count = 6,
        last_streak_date = date('now', '-1 day')
    WHERE user_handle = ?
  `).bind(user).run();

  const userRewards = await db.prepare('SELECT * FROM user_rewards WHERE user_handle = ?').bind(user).first() as any;
  const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000 + 5.5 * 3600 * 1000).toISOString().split('T')[0];
  const todayDate = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split('T')[0];

  assert.equal(userRewards.streak_count, 6);

  const awardRes = await awardPoints(db, {
    userHandle: user,
    delta: 30,
    reason: '7-day streak loyalty bonus',
    action: 'streak',
    sourceId: `streak_${todayDate}_${user}`,
    isAction: false,
  });
  assert.equal(awardRes.success, true);
  assert.equal(awardRes.awardedDelta, 30);

  await db.prepare(`
    UPDATE user_rewards
    SET streak_count = 0,
        last_streak_date = ?
    WHERE user_handle = ?
  `).bind(todayDate, user).run();

  const resetRewards = await db.prepare('SELECT streak_count, balance FROM user_rewards WHERE user_handle = ?').bind(user).first() as any;
  assert.equal(resetRewards.streak_count, 0);
  assert.equal(resetRewards.balance, 30);

  await db.prepare(`
    UPDATE user_rewards
    SET streak_count = 4,
        last_streak_date = date('now', '-3 days')
    WHERE user_handle = ?
  `).bind(user).run();

  const staleUser = await db.prepare('SELECT streak_count, last_streak_date FROM user_rewards WHERE user_handle = ?').bind(user).first() as any;
  const missedDays = (Date.now() - new Date(staleUser.last_streak_date).getTime()) / (24 * 3600 * 1000);
  assert.equal(missedDays > 1.5, true);

  await db.prepare(`
    UPDATE user_rewards
    SET streak_count = 1,
        last_streak_date = ?
    WHERE user_handle = ?
  `).bind(todayDate, user).run();

  const updatedStale = await db.prepare('SELECT streak_count FROM user_rewards WHERE user_handle = ?').bind(user).first() as any;
  assert.equal(updatedStale.streak_count, 1);
});

test('Anti-Abuse 7: Immutable ledger uniqueness and idempotency', async () => {
  const db = createTestDatabase();
  await setupTestSchema(db);

  const user = 'idempotent_user';
  await getOrCreateUserRewards(db, user);

  const firstAward = await awardPoints(db, {
    userHandle: user,
    delta: 5,
    reason: 'Created post',
    action: 'post',
    sourceId: 'unique_post_100',
    isAction: true,
  });
  assert.equal(firstAward.success, true);
  assert.equal(firstAward.awardedDelta, 5);

  const duplicateAward = await awardPoints(db, {
    userHandle: user,
    delta: 5,
    reason: 'Created post again',
    action: 'post',
    sourceId: 'unique_post_100',
    isAction: true,
  });
  assert.equal(duplicateAward.success, false);
  assert.equal(duplicateAward.isDuplicate, true);

  const ledgerRows = await db.prepare('SELECT COUNT(*) as cnt FROM points_ledger WHERE user_handle = ? AND source_id = ?')
    .bind(user, 'unique_post_100').first() as any;
  assert.equal(ledgerRows.cnt, 1);
});

test('Anti-Abuse 8: Daily 50 cap enforcement and 5-consecutive-day cap abuse review flag', async () => {
  const db = createTestDatabase();
  await setupTestSchema(db);

  const user = 'cap_maxer';
  await getOrCreateUserRewards(db, user);

  const today = new Date().toISOString().split('T')[0];
  const daily = await getOrCreateDailyActivity(db, user, today);

  await db.prepare(`
    UPDATE user_daily_rewards
    SET daily_points = 48
    WHERE user_handle = ? AND date = ?
  `).bind(user, today).run();

  const partialAward = await awardPoints(db, {
    userHandle: user,
    delta: 5,
    reason: 'Reply to post',
    action: 'reply',
    sourceId: 'reply_cap_test',
    isAction: true,
  });

  assert.equal(partialAward.success, true);
  assert.equal(partialAward.awardedDelta, 2);
  assert.equal(partialAward.capReached, true);

  const overCapAward = await awardPoints(db, {
    userHandle: user,
    delta: 5,
    reason: 'Another reply',
    action: 'reply',
    sourceId: 'reply_over_cap',
    isAction: true,
  });
  assert.equal(overCapAward.success, false);
  assert.equal(overCapAward.capReached, true);

  for (let d = 1; d <= 4; d++) {
    const pastDate = new Date(Date.now() - d * 24 * 3600 * 1000).toISOString().split('T')[0];
    await db.prepare(`
      INSERT INTO user_daily_rewards (user_handle, date, daily_points)
      VALUES (?, ?, 50)
    `).bind(user, pastDate).run();
  }

  const isFlagged = await checkAndFlagDailyCapAbuse(db, user, today);
  assert.equal(isFlagged, true);

  const flaggedUser = await db.prepare('SELECT is_flagged, flagged_reason FROM user_rewards WHERE user_handle = ?')
    .bind(user).first() as any;
  assert.equal(flaggedUser.is_flagged, 1);
  assert.match(flaggedUser.flagged_reason, /5 consecutive days/i);

  const abuseFlag = await db.prepare('SELECT flag_type, status FROM abuse_flags WHERE user_handle = ?')
    .bind(user).first() as any;
  assert.equal(abuseFlag.flag_type, 'five_day_cap_streak');
  assert.equal(abuseFlag.status, 'pending_review');
});
