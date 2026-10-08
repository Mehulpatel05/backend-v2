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
    is_verified INTEGER DEFAULT 0,
    is_banned INTEGER DEFAULT 0,
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
    expires_at TIMESTAMP NULL,
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
    is_verified INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    name_updated_at TIMESTAMP NULL,
    handle_updated_at TIMESTAMP NULL,
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

CREATE TABLE IF NOT EXISTS bazar_saved_shops (
    id TEXT PRIMARY KEY,
    user_handle TEXT NOT NULL,
    shop_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_handle, shop_id),
    FOREIGN KEY(user_handle) REFERENCES users(handle) ON DELETE CASCADE,
    FOREIGN KEY(shop_id) REFERENCES bazar_shops(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bazar_saved_shops_user ON bazar_saved_shops(user_handle);

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
    deleted_by_sender INTEGER DEFAULT 0,
    deleted_by_receiver INTEGER DEFAULT 0,
    media_urls_json TEXT DEFAULT '[]',
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

CREATE TABLE IF NOT EXISTS phone_otps (
    phone TEXT PRIMARY KEY,
    otp_code TEXT NOT NULL,
    request_id TEXT NOT NULL,
    attempts INTEGER DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    send_count INTEGER DEFAULT 0,
    window_started_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_phone_otps_req ON phone_otps(request_id);

CREATE TABLE IF NOT EXISTS founding_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    area_id TEXT NOT NULL,
    city_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP NULL,
    reviewed_by TEXT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_founding_requests_active_user ON founding_requests(user_id) WHERE status IN ('pending', 'approved');
CREATE INDEX IF NOT EXISTS idx_founding_requests_area_status ON founding_requests(area_id, status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_founding_requests_city ON founding_requests(city_id, status);

CREATE TABLE IF NOT EXISTS area_founders (
    area_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    seq INTEGER NOT NULL CHECK(seq >= 1 AND seq <= 100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(area_id, user_id),
    UNIQUE(area_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_area_founders_area ON area_founders(area_id, seq ASC);
CREATE INDEX IF NOT EXISTS idx_area_founders_user ON area_founders(user_id);

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

CREATE TABLE IF NOT EXISTS user_blocks (
    id TEXT PRIMARY KEY,
    blocker_handle TEXT NOT NULL,
    blocked_handle TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(blocker_handle, blocked_handle)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_handle);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_handle);

CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    admin_username TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);
`;

let schemaInitPromise: Promise<void> | null = null;

/**
 * Splits a SQL script on statement boundaries, ignoring semicolons that appear
 * inside single-quoted string literals (e.g. partial-index WHERE clauses).
 */
function splitSqlStatements(script: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;

  for (let i = 0; i < script.length; i++) {
    const ch = script[i];

    if (ch === "'") {
      // '' inside a string literal is an escaped quote
      if (inString && script[i + 1] === "'") {
        current += "''";
        i++;
        continue;
      }
      inString = !inString;
      current += ch;
      continue;
    }

    if (ch === ';' && !inString) {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}

/** Errors we expect and can safely ignore when (re)applying idempotent DDL. */
function isBenignDdlError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('already exists') ||
    m.includes('duplicate column') ||
    m.includes('duplicate column name')
  );
}

export async function ensureSqliteSchema(): Promise<void> {
  if (schemaInitPromise) return schemaInitPromise;

  schemaInitPromise = (async () => {
    try {
      const client = getClient();
      const statements = splitSqlStatements(SCHEMA_SQL);

      for (const sql of statements) {
        try {
          await client.execute(sql);
        } catch (err: any) {
          const message = err?.message || String(err);
          if (!isBenignDdlError(message)) {
            console.error('[SqliteSchema] Statement failed:', sql.split('\n')[0], '→', message);
          }
        }
      }

      const migrations = [
        'ALTER TABLE profiles ADD COLUMN is_verified INTEGER DEFAULT 0',
        'ALTER TABLE profiles ADD COLUMN name_updated_at TIMESTAMP NULL',
        'ALTER TABLE profiles ADD COLUMN handle_updated_at TIMESTAMP NULL',
        'ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0',
        'ALTER TABLE feed_posts ADD COLUMN city_id TEXT DEFAULT ""',
        'ALTER TABLE feed_posts ADD COLUMN area_id TEXT DEFAULT ""',
        'ALTER TABLE feed_posts ADD COLUMN area_name TEXT DEFAULT ""',
        'ALTER TABLE feed_posts ADD COLUMN image_url TEXT DEFAULT ""',
        'ALTER TABLE feed_posts ADD COLUMN lat REAL',
        'ALTER TABLE feed_posts ADD COLUMN lng REAL',
        'ALTER TABLE devices ADD COLUMN refresh_token_hash TEXT',
        // 0007_hardening.sql
        'ALTER TABLE devices ADD COLUMN expires_at TIMESTAMP NULL',
        'ALTER TABLE phone_otps ADD COLUMN send_count INTEGER DEFAULT 0',
        'ALTER TABLE phone_otps ADD COLUMN window_started_at TIMESTAMP NULL',
      ];

      for (const m of migrations) {
        try {
          await client.execute(m);
        } catch (err: any) {
          const message = err?.message || String(err);
          if (!isBenignDdlError(message)) {
            console.error('[SqliteSchema] Migration failed:', m, '→', message);
          }
        }
      }

      console.log('✅ SQLite Schema initialized and migrated successfully.');
    } catch (err) {
      console.error('⚠️ Failed to initialize SQLite schema:', err);
    }
  })();

  return schemaInitPromise;
}

/**
 * Cloudflare D1 credentials. Env-only — there are deliberately no hardcoded
 * fallbacks here. If these are unset the adapter will refuse to run remote
 * queries (see executeStatement) instead of silently writing somewhere else.
 */
function getD1Credentials() {
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const apiToken = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const dbId = (process.env.D1_DATABASE_ID || process.env.CLOUDFLARE_D1_DATABASE_ID || '').trim();
  return { accountId, apiToken, dbId };
}

/**
 * Opt-in escape hatch for local development only. When D1 credentials are
 * configured, a failing D1 query must NOT silently fall through to the local
 * SQLite file — that produced split-brain data and silent loss on ephemeral
 * container disks.
 */
function isLocalFallbackAllowed(): boolean {
  return (process.env.DB_ALLOW_LOCAL_FALLBACK || '').trim().toLowerCase() === 'true';
}

export class SqliteD1Adapter {
  private client: Client;

  constructor() {
    this.client = getClient();
    ensureSqliteSchema().catch(() => {});
  }

  prepare(sql: string) {
    const executeStatement = async (params: any[]) => {
      const { accountId, apiToken, dbId } = getD1Credentials();
      const d1Configured = Boolean(apiToken && accountId && dbId);

      // 1. Remote Cloudflare D1 (authoritative when configured)
      if (d1Configured) {
        let data: any;
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
          data = (await res.json()) as any;
        } catch (networkErr: any) {
          if (!isLocalFallbackAllowed()) {
            console.error('[CloudflareD1] Network error for query:', sql.split('\n')[0], networkErr);
            throw new Error(`D1 request failed: ${networkErr?.message || String(networkErr)}`);
          }
          console.warn('[CloudflareD1] Network error; DB_ALLOW_LOCAL_FALLBACK is on, using local SQLite:', networkErr);
          data = null;
        }

        if (data) {
          if (data.success && Array.isArray(data.result) && data.result.length > 0) {
            const firstRes = data.result[0];
            return {
              results: firstRes.results || [],
              meta: {
                changes: firstRes.meta?.changes ?? 0,
                last_row_id: firstRes.meta?.last_row_id ?? 0,
              },
            };
          }

          // D1 answered but the query did not succeed. Surface it — do NOT
          // silently write to a different database.
          const errors = Array.isArray(data.errors) ? data.errors : [];
          const detail = errors.map((e: any) => e?.message || String(e)).join('; ') || 'unknown D1 error';
          if (!isLocalFallbackAllowed()) {
            console.error('[CloudflareD1] Query failed:', sql.split('\n')[0], detail);
            throw new Error(`D1 query failed: ${detail}`);
          }
          console.warn('[CloudflareD1] Query failed; DB_ALLOW_LOCAL_FALLBACK is on, using local SQLite:', detail);
        }
      }

      // 2. Local SQLite — only when D1 is not configured at all (dev), or when
      //    the operator explicitly opted into the fallback.
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

  /**
   * Runs statements sequentially and rejects on the first failure.
   *
   * ⚠️ NOT ATOMIC on this adapter. The Cloudflare D1 REST API executes one
   * statement per HTTP request, so a partial application is possible if a later
   * statement fails. The native Workers `env.DB.batch()` binding *is* atomic.
   *
   * Because of that, any flow whose correctness depends on all-or-nothing
   * semantics (counter updates paired with a row insert/delete) must not rely
   * on this method — await the statements individually and verify
   * `meta.changes` before applying the dependent write.
   *
   * It previously used Promise.allSettled, which never rejected and therefore
   * hid real schema errors behind `success: true` responses.
   */
  async batch(statements: any[]) {
    const results = [];
    for (const stmt of statements) {
      results.push(await stmt.run());
    }
    return results;
  }
}

