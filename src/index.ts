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
import { getDatabase } from './db/db_context';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. Enable Global CORS
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-installation-id'],
    exposeHeaders: ['Content-Length'],
    maxAge: 86400,
  })
);

// 2. Health & Status Endpoints
app.get('/', (c) => {
  return c.json({
    status: 'online',
    version: '2.0.0',
    service: 'Nearhood Cloudflare D1 & R2 Backend V2',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', async (c) => {
  try {
    const db = getDatabase(c);
    const dbTest = await db.prepare('SELECT 1 as live').first();
    return c.json({
      status: 'healthy',
      database: dbTest ? 'connected' : 'offline',
      r2Storage: 'configured',
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return c.json({ status: 'degraded', error: e.message }, 200);
  }
});

// 3. Mount Modular API Routes
app.route('/api/v2/auth', authApp);
app.route('/api/v2/profile', profileApp);
app.route('/api/v2/media', mediaApp);
app.route('/api/v2/storage', mediaApp);
app.route('/api/v2/bazar', bazarApp);
app.route('/api/v2/chats', chatApp);
app.route('/api/v2/chat', chatApp);
app.route('/api/v2/feed', feedApp);
app.route('/api/v2/posts', feedApp);
app.route('/api/v2/friends', friendsApp);
app.route('/api/v2/notifications', notificationsApp);

// 4. Central 404 & Error Handler
app.notFound((c) => {
  return c.json({ success: false, error: 'Endpoint not found', path: c.req.path }, 404);
});

app.onError((err, c) => {
  console.error('[Global Worker Error]:', err);
  return c.json({ success: false, error: err.message || 'Internal Server Error' }, 500);
});

export default app;
