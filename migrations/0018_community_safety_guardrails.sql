ALTER TABLE users ADD COLUMN is_age_18_plus INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN is_guardian INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN is_age_18_plus INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN is_guardian INTEGER DEFAULT 0;
CREATE TABLE IF NOT EXISTS banned_users (
    handle TEXT PRIMARY KEY,
    banned_by TEXT,
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS post_reports (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    reporter_handle TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_post_reports_post ON post_reports(post_id);
