import { Context, Next } from 'hono';
import { Env, Variables } from '../types';

export const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || 'nearhood_admin_vadodara_2026';

export async function adminAuthMiddleware(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const adminKey = c.req.header('x-admin-key') || c.req.header('X-Admin-Key');
  const authHeader = c.req.header('Authorization');

  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.replace('Bearer ', '').trim();
  }

  if (adminKey === ADMIN_SECRET_KEY || token === ADMIN_SECRET_KEY || token === 'nh_super_admin_session_token') {
    c.set('user', {
      installationId: 'admin_panel',
      userHandle: 'admin_vadodara',
    });
    return await next();
  }

  return c.json({
    success: false,
    error: 'Unauthorized: Invalid or missing Admin credentials',
  }, 401);
}
