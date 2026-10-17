CREATE TABLE IF NOT EXISTS scratch_cards (
  id TEXT PRIMARY KEY,
  user_handle TEXT NOT NULL,
  card_type TEXT DEFAULT 'daily',
  reward_type TEXT NOT NULL,
  reward_value INTEGER NOT NULL,
  coupon_id TEXT NULL,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  is_scratched INTEGER DEFAULT 0,
  scratched_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scratch_cards_user ON scratch_cards(user_handle, is_scratched);
