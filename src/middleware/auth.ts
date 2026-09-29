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
  const headerHandle = (c.req.header('x-user-handle') || c.req.header('user-handle') || '').replace(/^@+/, '').trim().toLowerCase();
  const headerInstId = c.req.header('x-installation-id') || `inst_${Date.now()}`;
  const db = getDatabase(c);

  let userHandle = headerHandle;
  let installationId = headerInstId;

  const hasBearer = authHeader && authHeader.startsWith('Bearer ');
  const token = hasBearer ? authHeader.replace('Bearer ', '').trim() : '';

  try {
    if (token) {
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

      if (session) {
        if (session.revoked_at) {
          return c.json({ success: false, error: 'Unauthorized: Session revoked' }, 401);
        }
        installationId = session.installation_id;
        userHandle = (headerHandle && headerHandle.length > 0) ? headerHandle : session.user_handle.replace(/^@+/, '').trim().toLowerCase();

        // If client provided a fresh handle, sync it with devices table
        if (headerHandle && headerHandle.length > 0 && headerHandle !== session.user_handle.toLowerCase()) {
          try {
            await db.prepare('UPDATE devices SET user_handle = ?, last_seen_at = CURRENT_TIMESTAMP WHERE installation_id = ?')
              .bind(headerHandle, session.installation_id)
              .run();
          } catch (_) {}
        }
      } else if (headerHandle && headerHandle.length > 0) {
        userHandle = headerHandle;
        try {
          await db.prepare(
            `INSERT INTO devices (installation_id, token_hash, user_handle, created_at, last_seen_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT(installation_id) DO UPDATE SET
               token_hash = excluded.token_hash,
               user_handle = excluded.user_handle,
               last_seen_at = CURRENT_TIMESTAMP,
               revoked_at = NULL`
          )
            .bind(installationId, tokenHash, userHandle)
            .run();
        } catch (_) {}
      } else {
        return c.json({ success: false, error: 'Unauthorized: Invalid session token' }, 401);
      }
    } else if (headerHandle && headerHandle.length > 0) {
      // Direct user-handle authenticated session fallback
      userHandle = headerHandle;
    } else {
      return c.json({ success: false, error: 'Unauthorized: Missing credentials or user handle' }, 401);
    }

    // Auto-ensure user and profile exist for seamless relational integrity
    if (userHandle && userHandle.length > 0) {
      try {
        await db.batch([
          db.prepare(
            `INSERT INTO users (id, phone, handle) VALUES (?, ?, ?)
             ON CONFLICT(handle) DO NOTHING`
          ).bind(`u_${userHandle}`, `guest_${userHandle}`, userHandle),
          db.prepare(
            `INSERT INTO profiles (handle, user_id, display_name) VALUES (?, ?, ?)
             ON CONFLICT(handle) DO NOTHING`
          ).bind(userHandle, `u_${userHandle}`, userHandle),
        ]);
      } catch (_) {}
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
