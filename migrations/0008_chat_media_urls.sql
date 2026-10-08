-- 0008_chat_media_urls.sql
-- Add media_urls_json column to chat_messages for multi-image chats
ALTER TABLE chat_messages ADD COLUMN media_urls_json TEXT DEFAULT '[]';
