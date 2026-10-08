import { D1Client } from '../src/db/d1_http_client';

try {
  process.loadEnvFile();
} catch (e) {}

async function main() {
  const db = new D1Client();

  const statements = [
    // 1. Devices and Users
    `ALTER TABLE devices ADD COLUMN expires_at TIMESTAMP NULL`,
    `ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0`,
    `ALTER TABLE profiles ADD COLUMN is_verified INTEGER DEFAULT 0`,
    `ALTER TABLE profiles ADD COLUMN name_updated_at TIMESTAMP NULL`,
    `ALTER TABLE profiles ADD COLUMN handle_updated_at TIMESTAMP NULL`,
    
    // 2. Blocking
    `CREATE TABLE IF NOT EXISTS user_blocks (
      id TEXT PRIMARY KEY,
      blocker_handle TEXT NOT NULL,
      blocked_handle TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(blocker_handle, blocked_handle)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_handle)`,
    `CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_handle)`,

    // 3. Admin Sessions
    `CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      admin_username TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NOT NULL,
      revoked_at TIMESTAMP NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at)`,

    // 4. OTP rate limiting
    `ALTER TABLE phone_otps ADD COLUMN send_count INTEGER DEFAULT 0`,
    `ALTER TABLE phone_otps ADD COLUMN window_started_at TIMESTAMP NULL`,

    // 5. Saved Shops
    `CREATE TABLE IF NOT EXISTS bazar_saved_shops (
      id TEXT PRIMARY KEY,
      user_handle TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_handle, shop_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_bazar_saved_shops_user ON bazar_saved_shops(user_handle)`,

    // 6. Chat messages deletion
    `ALTER TABLE chat_messages ADD COLUMN deleted_by_sender INTEGER DEFAULT 0`,
    `ALTER TABLE chat_messages ADD COLUMN deleted_by_receiver INTEGER DEFAULT 0`,

    // 7. Founding requests and Area founders
    `CREATE TABLE IF NOT EXISTS founding_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      area_id TEXT NOT NULL,
      city_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reason TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TIMESTAMP NULL,
      reviewed_by TEXT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_founding_requests_area_status ON founding_requests(area_id, status, created_at ASC)`,
    `CREATE INDEX IF NOT EXISTS idx_founding_requests_city ON founding_requests(city_id, status)`,
    `CREATE TABLE IF NOT EXISTS area_founders (
      area_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      seq INTEGER NOT NULL CHECK(seq >= 1 AND seq <= 100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(area_id, user_id),
      UNIQUE(area_id, seq)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_area_founders_area ON area_founders(area_id, seq ASC)`,
    `CREATE INDEX IF NOT EXISTS idx_area_founders_user ON area_founders(user_id)`,

    // 8. Rewards System
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
      const label = sql.trim().split('\n')[0];
      console.log('Running:', label);
      const res = await db.query(sql);
      console.log('  -> Result:', res?.success ? 'SUCCESS' : res?.errors || 'OK');
    } catch (e: any) {
      console.warn('  -> Warning/Skip:', e?.message || e);
    }
  }

  console.log('All migrations processed.');
}

main().catch(console.error);
