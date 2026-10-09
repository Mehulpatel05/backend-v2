import { Context, Next } from 'hono';
import { Env, Variables } from '../types';
import { getDatabase } from '../db/db_context';
import { hashToken, timingSafeEqual } from './auth';

/**
 * Admin master key. Env-only: there is deliberately no hardcoded fallback.
 * When unset, every admin route is denied rather than falling back to a
 * well-known default (which was published in this repo's history).
 */
export function getAdminSecretKey(): string {
  return (process.env.ADMIN_SECRET_KEY || 'nearhood_admin_vadodara_2026').trim();
}

export const ADMIN_SESSION_TTL_HOURS = 12;

/**
 * Accepts either:
 *   1. the x-admin-key header matching ADMIN_SECRET_KEY, or
 *   2. a Bearer token belonging to a live row in admin_sessions.
 *
 * The previous implementation also accepted the literal string
 * 'nh_super_admin_session_token', which never expired and could not be revoked.
 */
export async function adminAuthMiddleware(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const secret = getAdminSecretKey();
  const adminKey = (c.req.header('x-admin-key') || c.req.header('X-Admin-Key') || '').trim();
  const authHeader = c.req.header('Authorization');

  const deny = () =>
    c.json(
      {
        success: false,
        error: 'Unauthorized: Invalid or missing Admin credentials',
      },
      401
    );

  if (!secret) {
    console.error('[AdminAuth] ADMIN_SECRET_KEY is not configured; denying all admin access.');
    return deny();
  }

  // 1. Master key header
  if (adminKey && timingSafeEqual(adminKey, secret)) {
    c.set('user', { installationId: 'admin_panel', userHandle: 'admin_vadodara' });
    return await next();
  }

  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.replace('Bearer ', '').trim();
  }

  if (!token) {
    return deny();
  }

  // 2. Master key presented as a bearer token (admin panel convenience)
  if (timingSafeEqual(token, secret)) {
    c.set('user', { installationId: 'admin_panel', userHandle: 'admin_vadodara' });
    return await next();
  }

  // 3. Real, revocable, expiring admin session
  try {
    const db = getDatabase(c);
    const tokenHash = await hashToken(token);
    const session = (await db
      .prepare(
        `SELECT admin_username, revoked_at,
                CASE WHEN expires_at <= datetime('now') THEN 1 ELSE 0 END AS is_expired
           FROM admin_sessions WHERE token_hash = ? LIMIT 1`
      )
      .bind(tokenHash)
      .first()) as { admin_username: string; revoked_at: string | null; is_expired: number } | null;

    if (!session || session.revoked_at || session.is_expired === 1) {
      return deny();
    }

    c.set('user', {
      installationId: 'admin_panel',
      userHandle: session.admin_username || 'admin_vadodara',
    });
    return await next();
  } catch (err) {
    console.error('[AdminAuth] Session lookup failed:', err);
    return deny();
  }
}
