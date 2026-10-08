import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, Variables } from './types';
import { authApp } from './modules/auth';
import { profileApp } from './modules/profile';
import { mediaApp } from './modules/media';
import { bazarApp } from './modules/bazar';
import { chatApp } from './modules/chat';
import { feedApp } from './modules/feed';
import { friendsApp } from './modules/friends';
import { notificationsApp } from './modules/notifications';
import { actionsApp } from './modules/actions';
import { presenceApp } from './modules/presence';
import { preferencesApp } from './modules/preferences';
import { feedbackApp } from './modules/feedback';
import { adminApp } from './modules/admin';
import { rewardsApp } from './modules/rewards';
import { foundingApp, adminFoundingApp } from './modules/founding';
import { accountDeletionApp } from './modules/account_deletion';
import { authMiddleware } from './middleware/auth';
import { getDatabase } from './db/db_context';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. Enable Global CORS
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-installation-id', 'x-admin-key', 'X-Admin-Key'],
    exposeHeaders: ['Content-Length'],
    maxAge: 86400,
  })
);

// 2. Health & Status Endpoints
const healthHandler = async (c: any) => {
  try {
    const db = getDatabase(c);
    const dbTest = (await db.prepare('SELECT COUNT(*) as cnt FROM users').first()) as any;
    return c.json({
      status: 'healthy',
      database: dbTest !== null ? 'connected' : 'offline',
      userCount: dbTest?.cnt ?? 0,
      r2Storage: 'configured',
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return c.json({ status: 'degraded', error: e.message }, 200);
  }
};

app.get('/', (c) => {
  return c.json({
    status: 'online',
    version: '2.0.0',
    service: 'Nearhood Cloudflare D1 & R2 Backend V2',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', healthHandler);
app.get('/api/v2/health', healthHandler);

// 3. User FCM Push Token Registration
const handleFcmToken = async (c: any) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const fcmToken = body.fcm_token || body.fcmToken || body.token || '';
  const db = getDatabase(c);

  try {
    const clean = (user.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
    await db.prepare('UPDATE profiles SET fcm_token = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(handle) = ? OR LOWER(handle) = ?')
      .bind(fcmToken, clean, `@${clean}`)
      .run();
  } catch (_) {}

  return c.json({ success: true, message: 'FCM token registered successfully' });
};

app.post('/api/v2/users/fcm-token', authMiddleware, handleFcmToken);
app.post('/users/fcm-token', authMiddleware, handleFcmToken);

// 4. Mount Modular API Routes
app.route('/api/v2/auth', authApp);
app.route('/auth', authApp);

app.route('/api/v2/account', accountDeletionApp);
app.route('/account', accountDeletionApp);

app.route('/api/v2/profile', profileApp);
app.route('/profile', profileApp);

app.route('/api/v2/media', mediaApp);
app.route('/media', mediaApp);
app.route('/api/v2/storage', mediaApp);
app.route('/storage', mediaApp);

app.route('/api/v2/bazar', bazarApp);
app.route('/bazar', bazarApp);

app.route('/api/v2/chats', chatApp);
app.route('/chats', chatApp);
app.route('/api/v2/chat', chatApp);
app.route('/chat', chatApp);

app.route('/api/v2/feed', feedApp);
app.route('/feed', feedApp);
app.route('/api/v2/posts', feedApp);
app.route('/posts', feedApp);

app.route('/api/v2/friends', friendsApp);
app.route('/friends', friendsApp);

app.route('/api/v2/notifications', notificationsApp);
app.route('/notifications', notificationsApp);

app.route('/api/v2/actions', actionsApp);
app.route('/actions', actionsApp);

app.route('/api/v2/presence', presenceApp);
app.route('/presence', presenceApp);

app.route('/api/v2/preferences', preferencesApp);
app.route('/preferences', preferencesApp);

app.route('/api/v2/feedback', feedbackApp);
app.route('/feedback', feedbackApp);

app.route('/api/v2/admin', adminApp);
app.route('/admin', adminApp);

app.route('/api/v2/rewards', rewardsApp);
app.route('/rewards', rewardsApp);

app.route('/api/v2/founding', foundingApp);
app.route('/founding', foundingApp);
app.route('/api/v2/admin/founding', adminFoundingApp);
app.route('/admin/founding', adminFoundingApp);

// 5. Central 404 & Error Handler
app.notFound((c) => {
  return c.json({ success: false, error: 'Endpoint not found', path: c.req.path }, 404);
});

app.onError((err, c) => {
  console.error('[Global Worker Error]:', err);
  return c.json({ success: false, error: err.message || 'Internal Server Error' }, 500);
});

export default app;

