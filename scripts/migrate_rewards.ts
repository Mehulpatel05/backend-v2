import { D1Client } from '../src/db/d1_http_client';

try {
  process.loadEnvFile();
} catch (e) {}

async function main() {
  const db = new D1Client();

  const statements = [
    `CREATE TABLE IF NOT EXISTS points_ledger (
      id TEXT PRIMARY KEY,
      user_handle TEXT NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref_type TEXT NOT NULL,
      ref_id TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ledger_user ON points_ledger(user_handle, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_ledger_ref ON points_ledger(user_handle, ref_type, ref_id)`,
    `CREATE TABLE IF NOT EXISTS user_rewards (
      user_handle TEXT PRIMARY KEY,
      balance INTEGER DEFAULT 0,
      lifetime_points INTEGER DEFAULT 0,
      weekly_points INTEGER DEFAULT 0,
      streak_count INTEGER DEFAULT 0,
      last_streak_date TEXT DEFAULT '',
      daily_points_today INTEGER DEFAULT 0,
      daily_date TEXT DEFAULT '',
      referral_code TEXT UNIQUE,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS user_badges (
      id TEXT PRIMARY KEY,
      user_handle TEXT NOT NULL,
      badge_key TEXT NOT NULL,
      earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_handle, badge_key)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_badges_user ON user_badges(user_handle)`,
    `CREATE TABLE IF NOT EXISTS helpful_votes (
      id TEXT PRIMARY KEY,
      reply_id TEXT NOT NULL,
      voter_handle TEXT NOT NULL,
      author_handle TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(reply_id, voter_handle)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_helpful_reply ON helpful_votes(reply_id)`,
    `CREATE INDEX IF NOT EXISTS idx_helpful_author ON helpful_votes(author_handle)`,
    `CREATE TABLE IF NOT EXISTS referrals (
      id TEXT PRIMARY KEY,
      inviter_handle TEXT NOT NULL,
      invitee_handle TEXT NOT NULL,
      code TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      rewarded_at TIMESTAMP NULL,
      UNIQUE(inviter_handle, invitee_handle)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON referrals(inviter_handle)`,
    `CREATE INDEX IF NOT EXISTS idx_referrals_invitee ON referrals(invitee_handle)`,
    `CREATE TABLE IF NOT EXISTS listing_boosts (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      user_handle TEXT NOT NULL,
      area_id TEXT NOT NULL,
      starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ends_at TIMESTAMP NOT NULL,
      cost_points INTEGER DEFAULT 300
    )`,
    `CREATE INDEX IF NOT EXISTS idx_boosts_listing ON listing_boosts(listing_id)`,
    `CREATE INDEX IF NOT EXISTS idx_boosts_active ON listing_boosts(area_id, ends_at)`,
    `CREATE TABLE IF NOT EXISTS shop_coupons (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      owner_handle TEXT NOT NULL,
      title TEXT NOT NULL,
      cost_points INTEGER DEFAULT 100,
      daily_limit INTEGER DEFAULT 10,
      expires_at TIMESTAMP NULL,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_shop_coupons_shop ON shop_coupons(shop_id)`,
    `CREATE TABLE IF NOT EXISTS user_coupons (
      id TEXT PRIMARY KEY,
      user_handle TEXT NOT NULL,
      coupon_id TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      status TEXT DEFAULT 'active',
      redeemed_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_user_coupons_user ON user_coupons(user_handle)`,
  ];

  for (const sql of statements) {
    try {
      console.log('Running:', sql.trim().split('\n')[0]);
      await db.query(sql);
    } catch (e: any) {
      console.warn('Warning on SQL:', e?.message || e);
    }
  }

  console.log('Tables created successfully. Now backfilling existing user rewards and points...');

  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split('T')[0];

  const usersRes = await db.query('SELECT handle FROM users');
  const allUsers = usersRes.results || [];

  for (const u of allUsers) {
    const clean = (u.handle || '').replace(/^@+/, '').trim().toLowerCase();
    if (!clean) continue;

    const existing = await db.query('SELECT user_handle FROM user_rewards WHERE user_handle = ?', [clean]);
    if (!existing.results || existing.results.length === 0) {
      const randomCode = `NEAR-${clean.substring(0, 4).toUpperCase()}${Math.floor(100 + Math.random() * 900)}`;
      await db.query(`
        INSERT INTO user_rewards (user_handle, balance, lifetime_points, weekly_points, streak_count, last_streak_date, daily_points_today, daily_date, referral_code)
        VALUES (?, 0, 0, 0, 1, ?, 0, ?, ?)
      `, [clean, today, today, randomCode]);
    }
  }

  const postsRes = await db.query('SELECT id, author_handle, content, created_at FROM feed_posts WHERE status = \'active\'');
  for (const post of (postsRes.results || [])) {
    const clean = (post.author_handle || '').replace(/^@+/, '').trim().toLowerCase();
    const content = post.content || '';
    if (content.length >= 10) {
      const ledgerCheck = await db.query('SELECT id FROM points_ledger WHERE user_handle = ? AND ref_type = ? AND ref_id = ?', [clean, 'post', post.id]);
      if (!ledgerCheck.results || ledgerCheck.results.length === 0) {
        const ledgerId = `led_init_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        await db.query(`
          INSERT INTO points_ledger (id, user_handle, delta, reason, ref_type, ref_id, created_at)
          VALUES (?, ?, 5, 'Created a post in your neighbourhood', 'post', ?, ?)
        `, [ledgerId, clean, post.id, post.created_at || today]);

        await db.query(`
          UPDATE user_rewards
          SET balance = balance + 5,
              lifetime_points = lifetime_points + 5,
              weekly_points = weekly_points + 5,
              daily_points_today = daily_points_today + 5
          WHERE user_handle = ?
        `, [clean]);
      }
    }
  }

  const listingsRes = await db.query('SELECT id, seller_handle, created_at FROM bazar_listings WHERE is_active = 1');
  for (const item of (listingsRes.results || [])) {
    const clean = (item.seller_handle || '').replace(/^@+/, '').trim().toLowerCase();
    const ledgerCheck = await db.query('SELECT id FROM points_ledger WHERE user_handle = ? AND ref_type = ? AND ref_id = ?', [clean, 'listing', item.id]);
    if (!ledgerCheck.results || ledgerCheck.results.length === 0) {
      const ledgerId = `led_init_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await db.query(`
        INSERT INTO points_ledger (id, user_handle, delta, reason, ref_type, ref_id, created_at)
        VALUES (?, ?, 10, 'Listed an item in Bazaar', 'listing', ?, ?)
      `, [ledgerId, clean, item.id, item.created_at || today]);

      await db.query(`
        UPDATE user_rewards
        SET balance = balance + 10,
            lifetime_points = lifetime_points + 10,
            weekly_points = weekly_points + 10,
            daily_points_today = daily_points_today + 10
        WHERE user_handle = ?
      `, [clean]);
    }
  }

  const foundersRes = await db.query('SELECT user_id FROM area_founders');
  for (const f of (foundersRes.results || [])) {
    const clean = (f.user_id || '').replace(/^@+/, '').trim().toLowerCase();
    const badgeId = `bdg_founding_neighbour_${clean}`;
    await db.query(`
      INSERT OR IGNORE INTO user_badges (id, user_handle, badge_key, earned_at)
      VALUES (?, ?, 'founding_neighbour', CURRENT_TIMESTAMP)
    `, [badgeId, clean]);
  }

  console.log('Migration & Backfill completed successfully!');
}

main().catch(console.error);
