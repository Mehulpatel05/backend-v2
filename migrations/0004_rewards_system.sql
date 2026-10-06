-- ==========================================================
-- NEARHOOD V2 REWARDS & GAMIFICATION SYSTEM
-- ==========================================================

CREATE TABLE IF NOT EXISTS points_ledger (
    id TEXT PRIMARY KEY,
    user_handle TEXT NOT NULL,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    ref_type TEXT NOT NULL,
    ref_id TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ledger_user ON points_ledger(user_handle, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_ref ON points_ledger(user_handle, ref_type, ref_id);

CREATE TABLE IF NOT EXISTS user_rewards (
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
);

CREATE TABLE IF NOT EXISTS user_badges (
    id TEXT PRIMARY KEY,
    user_handle TEXT NOT NULL,
    badge_key TEXT NOT NULL,
    earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_handle, badge_key)
);

CREATE INDEX IF NOT EXISTS idx_badges_user ON user_badges(user_handle);

CREATE TABLE IF NOT EXISTS helpful_votes (
    id TEXT PRIMARY KEY,
    reply_id TEXT NOT NULL,
    voter_handle TEXT NOT NULL,
    author_handle TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(reply_id, voter_handle)
);

CREATE INDEX IF NOT EXISTS idx_helpful_reply ON helpful_votes(reply_id);
CREATE INDEX IF NOT EXISTS idx_helpful_author ON helpful_votes(author_handle);

CREATE TABLE IF NOT EXISTS referrals (
    id TEXT PRIMARY KEY,
    inviter_handle TEXT NOT NULL,
    invitee_handle TEXT NOT NULL,
    code TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    rewarded_at TIMESTAMP NULL,
    UNIQUE(inviter_handle, invitee_handle)
);

CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON referrals(inviter_handle);
CREATE INDEX IF NOT EXISTS idx_referrals_invitee ON referrals(invitee_handle);

CREATE TABLE IF NOT EXISTS listing_boosts (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    user_handle TEXT NOT NULL,
    area_id TEXT NOT NULL,
    starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ends_at TIMESTAMP NOT NULL,
    cost_points INTEGER DEFAULT 300
);

CREATE INDEX IF NOT EXISTS idx_boosts_listing ON listing_boosts(listing_id);
CREATE INDEX IF NOT EXISTS idx_boosts_active ON listing_boosts(area_id, ends_at);

CREATE TABLE IF NOT EXISTS shop_coupons (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    owner_handle TEXT NOT NULL,
    title TEXT NOT NULL,
    cost_points INTEGER DEFAULT 100,
    daily_limit INTEGER DEFAULT 10,
    expires_at TIMESTAMP NULL,
    active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shop_coupons_shop ON shop_coupons(shop_id);

CREATE TABLE IF NOT EXISTS user_coupons (
    id TEXT PRIMARY KEY,
    user_handle TEXT NOT NULL,
    coupon_id TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    status TEXT DEFAULT 'active',
    redeemed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_coupons_user ON user_coupons(user_handle);

CREATE TABLE IF NOT EXISTS area_founders (
    area_id TEXT NOT NULL,
    user_handle TEXT NOT NULL,
    seq_num INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(area_id, user_handle)
);

CREATE INDEX IF NOT EXISTS idx_area_founders ON area_founders(area_id);
