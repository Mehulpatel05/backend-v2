-- ==========================================================
-- NEARHOOD V2 CLOUDFLARE D1 DATABASE SCHEMA
-- Strict Per-User Ownership & Relational Architecture
-- ==========================================================

-- 1. USERS & SESSIONS
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    handle TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS devices (
    installation_id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    user_handle TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP NULL,
    FOREIGN KEY(user_handle) REFERENCES users(handle) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_devices_token ON devices(token_hash);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_handle);

-- 2. PROFILES
CREATE TABLE IF NOT EXISTS profiles (
    handle TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    bio TEXT DEFAULT '',
    avatar_r2_path TEXT DEFAULT '',
    banner_r2_path TEXT DEFAULT '',
    fcm_token TEXT DEFAULT '',
    friend_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(handle) REFERENCES users(handle) ON DELETE CASCADE
);

-- 3. FEED POSTS & INTERACTIONS
CREATE TABLE IF NOT EXISTS feed_posts (
    id TEXT PRIMARY KEY,
    author_handle TEXT NOT NULL,
    content TEXT NOT NULL,
    media_urls_json TEXT DEFAULT '[]',
    audio_url TEXT DEFAULT '',
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(author_handle) REFERENCES users(handle) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feed_author ON feed_posts(author_handle);
CREATE INDEX IF NOT EXISTS idx_feed_created ON feed_posts(created_at DESC);

CREATE TABLE IF NOT EXISTS feed_likes (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    user_handle TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(post_id, user_handle),
    FOREIGN KEY(post_id) REFERENCES feed_posts(id) ON DELETE CASCADE,
    FOREIGN KEY(user_handle) REFERENCES users(handle) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feed_comments (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    author_handle TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(post_id) REFERENCES feed_posts(id) ON DELETE CASCADE,
    FOREIGN KEY(author_handle) REFERENCES users(handle) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feed_comments_post ON feed_comments(post_id);

-- 4. BAZAR (SHOPS, LISTINGS & SAVED ITEMS)
CREATE TABLE IF NOT EXISTS bazar_shops (
    id TEXT PRIMARY KEY,
    owner_handle TEXT NOT NULL,
    shop_name TEXT NOT NULL,
    category TEXT NOT NULL,
    address TEXT NOT NULL,
    phone TEXT NOT NULL,
    banner_r2_path TEXT DEFAULT '',
    logo_r2_path TEXT DEFAULT '',
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(owner_handle) REFERENCES users(handle) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bazar_shops_owner ON bazar_shops(owner_handle);

CREATE TABLE IF NOT EXISTS bazar_listings (
    id TEXT PRIMARY KEY,
    seller_handle TEXT NOT NULL,
    shop_id TEXT NULL,
    title TEXT NOT NULL,
    price INTEGER NOT NULL,
    original_price TEXT DEFAULT '',
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    condition TEXT NOT NULL,
    location TEXT NOT NULL,
    image_urls_json TEXT NOT NULL DEFAULT '[]',
    views_count INTEGER DEFAULT 0,
    chats_count INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(seller_handle) REFERENCES users(handle) ON DELETE CASCADE,
    FOREIGN KEY(shop_id) REFERENCES bazar_shops(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bazar_seller ON bazar_listings(seller_handle);
CREATE INDEX IF NOT EXISTS idx_bazar_category ON bazar_listings(category);
CREATE INDEX IF NOT EXISTS idx_bazar_created ON bazar_listings(created_at DESC);

CREATE TABLE IF NOT EXISTS bazar_saved (
    id TEXT PRIMARY KEY,
    user_handle TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_handle, listing_id),
    FOREIGN KEY(user_handle) REFERENCES users(handle) ON DELETE CASCADE,
    FOREIGN KEY(listing_id) REFERENCES bazar_listings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bazar_saved_user ON bazar_saved(user_handle);

-- 5. 1-ON-1 DIRECT CHATS & MESSAGES
CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    canonical_id TEXT UNIQUE NOT NULL,
    user1_handle TEXT NOT NULL,
    user2_handle TEXT NOT NULL,
    last_message TEXT DEFAULT '',
    last_message_type TEXT DEFAULT 'text',
    last_timestamp INTEGER NOT NULL,
    unread_count_user1 INTEGER DEFAULT 0,
    unread_count_user2 INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chats_user1 ON chats(user1_handle);
CREATE INDEX IF NOT EXISTS idx_chats_user2 ON chats(user2_handle);
CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(last_timestamp DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    sender_handle TEXT NOT NULL,
    receiver_handle TEXT NOT NULL,
    content TEXT NOT NULL,
    media_r2_path TEXT DEFAULT '',
    message_type TEXT DEFAULT 'text',
    is_read INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, created_at ASC);

-- 6. FRIENDS & SOCIAL GRAPH
CREATE TABLE IF NOT EXISTS friend_requests (
    id TEXT PRIMARY KEY,
    sender_handle TEXT NOT NULL,
    receiver_handle TEXT NOT NULL,
    status TEXT DEFAULT 'pending', -- pending, accepted, rejected
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sender_handle, receiver_handle)
);

CREATE TABLE IF NOT EXISTS friendships (
    id TEXT PRIMARY KEY,
    user1_handle TEXT NOT NULL,
    user2_handle TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user1_handle, user2_handle)
);

CREATE INDEX IF NOT EXISTS idx_friendships_user1 ON friendships(user1_handle);
CREATE INDEX IF NOT EXISTS idx_friendships_user2 ON friendships(user2_handle);

-- 7. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    target_handle TEXT NOT NULL,
    sender_handle TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    payload_json TEXT DEFAULT '{}',
    is_read INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_handle, created_at DESC);
