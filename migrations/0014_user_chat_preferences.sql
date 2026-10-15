ALTER TABLE user_preferences ADD COLUMN favourite_chats_json TEXT DEFAULT '[]';
ALTER TABLE user_preferences ADD COLUMN archived_chats_json TEXT DEFAULT '[]';
ALTER TABLE user_preferences ADD COLUMN locked_chats_json TEXT DEFAULT '[]';
ALTER TABLE user_preferences ADD COLUMN deleted_chats_json TEXT DEFAULT '[]';
ALTER TABLE user_preferences ADD COLUMN pinned_timestamps_json TEXT DEFAULT '{}';
ALTER TABLE user_preferences ADD COLUMN archived_timestamps_json TEXT DEFAULT '{}';
ALTER TABLE user_preferences ADD COLUMN chat_preferences_json TEXT DEFAULT '{}';
ALTER TABLE user_preferences ADD COLUMN keep_chats_archived INTEGER DEFAULT 0;
