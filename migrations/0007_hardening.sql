-- ==========================================================
-- 0007_hardening.sql
-- Phase 1 security & correctness hardening
--   1. user_blocks       : real blocking (client UI already ships against this)
--   2. admin_sessions    : replaces the static 'nh_super_admin_session_token'
--   3. devices.expires_at: sessions previously never expired
--   4. phone_otps rate limiting columns (send_count / window_started_at)
-- ==========================================================

-- 1. Blocking ------------------------------------------------
CREATE TABLE IF NOT EXISTS user_blocks (
    id TEXT PRIMARY KEY,
    blocker_handle TEXT NOT NULL,
    blocked_handle TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(blocker_handle, blocked_handle)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_handle);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_handle);

-- 2. Admin sessions ------------------------------------------
CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    admin_username TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);

-- 3. Device session expiry -----------------------------------
ALTER TABLE devices ADD COLUMN expires_at TIMESTAMP NULL;

-- 4. OTP send rate limiting ----------------------------------
ALTER TABLE phone_otps ADD COLUMN send_count INTEGER DEFAULT 0;
ALTER TABLE phone_otps ADD COLUMN window_started_at TIMESTAMP NULL;

-- 5. User Ban Column -----------------------------------------
ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0;

-- 6. Saved Shops Table ---------------------------------------
CREATE TABLE IF NOT EXISTS bazar_saved_shops (
    id TEXT PRIMARY KEY,
    user_handle TEXT NOT NULL,
    shop_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_handle, shop_id)
);

CREATE INDEX IF NOT EXISTS idx_bazar_saved_shops_user ON bazar_saved_shops(user_handle);

-- 7. Chat Message Per-Party Deletion -------------------------
ALTER TABLE chat_messages ADD COLUMN deleted_by_sender INTEGER DEFAULT 0;
ALTER TABLE chat_messages ADD COLUMN deleted_by_receiver INTEGER DEFAULT 0;

