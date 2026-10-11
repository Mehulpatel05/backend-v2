import { D1Client } from '../src/db/d1_http_client';

try {
  process.loadEnvFile('.env');
} catch (_) {}

async function runMigration() {
  const db = new D1Client();

  const statements = [
    `CREATE TABLE IF NOT EXISTS user_daily_rewards (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_user_daily_rewards_date ON user_daily_rewards(date)`,
    `CREATE TABLE IF NOT EXISTS abuse_flags (
      id TEXT PRIMARY KEY,
      user_handle TEXT NOT NULL,
      flag_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      details_json TEXT DEFAULT '{}',
      status TEXT DEFAULT 'pending_review',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_abuse_flags_user ON abuse_flags(user_handle)`,
    `CREATE INDEX IF NOT EXISTS idx_abuse_flags_status ON abuse_flags(status)`,
    `ALTER TABLE points_ledger ADD COLUMN action TEXT DEFAULT ''`,
    `ALTER TABLE points_ledger ADD COLUMN source_id TEXT DEFAULT ''`,
    `UPDATE points_ledger SET action = ref_type WHERE action = '' OR action IS NULL`,
    `UPDATE points_ledger SET source_id = ref_id WHERE source_id = '' OR source_id IS NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_unique_action_source ON points_ledger(user_handle, action, source_id) WHERE source_id != ''`,
    `ALTER TABLE user_rewards ADD COLUMN consecutive_cap_days INTEGER DEFAULT 0`,
    `ALTER TABLE user_rewards ADD COLUMN is_flagged INTEGER DEFAULT 0`,
    `ALTER TABLE user_rewards ADD COLUMN flagged_reason TEXT DEFAULT ''`,
    `ALTER TABLE user_rewards ADD COLUMN timezone_offset REAL DEFAULT 5.5`,
    `ALTER TABLE helpful_votes ADD COLUMN is_rewarded INTEGER DEFAULT 0`,
    `ALTER TABLE referrals ADD COLUMN device_id TEXT DEFAULT ''`,
    `ALTER TABLE referrals ADD COLUMN invitee_phone TEXT DEFAULT ''`,
    `ALTER TABLE bazar_listings ADD COLUMN reward_credited INTEGER DEFAULT 0`,
  ];

  for (const sql of statements) {
    try {
      console.log('Executing:', sql.trim().split('\n')[0]);
      const res = await db.query(sql);
      if (res.success) {
        console.log('SUCCESS');
      } else {
        console.log('Result:', JSON.stringify(res));
      }
    } catch (err: any) {
      console.warn('Notice:', err?.message || err);
    }
  }

  console.log('Migration completed');
}

runMigration().catch(console.error);
