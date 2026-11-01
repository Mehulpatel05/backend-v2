CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    caller_handle TEXT NOT NULL,
    receiver_handle TEXT NOT NULL,
    call_type TEXT DEFAULT 'audio',
    status TEXT DEFAULT 'calling',
    sdp_offer TEXT DEFAULT '',
    sdp_answer TEXT DEFAULT '',
    caller_candidates_json TEXT DEFAULT '[]',
    receiver_candidates_json TEXT DEFAULT '[]',
    duration_seconds INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_clean_target ON notifications(LOWER(REPLACE(target_handle, '@', '')), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(target_handle, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_clean_receiver ON calls(LOWER(receiver_handle), status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_clean_caller ON calls(LOWER(caller_handle), status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_clean ON chat_messages(LOWER(chat_id), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feed_posts_status_created ON feed_posts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_posts_cat_status ON feed_posts(LOWER(category), status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_friendships_user1_lower ON friendships(LOWER(user1_handle));
CREATE INDEX IF NOT EXISTS idx_friendships_user2_lower ON friendships(LOWER(user2_handle));

CREATE INDEX IF NOT EXISTS idx_chats_user1_clean ON chats(LOWER(REPLACE(user1_handle, '@', '')), last_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_chats_user2_clean ON chats(LOWER(REPLACE(user2_handle, '@', '')), last_timestamp DESC);
