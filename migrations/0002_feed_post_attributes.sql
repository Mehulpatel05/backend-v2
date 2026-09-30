-- ==========================================================
-- Migration 0002: Feed Post Attributes, Votes, Preferences, and Refresh Tokens
-- ==========================================================

-- 1. Add missing feed_posts columns for rich posts
ALTER TABLE feed_posts ADD COLUMN category TEXT DEFAULT 'general';
ALTER TABLE feed_posts ADD COLUMN city_id TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN area_id TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN area_name TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN image_url TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN upvotes INTEGER DEFAULT 0;
ALTER TABLE feed_posts ADD COLUMN downvotes INTEGER DEFAULT 0;
ALTER TABLE feed_posts ADD COLUMN report_count INTEGER DEFAULT 0;
ALTER TABLE feed_posts ADD COLUMN reporters_json TEXT DEFAULT '[]';
ALTER TABLE feed_posts ADD COLUMN lat REAL;
ALTER TABLE feed_posts ADD COLUMN lng REAL;
ALTER TABLE feed_posts ADD COLUMN room_title TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN room_area TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN room_rent TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN shop_title TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN shop_price TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN shop_category TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN food_title TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN food_rating REAL;
ALTER TABLE feed_posts ADD COLUMN food_price TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN event_title TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN event_date TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN event_location_text TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN event_price TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN job_title TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN job_company TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN job_location TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN job_type TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN service_title TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN service_category_text TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN service_price TEXT DEFAULT '';
ALTER TABLE feed_posts ADD COLUMN extra_json TEXT DEFAULT '{}';

-- 2. Post Votes table for tracking upvotes/downvotes
CREATE TABLE IF NOT EXISTS post_votes (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    user_handle TEXT NOT NULL,
    vote_type INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(post_id, user_handle),
    FOREIGN KEY(post_id) REFERENCES feed_posts(id) ON DELETE CASCADE,
    FOREIGN KEY(user_handle) REFERENCES users(handle) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_post_votes_user ON post_votes(user_handle);
CREATE INDEX IF NOT EXISTS idx_post_votes_post ON post_votes(post_id);

-- 3. Add refresh_token_hash to devices table
ALTER TABLE devices ADD COLUMN refresh_token_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_devices_refresh_token ON devices(refresh_token_hash);

-- 4. User Preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
    user_handle TEXT PRIMARY KEY,
    call_privacy TEXT DEFAULT 'everyone',
    pinned_chats_json TEXT DEFAULT '[]',
    muted_chats_json TEXT DEFAULT '[]',
    theme TEXT DEFAULT 'dark',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_handle) REFERENCES users(handle) ON DELETE CASCADE
);

-- 5. User Feedback table
CREATE TABLE IF NOT EXISTS user_feedback (
    id TEXT PRIMARY KEY,
    user_handle TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    feedback_text TEXT NOT NULL,
    app_version TEXT DEFAULT '',
    device_info TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feedback_user ON user_feedback(user_handle);
