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
      'SELECT installation_id, token_hash, user_handle, revoked_at FROM devices WHERE token_hash = ? LIMIT 1'
    )
      .bind(tokenHash)
      .first()) as {
        installation_id: string;
        token_hash: string;
        user_handle: string;
        revoked_at: string | null;
      } | null;

    if (!session) {
      return c.json({ success: false, error: 'Unauthorized: Invalid session token' }, 401);
    }

    if (session.revoked_at) {
      return c.json({ success: false, error: 'Unauthorized: Session revoked' }, 401);
    }

    const userHandle = session.user_handle.replace(/^@+/, '').trim().toLowerCase();
    const installationId = session.installation_id;

    // Update last_seen_at for the valid device session
    try {
      await db.prepare('UPDATE devices SET last_seen_at = CURRENT_TIMESTAMP WHERE installation_id = ? AND token_hash = ?')
        .bind(installationId, tokenHash)
        .run();
    } catch (_) {}

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

