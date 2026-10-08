import { Context, Next } from 'hono';
import { Env, Variables } from '../types';
import { getDatabase } from '../db/db_context';

export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Length-independent, constant-time string comparison. Used for secret
 * comparisons so response timing does not leak how much of a secret matched.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  // Compare hashes so the loop length never depends on the secrets themselves.
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) {
    // Still burn a comparison pass to keep timing flat for the common case.
    let dummy = 0;
    for (let i = 0; i < aBytes.length; i++) dummy |= aBytes[i];
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

/** Access token lifetime. Sessions previously never expired server-side. */
export const SESSION_TTL_DAYS = 30;

export async function authMiddleware(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Unauthorized: Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    return c.json({ success: false, error: 'Unauthorized: Empty token provided' }, 401);
  }

  const db = getDatabase(c);

  try {
    const tokenHash = await hashToken(token);
    const session = (await db.prepare(
      `SELECT d.installation_id, d.token_hash, d.user_handle, d.revoked_at,
              CASE WHEN d.expires_at IS NOT NULL AND d.expires_at <= datetime('now') THEN 1 ELSE 0 END AS is_expired,
              COALESCE(u.is_banned, 0) AS is_banned
         FROM devices d
         LEFT JOIN users u ON (LOWER(u.handle) = LOWER(d.user_handle) OR LOWER(u.handle) = '@' || LOWER(d.user_handle))
        WHERE d.token_hash = ? LIMIT 1`
    )
      .bind(tokenHash)
      .first()) as {
        installation_id: string;
        token_hash: string;
        user_handle: string;
        revoked_at: string | null;
        is_expired: number;
        is_banned: number;
      } | null;

    if (!session) {
      return c.json({ success: false, error: 'Unauthorized: Invalid session token' }, 401);
    }

    if (session.is_banned === 1) {
      return c.json({ success: false, error: 'Unauthorized: Account suspended by administration' }, 403);
    }

    if (session.revoked_at) {
      return c.json({ success: false, error: 'Unauthorized: Session revoked' }, 401);
    }

    // Expiry is evaluated by SQLite (UTC) rather than JS. Parsing SQLite's
    // "YYYY-MM-DD HH:MM:SS" with `new Date()` treats it as local time, which
    // skewed every comparison by the server's UTC offset.
    if (session.is_expired === 1) {
      return c.json({ success: false, error: 'Unauthorized: Session expired' }, 401);
    }

    const userHandle = session.user_handle.replace(/^@+/, '').trim().toLowerCase();
    const installationId = session.installation_id;

    // Update last_seen_at for the valid device session
    try {
      await db.prepare('UPDATE devices SET last_seen_at = CURRENT_TIMESTAMP WHERE installation_id = ? AND token_hash = ?')
        .bind(installationId, tokenHash)
        .run();
    } catch (err) {
      console.warn('[AuthMiddleware] last_seen_at update failed:', err);
    }

    c.set('user', {
      installationId: installationId || 'inst_unknown',
      userHandle: userHandle,
    });

    await next();
  } catch (error: any) {
    console.error('[AuthMiddleware] Error:', error);
    return c.json({ success: false, error: 'Internal Auth Error' }, 500);
  }
}

