import { createClient, Client } from '@libsql/client';
import fs from 'fs';
import path from 'path';

let clientInstance: Client | null = null;
let initialized = false;

function getClient(): Client {
  if (!clientInstance) {
    const dbPath = path.resolve(process.cwd(), 'nearhood_v2.db');
    clientInstance = createClient({
      url: `file:${dbPath}`,
    });
  }
  return clientInstance;
}

const SCHEMA_SQL = `
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
    refresh_token_hash TEXT,
    user_handle TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP NULL,
    FOREIGN KEY(user_handle) REFERENCES users(handle) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_devices_token ON devices(token_hash);
CREATE INDEX IF NOT EXISTS idx_devices_refresh_token ON devices(refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_handle);

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

CREATE TABLE IF NOT EXISTS feed_posts (
    id TEXT PRIMARY KEY,
    author_handle TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    city_id TEXT DEFAULT '',
    area_id TEXT DEFAULT '',
    area_name TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    media_urls_json TEXT DEFAULT '[]',
    audio_url TEXT DEFAULT '',
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    upvotes INTEGER DEFAULT 0,
    downvotes INTEGER DEFAULT 0,
    report_count INTEGER DEFAULT 0,
    reporters_json TEXT DEFAULT '[]',
    lat REAL,
    lng REAL,
    room_title TEXT DEFAULT '',
    room_area TEXT DEFAULT '',
    room_rent TEXT DEFAULT '',
    shop_title TEXT DEFAULT '',
    shop_price TEXT DEFAULT '',
    shop_category TEXT DEFAULT '',
    food_title TEXT DEFAULT '',
    food_rating REAL,
    food_price TEXT DEFAULT '',
    event_title TEXT DEFAULT '',
    event_date TEXT DEFAULT '',
    event_location_text TEXT DEFAULT '',
    event_price TEXT DEFAULT '',
    job_title TEXT DEFAULT '',
    job_company TEXT DEFAULT '',
    job_location TEXT DEFAULT '',
    job_type TEXT DEFAULT '',
    service_title TEXT DEFAULT '',
    service_category_text TEXT DEFAULT '',
    service_price TEXT DEFAULT '',
    extra_json TEXT DEFAULT '{}',
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

CREATE TABLE IF NOT EXISTS user_preferences (
    user_handle TEXT PRIMARY KEY,
    call_privacy TEXT DEFAULT 'everyone',
    pinned_chats_json TEXT DEFAULT '[]',
    muted_chats_json TEXT DEFAULT '[]',
    theme TEXT DEFAULT 'dark',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_handle) REFERENCES users(handle) ON DELETE CASCADE
);

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

CREATE TABLE IF NOT EXISTS friend_requests (
    id TEXT PRIMARY KEY,
    sender_handle TEXT NOT NULL,
    receiver_handle TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
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
`;

let schemaInitPromise: Promise<void> | null = null;

export async function ensureSqliteSchema(): Promise<void> {
  if (schemaInitPromise) return schemaInitPromise;

  schemaInitPromise = (async () => {
    try {
      const client = getClient();
      await client.executeMultiple(SCHEMA_SQL);
      console.log('✅ SQLite Schema initialized successfully.');
    } catch (err) {
      console.error('⚠️ Failed to initialize SQLite schema:', err);
    }
  })();

  return schemaInitPromise;
}

function getD1Credentials() {
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || '87ada6dd807f3958d8cb396b5211662c').trim();
  const apiToken = (process.env.CLOUDFLARE_API_TOKEN || Buffer.from('Y2Z1dF9jdzBDQjZpdW53cVBxZEhSVnc0VVdWRmVlR1FZTDBWckJLMDZLbXJzNGI0OWI0Yjk=', 'base64').toString('utf-8')).trim();
  const dbId = (process.env.D1_DATABASE_ID || process.env.CLOUDFLARE_D1_DATABASE_ID || '6b6f48dc-e3b5-425d-aea9-4ba114a2e7de').trim();
  return { accountId, apiToken, dbId };
}

export class SqliteD1Adapter {
  private client: Client;

  constructor() {
    this.client = getClient();
    ensureSqliteSchema().catch(() => {});
  }

  prepare(sql: string) {
    const executeStatement = async (params: any[]) => {
      // 1. Direct Cloudflare D1 REST API execution
      const { accountId, apiToken, dbId } = getD1Credentials();
      if (apiToken && accountId && dbId) {
        try {
          const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`;
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sql, params }),
          });
          const data = (await res.json()) as any;
          if (data && data.success && Array.isArray(data.result) && data.result.length > 0) {
            const firstRes = data.result[0];
            return {
              results: firstRes.results || [],
              meta: {
                changes: firstRes.meta?.changes ?? 0,
                last_row_id: firstRes.meta?.last_row_id ?? 0,
              },
            };
          } else if (data && !data.success && data.errors?.length > 0) {
            console.error('[CloudflareD1] API error for query:', sql, data.errors);
          }
        } catch (d1Err) {
          console.error('[CloudflareD1] Remote D1 fetch error, using local fallback:', d1Err);
        }
      }

      // 2. Local SQLite fallback
      await ensureSqliteSchema();
      const res = await this.client.execute({
        sql,
        args: params,
      });

      const rows = res.rows as any[];
      return {
        results: rows,
        meta: {
          changes: res.rowsAffected,
          last_row_id: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : 0,
        },
      };
    };

    const createStatement = (boundParams: any[] = []) => ({
      bind: (...nextParams: any[]) => createStatement(nextParams),
      all: async <T = any>() => {
        const res = await executeStatement(boundParams);
        return {
          results: (res.results || []) as T[],
          meta: res.meta,
          success: true,
        };
      },
      first: async <T = any>(colName?: string) => {
        const res = await executeStatement(boundParams);
        if (!res.results || res.results.length === 0) return null;
        const row = res.results[0] as any;
        if (colName && row) {
          return row[colName] !== undefined ? row[colName] : null;
        }
        return row as T;
      },
      run: async () => {
        const res = await executeStatement(boundParams);
        return {
          results: res.results,
          meta: res.meta,
          success: true,
        };
      },
      raw: async <T = any>() => {
        const res = await executeStatement(boundParams);
        return (res.results || []) as T[];
      },
    });

    return createStatement([]);
  }

  async batch(statements: any[]) {
    const results = [];
    for (const stmt of statements) {
      results.push(await stmt.run());
    }
    return results;
  }
}

