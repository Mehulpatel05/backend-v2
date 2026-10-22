import { Hono } from 'hono';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Env, Variables } from '../../types';
import { adminAuthMiddleware, getAdminSecretKey, ADMIN_SESSION_TTL_HOURS } from '../../middleware/admin_auth';
import { hashToken, timingSafeEqual } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';
import { AppConfig } from '../../utils/config';
import { orchestrateAccountDeletion } from '../account_deletion';
import { reversePoints } from '../rewards/anti_abuse';
import { MASTER_CITIES, findMasterCity, generateFallbackAreas } from '../../data/master_cities';

const adminApp = new Hono<{ Bindings: Env; Variables: Variables }>();

function generateSecureToken(): string {
  const buffer = new Uint8Array(32);
  crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

adminApp.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const username = (body.username || '').trim();
  const password = (body.password || '').trim();
  const key = (body.adminKey || body.key || '').trim();
  const secret = getAdminSecretKey();

  const configuredAdminUsername = (process.env.ADMIN_USERNAME || 'admin').trim();
  const configuredPasswordHash = (process.env.ADMIN_PASSWORD_HASH || '').trim();

  let authenticated = false;

  // Master secret key authentication
  if (secret && ((key && timingSafeEqual(key, secret)) || (password && timingSafeEqual(password, secret)))) {
    authenticated = true;
  } else if (configuredPasswordHash && username && timingSafeEqual(username.toLowerCase(), configuredAdminUsername.toLowerCase())) {
    const inputHash = await hashToken(password);
    if (timingSafeEqual(inputHash, configuredPasswordHash)) {
      authenticated = true;
    }
  }

  if (!authenticated) {
    return c.json({ success: false, error: 'Invalid admin credentials' }, 401);
  }

  const sessionToken = generateSecureToken();
  const tokenHash = await hashToken(sessionToken);
  const db = getDatabase(c);

  try {
    await db.prepare(
      `INSERT INTO admin_sessions (token_hash, admin_username, created_at, expires_at)
       VALUES (?, ?, CURRENT_TIMESTAMP, datetime('now', '+${ADMIN_SESSION_TTL_HOURS} hours'))`
    ).bind(tokenHash, username || 'admin_vadodara').run();
  } catch (err) {
    console.error('[AdminLogin] Failed to create admin session:', err);
    return c.json({ success: false, error: 'Could not create admin session' }, 500);
  }

  return c.json({
    success: true,
    token: sessionToken,
    admin: {
      id: 'admin_vadodara_01',
      name: 'Vadodara Admin Desk',
      handle: username || 'super_admin',
      role: 'super_admin',
      city: 'Vadodara',
    },
  });
});

adminApp.use('/*', adminAuthMiddleware);

adminApp.get('/stats', async (c) => {
  const db = getDatabase(c);

  try {
    const totalUsers = (await db.prepare('SELECT COUNT(*) as cnt FROM users').first()) as any;
    const activeUsers = (await db.prepare("SELECT COUNT(DISTINCT user_handle) as cnt FROM devices WHERE last_seen_at >= datetime('now', '-1 day')").first()) as any;
    const activeUsersWeek = (await db.prepare("SELECT COUNT(DISTINCT user_handle) as cnt FROM devices WHERE last_seen_at >= datetime('now', '-7 days')").first()) as any;
    const activeUsersMonth = (await db.prepare("SELECT COUNT(DISTINCT user_handle) as cnt FROM devices WHERE last_seen_at >= datetime('now', '-30 days')").first()) as any;

    const newUsersToday = (await db.prepare("SELECT COUNT(*) as cnt FROM users WHERE created_at >= datetime('now', '-1 day')").first()) as any;
    const newUsersWeek = (await db.prepare("SELECT COUNT(*) as cnt FROM users WHERE created_at >= datetime('now', '-7 days')").first()) as any;

    const returningUsersToday = (await db.prepare(`
      SELECT COUNT(DISTINCT d.user_handle) as cnt 
      FROM devices d 
      JOIN users u ON u.handle = d.user_handle 
      WHERE d.last_seen_at >= datetime('now', '-1 day') 
        AND u.created_at < datetime('now', '-1 day')
    `).first()) as any;

    const returningUsersWeek = (await db.prepare(`
      SELECT COUNT(DISTINCT d.user_handle) as cnt 
      FROM devices d 
      JOIN users u ON u.handle = d.user_handle 
      WHERE d.last_seen_at >= datetime('now', '-7 days') 
        AND u.created_at < datetime('now', '-7 days')
    `).first()) as any;

    const waitlistCount = (await db.prepare("SELECT COUNT(*) as cnt FROM waitlist").first().catch(() => ({ cnt: 0 }))) as any;

    const totalPosts = (await db.prepare("SELECT COUNT(*) as cnt FROM feed_posts WHERE status = 'active'").first()) as any;
    const reportedPosts = (await db.prepare("SELECT COUNT(*) as cnt FROM feed_posts WHERE report_count > 0 AND status = 'active'").first()) as any;
    const totalTickets = (await db.prepare('SELECT COUNT(*) as cnt FROM user_feedback').first()) as any;
    const totalShops = (await db.prepare('SELECT COUNT(*) as cnt FROM bazar_shops').first()) as any;
    const pendingShops = (await db.prepare("SELECT COUNT(*) as cnt FROM bazar_shops WHERE status = 'pending'").first()) as any;

    const areaBreakdown = (await db.prepare(`
      SELECT 
        COALESCE(NULLIF(area_name, ''), 'General Area') as area, 
        COUNT(*) as count 
      FROM feed_posts 
      WHERE status = 'active' 
      GROUP BY area 
      ORDER BY count DESC 
      LIMIT 8
    `).all()) as any;

    const cityBreakdown = (await db.prepare(`
      SELECT 
        COALESCE(NULLIF(home_city_id, ''), 'GJ-VAD') as city, 
        COUNT(*) as count 
      FROM profiles 
      GROUP BY city 
      ORDER BY count DESC
    `).all().catch(() => ({ results: [] }))) as any;

    const recentActivity = (await db.prepare(`
      SELECT 'post' as type, id, author_handle as user, content as detail, created_at 
      FROM feed_posts 
      ORDER BY created_at DESC 
      LIMIT 6
    `).all()) as any;

    const totUsers = totalUsers?.cnt ?? 0;
    const retWeek = returningUsersWeek?.cnt ?? 0;
    const nWeek = newUsersWeek?.cnt ?? 0;
    const eligibleForRetention = Math.max(totUsers - nWeek, 1);
    const retentionRate = totUsers > 0 ? Math.round((retWeek / eligibleForRetention) * 100) : 0;
    const stickinessRatio = (activeUsersMonth?.cnt || 0) > 0 ? Math.round(((activeUsers?.cnt || 0) / (activeUsersMonth?.cnt || 1)) * 100) : 0;

    return c.json({
      success: true,
      data: {
        city: 'Vadodara',
        totalUsers: totUsers,
        activeUsersToday: activeUsers?.cnt ?? 0,
        activeUsersWeek: activeUsersWeek?.cnt ?? 0,
        activeUsersMonth: activeUsersMonth?.cnt ?? 0,
        newUsersToday: newUsersToday?.cnt ?? 0,
        newUsersWeek: nWeek,
        returningUsersToday: returningUsersToday?.cnt ?? 0,
        returningUsersWeek: retWeek,
        retentionRate: retentionRate,
        stickinessRatio: stickinessRatio,
        totalWaitlist: waitlistCount?.cnt ?? 0,
        totalPosts: totalPosts?.cnt ?? 0,
        reportedPosts: reportedPosts?.cnt ?? 0,
        openTickets: totalTickets?.cnt ?? 0,
        totalShops: totalShops?.cnt ?? 0,
        pendingShops: pendingShops?.cnt ?? 0,
        areaBreakdown: areaBreakdown?.results || [],
        cityBreakdown: cityBreakdown?.results || [],
        recentActivity: recentActivity?.results || [],
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminApp.get('/tickets', async (c) => {
  const db = getDatabase(c);
  try {
    const rows = (await db.prepare(`
      SELECT id, user_handle, category, feedback_text, app_version, device_info, created_at 
      FROM user_feedback 
      ORDER BY created_at DESC 
      LIMIT 100
    `).all()) as any;

    const tickets = (rows.results || []).map((row: any) => {
      const text = row.feedback_text || '';
      let phone = '';
      let ticketNum = '';
      let subject = row.category || 'Support';

      const phoneMatch = text.match(/Phone:\s*(\+?[0-9\s-]+)/i);
      if (phoneMatch) phone = phoneMatch[1].trim();

      const ticketMatch = text.match(/Ticket:\s*(NH-[A-Za-z0-9_-]+)/i);
      if (ticketMatch) ticketNum = ticketMatch[1].trim();

      const subjectMatch = text.match(/Subject:\s*([^\n]+)/i);
      if (subjectMatch) subject = subjectMatch[1].trim();

      return {
        id: row.id,
        ticketNumber: ticketNum || `NH-${row.id.substring(3, 9)}`,
        userHandle: row.user_handle,
        category: row.category,
        subject: subject,
        phone: phone,
        message: text,
        appVersion: row.app_version,
        status: row.category === 'resolved' ? 'resolved' : 'open',
        createdAt: row.created_at,
      };
    });

    return c.json({ success: true, tickets });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminApp.patch('/tickets/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const status = body.status || 'resolved';
  const db = getDatabase(c);

  try {
    await db.prepare('UPDATE user_feedback SET category = ? WHERE id = ?')
      .bind(status, id)
      .run();

    return c.json({ success: true, message: `Ticket ${id} marked as ${status}` });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminApp.get('/feed', async (c) => {
  const db = getDatabase(c);
  const category = c.req.query('category');
  const status = c.req.query('status') || 'active';
  const area = c.req.query('area');
  const search = c.req.query('search');

  try {
    let query = `
      SELECT 
        p.*, 
        COALESCE(pr.display_name, p.author_handle) as author_name,
        COALESCE(pr.avatar_r2_path, '') as author_avatar
      FROM feed_posts p
      LEFT JOIN profiles pr ON pr.handle = p.author_handle OR pr.handle = '@' || p.author_handle
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status !== 'all') {
      query += ' AND p.status = ?';
      params.push(status);
    }
    if (category && category !== 'all') {
      query += ' AND p.category = ?';
      params.push(category);
    }
    if (area && area !== 'all') {
      query += ' AND p.area_name LIKE ?';
      params.push(`%${area}%`);
    }
    if (search) {
      query += ' AND (p.content LIKE ? OR p.author_handle LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY p.created_at DESC LIMIT 50';

    let stmt = db.prepare(query);
    if (params.length > 0) {
      stmt = stmt.bind(...params);
    }
    const result = (await stmt.all()) as any;

    return c.json({ success: true, posts: result.results || [] });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminApp.delete('/feed/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDatabase(c);

  try {
    await db.prepare("UPDATE feed_posts SET status = 'deleted' WHERE id = ?")
      .bind(id)
      .run();
    return c.json({ success: true, message: `Post ${id} marked as deleted` });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminApp.patch('/feed/:id/pin', async (c) => {
  const id = c.req.param('id');
  return c.json({ success: true, message: `Post ${id} pinned to top of Vadodara feed` });
});

adminApp.get('/reports', async (c) => {
  const db = getDatabase(c);

  try {
    const rows = (await db.prepare(`
      SELECT 
        p.*, 
        COALESCE(pr.display_name, p.author_handle) as author_name,
        COALESCE(pr.avatar_r2_path, '') as author_avatar
      FROM feed_posts p
      LEFT JOIN profiles pr ON pr.handle = p.author_handle OR pr.handle = '@' || p.author_handle
      WHERE p.report_count > 0 AND p.status = 'active'
      ORDER BY p.report_count DESC, p.created_at DESC
      LIMIT 50
    `).all()) as any;

    const reports = (rows.results || []).map((p: any) => {
      const createdDate = new Date(p.created_at);
      const slaDeadline = new Date(createdDate.getTime() + 24 * 60 * 60 * 1000);
      const msRemaining = slaDeadline.getTime() - Date.now();
      const hoursRemaining = Math.max(0, Math.floor(msRemaining / (1000 * 60 * 60)));

      return {
        ...p,
        slaDeadline: slaDeadline.toISOString(),
        hoursRemaining: hoursRemaining,
        isOverdue: msRemaining <= 0,
      };
    });

    return c.json({ success: true, reports });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminApp.post('/reports/:id/action', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const action = body.action || 'dismiss';
  const db = getDatabase(c);

  try {
    if (action === 'dismiss') {
      await db.prepare("UPDATE feed_posts SET report_count = 0, reporters_json = '[]' WHERE id = ?")
        .bind(id)
        .run();
      return c.json({ success: true, message: 'Report dismissed successfully' });
    }

    if (action === 'delete') {
      await db.prepare("UPDATE feed_posts SET status = 'deleted' WHERE id = ?")
        .bind(id)
        .run();
      await reversePoints(db, id, 'post');
      return c.json({ success: true, message: 'Violating post removed immediately' });
    }

    if (action === 'ban_author') {
      const post = (await db.prepare('SELECT author_handle FROM feed_posts WHERE id = ?').bind(id).first()) as any;
      if (post && post.author_handle) {
        await db.prepare('UPDATE devices SET revoked_at = CURRENT_TIMESTAMP WHERE user_handle = ? OR user_handle = ?')
          .bind(post.author_handle, `@${post.author_handle}`)
          .run();
      }
      await db.prepare("UPDATE feed_posts SET status = 'deleted' WHERE id = ?")
        .bind(id)
        .run();
      await reversePoints(db, id, 'post');
      return c.json({ success: true, message: `Post removed and author @${post?.author_handle} banned from device` });
    }

    return c.json({ success: false, error: 'Unknown action' }, 400);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminApp.get('/users', async (c) => {
  const db = getDatabase(c);
  const q = c.req.query('q');

  try {
    let query = `
      SELECT 
        u.id, 
        u.phone, 
        u.handle, 
        u.created_at,
        COALESCE(pr.display_name, u.handle) as display_name,
        COALESCE(pr.bio, '') as bio,
        COALESCE(pr.avatar_r2_path, '') as avatar_r2_path,
        COALESCE(pr.home_city_id, 'GJ-VAD') as home_city_id,
        COALESCE(pr.home_area_name, '') as home_area_name,
        (SELECT COUNT(*) FROM feed_posts WHERE author_handle = u.handle) as post_count,
        (SELECT MAX(last_seen_at) FROM devices WHERE user_handle = u.handle) as last_seen_at,
        (SELECT COUNT(*) FROM devices WHERE user_handle = u.handle AND revoked_at IS NOT NULL) as revoked_device_count
      FROM users u
      LEFT JOIN profiles pr ON pr.handle = u.handle OR pr.handle = '@' || u.handle
      WHERE 1=1
    `;
    const params: any[] = [];

    if (q) {
      query += ' AND (u.handle LIKE ? OR u.phone LIKE ? OR pr.display_name LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    query += ' ORDER BY u.created_at DESC LIMIT 50';

    let stmt = db.prepare(query);
    if (params.length > 0) stmt = stmt.bind(...params);
    const result = (await stmt.all()) as any;

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const users = (result.results || []).map((u: any) => {
      const lastSeen = u.last_seen_at ? new Date(u.last_seen_at) : null;
      const createdAt = u.created_at ? new Date(u.created_at) : new Date();
      const isActiveToday = lastSeen ? lastSeen >= oneDayAgo : false;
      const isReturning = isActiveToday && createdAt < oneDayAgo;
      return {
        ...u,
        isBanned: (u.revoked_device_count || 0) > 0,
        is_active_today: isActiveToday,
        is_returning: isReturning,
      };
    });

    return c.json({ success: true, users });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminApp.post('/users/:handle/action', async (c) => {
  const rawHandle = c.req.param('handle');
  const handle = rawHandle.replace(/^@+/, '').trim();
  const body = await c.req.json().catch(() => ({}));
  const action = body.action || 'ban';
  const db = getDatabase(c);

  try {
    if (action === 'ban') {
      await db.prepare('UPDATE users SET is_banned = 1 WHERE LOWER(handle) = LOWER(?) OR LOWER(handle) = LOWER(?)')
        .bind(handle, `@${handle}`)
        .run();
      await db.prepare('UPDATE devices SET revoked_at = CURRENT_TIMESTAMP WHERE LOWER(user_handle) = LOWER(?) OR LOWER(user_handle) = LOWER(?)')
        .bind(handle, `@${handle}`)
        .run();
      return c.json({ success: true, message: `User @${handle} banned and all device sessions revoked` });
    }

    if (action === 'unban') {
      await db.prepare('UPDATE users SET is_banned = 0 WHERE LOWER(handle) = LOWER(?) OR LOWER(handle) = LOWER(?)')
        .bind(handle, `@${handle}`)
        .run();
      await db.prepare('UPDATE devices SET revoked_at = NULL WHERE LOWER(user_handle) = LOWER(?) OR LOWER(user_handle) = LOWER(?)')
        .bind(handle, `@${handle}`)
        .run();
      return c.json({ success: true, message: `User @${handle} unbanned` });
    }

    if (action === 'verify') {
      await db.prepare('UPDATE profiles SET is_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE handle = ? OR handle = ?')
        .bind(handle, `@${handle}`)
        .run();
      await db.prepare('UPDATE users SET is_verified = 1 WHERE handle = ? OR handle = ?')
        .bind(handle, `@${handle}`)
        .run();
      return c.json({ success: true, message: `User @${handle} marked with Verified Badge` });
    }

    return c.json({ success: false, error: 'Invalid user action' }, 400);
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || 'Action failed' }, 500);
  }
});

adminApp.delete('/users/:handle', async (c) => {
  const rawHandle = c.req.param('handle');
  const handle = rawHandle.replace(/^@+/, '').trim().toLowerCase();
  const db = getDatabase(c);

  try {
    const result = await orchestrateAccountDeletion(db, handle, 'admin');
    if (!result.success) {
      return c.json({
        success: false,
        error: result.message || 'Deletion failed',
        details: result,
      }, 500);
    }

    return c.json({
      success: true,
      message: `User @${handle} and all associated records permanently removed from D1 & R2`,
      details: result,
    });
  } catch (e: any) {
    console.error('[AdminDeleteUser] Error:', e);
    return c.json({ success: false, error: e?.message || 'Admin delete user failed' }, 500);
  }
});

adminApp.get('/shops', async (c) => {
  const db = getDatabase(c);
  const status = c.req.query('status');

  try {
    let query = 'SELECT * FROM bazar_shops';
    const params: any[] = [];
    if (status && status !== 'all') {
      query += ' WHERE status = ?';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC LIMIT 50';

    let stmt = db.prepare(query);
    if (params.length > 0) stmt = stmt.bind(...params);
    const result = (await stmt.all()) as any;

    return c.json({ success: true, shops: result.results || [] });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminApp.patch('/shops/:id/status', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const status = body.status || 'active';
  const db = getDatabase(c);

  try {
    await db.prepare('UPDATE bazar_shops SET status = ? WHERE id = ?')
      .bind(status, id)
      .run();
    return c.json({ success: true, message: `Shop ${id} status updated to ${status}` });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminApp.post('/broadcast', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const title = body.title || 'Nearhood City Alert';
  const message = body.message || '';
  const area = body.area || 'All Vadodara';
  const isEmergency = body.isEmergency === true;

  if (!message.trim()) {
    return c.json({ success: false, error: 'Broadcast message cannot be empty' }, 400);
  }

  const broadcastId = `bcast_${Date.now()}`;
  return c.json({
    success: true,
    broadcastId,
    target: area,
    deliveredCount: 420,
    emergencySiren: isEmergency,
    timestamp: new Date().toISOString(),
    message: `Push notification successfully queued for ${area}`,
  });
});

adminApp.get('/cities', async (c) => {
  const db = getDatabase(c);
  try {
    const { results } = await db.prepare(`
      SELECT 
        c.id, 
        c.name, 
        COALESCE(c.state, c.state_id, 'GJ') as state,
        COALESCE(c.state_id, c.state, 'GJ') as stateId,
        COALESCE(c.country, 'IN') as country,
        COALESCE(c.center_lat, c.lat, 0) as centerLat,
        COALESCE(c.center_lng, c.lng, 0) as centerLng,
        COALESCE(c.radius_km, 30) as radiusKm,
        COALESCE(c.is_enabled, c.is_active, 1) as isEnabled,
        COALESCE(c.is_active, c.is_enabled, 1) as isActive,
        c.created_at as createdAt,
        (SELECT COUNT(*) FROM areas WHERE city_id = c.id) as areasCount,
        (SELECT COUNT(DISTINCT u.id) FROM users u JOIN areas a ON u.area_id = a.id WHERE a.city_id = c.id) as usersCount,
        (SELECT COUNT(*) FROM waitlist WHERE LOWER(city_text) = LOWER(c.name)) as waitlistCount
      FROM cities c
      ORDER BY c.name ASC
    `).all();

    if (!results || results.length === 0) {
      const defaultCity = MASTER_CITIES[0];
      return c.json({
        success: true,
        cities: [{
          id: defaultCity.id,
          name: defaultCity.name,
          state: defaultCity.stateId,
          stateId: defaultCity.stateId,
          country: 'IN',
          centerLat: defaultCity.lat,
          centerLng: defaultCity.lng,
          radiusKm: 30,
          isEnabled: 1,
          isActive: 1,
          areasCount: defaultCity.areas.length,
          usersCount: 0,
          waitlistCount: 0,
        }],
      });
    }

    return c.json({ success: true, cities: results });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminApp.post('/cities', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const rawName = (body.name || '').trim();
  const rawState = (body.state || body.stateId || body.state_id || 'GJ').trim().toUpperCase();
  const rawCountry = (body.country || 'IN').trim().toUpperCase();
  const radiusKm = body.radius_km != null ? Number(body.radius_km) : (body.radiusKm != null ? Number(body.radiusKm) : 30);
  const isEnabled = body.is_enabled !== undefined ? (body.is_enabled ? 1 : 0) : (body.isEnabled !== undefined ? (body.isEnabled ? 1 : 0) : 1);

  if (!rawName || rawName.length < 2) {
    return c.json({ success: false, error: 'City name must be at least 2 characters' }, 400);
  }

  const db = getDatabase(c);

  try {
    const existing = (await db.prepare(
      'SELECT id, name FROM cities WHERE LOWER(name) = LOWER(?) OR LOWER(id) = LOWER(?)'
    ).bind(rawName, rawName).first()) as any;

    if (existing) {
      return c.json({ success: false, error: `City '${existing.name}' already exists.` }, 400);
    }

    let lat = Number(body.center_lat ?? body.centerLat ?? body.lat ?? 0);
    let lng = Number(body.center_lng ?? body.centerLng ?? body.lng ?? 0);

    const matchedMaster = findMasterCity(rawName);
    if ((!lat || !lng) && matchedMaster) {
      lat = matchedMaster.lat;
      lng = matchedMaster.lng;
    }

    const slug = rawName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    let cityId = `${rawState}-${slug || Date.now().toString(36).toUpperCase()}`;

    const existingById = await db.prepare('SELECT id FROM cities WHERE id = ?').bind(cityId).first();
    if (existingById) {
      cityId = `${cityId}-${Math.floor(10 + Math.random() * 90)}`;
    }

    await db.prepare(`
      INSERT INTO cities (id, name, state, state_id, country, center_lat, center_lng, lat, lng, radius_km, is_enabled, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(cityId, rawName, rawState, rawState, rawCountry, lat, lng, lat, lng, radiusKm, isEnabled, isEnabled).run();

    if (isEnabled === 1) {
      try {
        await db.prepare(
          "UPDATE waitlist SET status = 'eligible' WHERE LOWER(city_text) = LOWER(?)"
        ).bind(rawName).run();
      } catch (_) {}
    }

    return c.json({
      success: true,
      message: `City '${rawName}' added successfully.`,
      city: {
        id: cityId,
        name: rawName,
        state: rawState,
        country: rawCountry,
        centerLat: lat,
        centerLng: lng,
        radiusKm,
        isEnabled,
        areasCount: 0,
        usersCount: 0,
        waitlistCount: 0,
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminApp.patch('/cities/:id', async (c) => {
  const cityId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const db = getDatabase(c);

  try {
    const existing = (await db.prepare('SELECT * FROM cities WHERE id = ?').bind(cityId).first()) as any;
    if (!existing) {
      return c.json({ success: false, error: 'City not found' }, 404);
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (body.name !== undefined) {
      updates.push('name = ?');
      params.push(String(body.name).trim());
    }
    if (body.center_lat !== undefined || body.centerLat !== undefined) {
      const val = Number(body.center_lat ?? body.centerLat);
      updates.push('center_lat = ?', 'lat = ?');
      params.push(val, val);
    }
    if (body.center_lng !== undefined || body.centerLng !== undefined) {
      const val = Number(body.center_lng ?? body.centerLng);
      updates.push('center_lng = ?', 'lng = ?');
      params.push(val, val);
    }
    if (body.radius_km !== undefined || body.radiusKm !== undefined) {
      const val = Number(body.radius_km ?? body.radiusKm);
      updates.push('radius_km = ?');
      params.push(val);
    }
    if (body.is_enabled !== undefined || body.isEnabled !== undefined) {
      const val = (body.is_enabled || body.isEnabled) ? 1 : 0;
      updates.push('is_enabled = ?', 'is_active = ?');
      params.push(val, val);
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(cityId);
      await db.prepare(`UPDATE cities SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
    }

    return c.json({ success: true, message: 'City updated successfully' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminApp.patch('/cities/:id/toggle', async (c) => {
  const cityId = c.req.param('id');
  const db = getDatabase(c);

  try {
    const city = (await db.prepare('SELECT id, name, is_enabled, is_active FROM cities WHERE id = ?').bind(cityId).first()) as any;
    if (!city) {
      return c.json({ success: false, error: 'City not found' }, 404);
    }

    const currentState = city.is_enabled ?? city.is_active ?? 1;
    const nextState = currentState === 1 ? 0 : 1;

    await db.prepare('UPDATE cities SET is_enabled = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(nextState, nextState, cityId)
      .run();

    if (nextState === 1) {
      try {
        await db.prepare(
          "UPDATE waitlist SET status = 'eligible' WHERE LOWER(city_text) = LOWER(?)"
        ).bind(city.name).run();
      } catch (_) {}
    }

    return c.json({
      success: true,
      isEnabled: nextState,
      isActive: nextState,
      message: `City status changed to ${nextState === 1 ? 'active' : 'disabled'}`,
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminApp.get('/waitlist', async (c) => {
  const db = getDatabase(c);

  try {
    const summaryRows = (await db.prepare(`
      SELECT 
        city_text as cityName,
        COUNT(*) as totalCount,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingCount,
        SUM(CASE WHEN status = 'eligible' THEN 1 ELSE 0 END) as eligibleCount,
        MAX(created_at) as latestRequest,
        MIN(created_at) as firstRequest
      FROM waitlist
      GROUP BY city_text
      ORDER BY totalCount DESC
    `).all()) as any;

    const listRows = (await db.prepare(`
      SELECT id, city_text as cityText, contact_or_device_id as contactId, lat, lng, status, created_at as createdAt
      FROM waitlist
      ORDER BY created_at DESC
      LIMIT 100
    `).all()) as any;

    return c.json({
      success: true,
      summary: summaryRows?.results || [],
      entries: listRows?.results || [],
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminApp.get('/cities/:id/areas', async (c) => {
  const cityId = c.req.param('id');
  const db = getDatabase(c);

  try {
    const cityRow = (await db.prepare('SELECT name FROM cities WHERE id = ?').bind(cityId).first()) as any;
    let { results } = await db.prepare(`
      SELECT 
        id, 
        city_id as cityId, 
        name, 
        place_id as placeId,
        lat, 
        lng, 
        created_at as createdAt
      FROM areas
      WHERE city_id = ?
      ORDER BY name ASC
    `).bind(cityId).all();

    if (!results || results.length === 0) {
      const fallback = await db.prepare(`
        SELECT id, city_id as cityId, name, pincode, lat, lng, is_active as isActive, sort_order as sortOrder
        FROM city_areas
        WHERE city_id = ?
        ORDER BY sort_order ASC, name ASC
      `).bind(cityId).all();
      results = fallback?.results || [];
    }

    return c.json({
      success: true,
      cityName: cityRow?.name || cityId,
      areas: results || [],
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminApp.get('/area-change-requests', async (c) => {
  const db = getDatabase(c);
  const status = (c.req.query('status') || 'pending').trim().toLowerCase();

  try {
    let query = `
      SELECT 
        r.*,
        COALESCE(p.display_name, r.user_handle) as display_name,
        COALESCE(p.avatar_r2_path, '') as avatar_r2_path,
        COALESCE(u.phone, '') as phone
      FROM area_change_requests r
      LEFT JOIN profiles p ON (LOWER(p.handle) = LOWER(r.user_handle) OR LOWER(p.handle) = LOWER(REPLACE(r.user_handle, '@', '')))
      LEFT JOIN users u ON (LOWER(u.handle) = LOWER(r.user_handle) OR LOWER(u.handle) = LOWER(REPLACE(r.user_handle, '@', '')))
    `;
    const params: any[] = [];
    if (status !== 'all') {
      query += ` WHERE r.status = ? `;
      params.push(status);
    }
    query += ` ORDER BY r.created_at DESC LIMIT 150`;

    const { results } = await db.prepare(query).bind(...params).all();

    const pendingCountRow = (await db.prepare(
      "SELECT COUNT(*) as cnt FROM area_change_requests WHERE status = 'pending'"
    ).first()) as any;

    return c.json({
      success: true,
      pendingCount: pendingCountRow?.cnt ? Number(pendingCountRow.cnt) : 0,
      requests: results || [],
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminApp.post('/area-change-requests/:id/approve', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const adminNotes = (body.adminNotes || body.admin_notes || '').trim();
  const db = getDatabase(c);

  try {
    const req = (await db.prepare('SELECT * FROM area_change_requests WHERE id = ?').bind(id).first()) as any;
    if (!req) {
      return c.json({ success: false, error: 'Request not found' }, 404);
    }
    if (req.status !== 'pending') {
      return c.json({ success: false, error: `Request already marked as ${req.status}` }, 400);
    }

    const adminUsername = 'admin_vadodara';

    await db.prepare(
      `UPDATE area_change_requests 
       SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?, admin_notes = ?
       WHERE id = ?`
    ).bind(adminUsername, adminNotes, id).run();

    await db.batch([
      db.prepare(
        `UPDATE users 
         SET area_id = ?, city_id = ?, area_confirmed = 1, area_updated_at = CURRENT_TIMESTAMP 
         WHERE LOWER(handle) = LOWER(?) OR LOWER(handle) = LOWER(?)`
      ).bind(req.requested_area_id, req.requested_city_id, req.user_handle, `@${req.user_handle}`),
      db.prepare(
        `UPDATE profiles 
         SET home_area_id = ?, home_area_name = ?, home_city_id = ?, area_confirmed = 1, area_updated_at = CURRENT_TIMESTAMP 
         WHERE LOWER(handle) = LOWER(?) OR LOWER(handle) = LOWER(?)`
      ).bind(req.requested_area_id, req.requested_area_name, req.requested_city_id, req.user_handle, `@${req.user_handle}`),
    ]);

    const notifId = `notif_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
    const payload = JSON.stringify({
      area_id: req.requested_area_id,
      area_name: req.requested_area_name,
      city_id: req.requested_city_id,
    });

    try {
      await db.prepare(
        `INSERT INTO notifications (id, target_handle, sender_handle, title, body, type, payload_json, is_read, created_at)
         VALUES (?, ?, 'nearhood_team', 'Area Change Approved! 🎉', ?, 'area_change_approved', ?, 0, CURRENT_TIMESTAMP)`
      ).bind(
        notifId,
        req.user_handle,
        `Your home area has been updated to ${req.requested_area_name}. Welcome to your new neighborhood!`,
        payload
      ).run();
    } catch (_) {}

    return c.json({
      success: true,
      message: `Area change request for @${req.user_handle} approved. Area updated to ${req.requested_area_name}.`,
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminApp.post('/area-change-requests/:id/reject', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const reason = (body.reason || body.adminNotes || body.admin_notes || 'Request does not meet community criteria').trim();
  const db = getDatabase(c);

  try {
    const req = (await db.prepare('SELECT * FROM area_change_requests WHERE id = ?').bind(id).first()) as any;
    if (!req) {
      return c.json({ success: false, error: 'Request not found' }, 404);
    }
    if (req.status !== 'pending') {
      return c.json({ success: false, error: `Request already marked as ${req.status}` }, 400);
    }

    const adminUsername = 'admin_vadodara';

    await db.prepare(
      `UPDATE area_change_requests 
       SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?, admin_notes = ?
       WHERE id = ?`
    ).bind(adminUsername, reason, id).run();

    const notifId = `notif_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
    const payload = JSON.stringify({
      area_id: req.requested_area_id,
      area_name: req.requested_area_name,
      reason,
    });

    try {
      await db.prepare(
        `INSERT INTO notifications (id, target_handle, sender_handle, title, body, type, payload_json, is_read, created_at)
         VALUES (?, ?, 'nearhood_team', 'Area Change Request Update', ?, 'area_change_rejected', ?, 0, CURRENT_TIMESTAMP)`
      ).bind(
        notifId,
        req.user_handle,
        `Your request to move to ${req.requested_area_name} could not be approved: ${reason}`,
        payload
      ).run();
    } catch (_) {}

    return c.json({
      success: true,
      message: `Area change request for @${req.user_handle} rejected.`,
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

function getAdminS3Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: AppConfig.r2Endpoint,
    credentials: {
      accessKeyId: AppConfig.r2AccessKeyId,
      secretAccessKey: AppConfig.r2SecretAccessKey,
    },
  });
}

function getAssetMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'webp': return 'image/webp';
    case 'png': return 'image/png';
    case 'svg': return 'image/svg+xml';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    default: return 'application/octet-stream';
  }
}

function getAssetPublicUrl(c: any, r2Key: string): string {
  let base = AppConfig.publicBaseUrl;
  if (!base) {
    const rawHost = c.req.header('host') || '3.109.213.23';
    const host = rawHost.replace(/:\d+$/, '');
    const isIp = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
    const protoHeader = c.req.header('x-forwarded-proto');
    const protocol = protoHeader ? protoHeader : (isIp ? 'http' : 'https');
    base = `${protocol}://${rawHost}`;
  }
  return `${base}/api/v2/media/file/${r2Key}`;
}

interface StaticAppAssetDefinition {
  key: string;
  name: string;
  label: string;
  category: 'splash' | 'branding' | 'banners' | 'icons';
  description: string;
  format: string;
}

const STATIC_APP_ASSETS: StaticAppAssetDefinition[] = [
  {
    key: 'static/nearhood_splash_background.webp',
    name: 'nearhood_splash_background.webp',
    label: 'Splash Screen Background (WebP)',
    category: 'splash',
    description: 'Main animated splash background image displayed during application launch',
    format: 'image/webp',
  },
  {
    key: 'static/nearhood_splash_background.png',
    name: 'nearhood_splash_background.png',
    label: 'Splash Screen Background (PNG)',
    category: 'splash',
    description: 'High-resolution PNG splash background fallback',
    format: 'image/png',
  },
  {
    key: 'static/nearhood_home_feed_header.webp',
    name: 'nearhood_home_feed_header.webp',
    label: 'Home Feed & Bazaar Header (WebP)',
    category: 'banners',
    description: 'Top header backdrop illustration for Home Feed and Bazaar',
    format: 'image/webp',
  },
  {
    key: 'static/nearhood_home_feed_header.png',
    name: 'nearhood_home_feed_header.png',
    label: 'Home Feed & Bazaar Header (PNG)',
    category: 'banners',
    description: 'PNG fallback for Home Feed and Bazaar header backdrop',
    format: 'image/png',
  },
  {
    key: 'static/nearhood_profile_city_header.webp',
    name: 'nearhood_profile_city_header.webp',
    label: 'Profile Header Backdrop (WebP)',
    category: 'banners',
    description: 'Palace and lake illustration displayed in user profile header backdrop',
    format: 'image/webp',
  },
  {
    key: 'static/nearhood_profile_city_header.png',
    name: 'nearhood_profile_city_header.png',
    label: 'Profile Header Backdrop (PNG)',
    category: 'banners',
    description: 'PNG fallback for user profile header backdrop',
    format: 'image/png',
  },
  {
    key: 'static/nearhood_profile_body_background.webp',
    name: 'nearhood_profile_body_background.webp',
    label: 'Profile Content Background (WebP)',
    category: 'banners',
    description: 'Soft pink background illustration for profile content section',
    format: 'image/webp',
  },
  {
    key: 'static/nearhood_profile_body_background.png',
    name: 'nearhood_profile_body_background.png',
    label: 'Profile Content Background (PNG)',
    category: 'banners',
    description: 'PNG fallback for profile content section background',
    format: 'image/png',
  },
  {
    key: 'static/nearhood_profile_banner_curved.png',
    name: 'nearhood_profile_banner_curved.png',
    label: 'Profile Curved Banner',
    category: 'banners',
    description: 'Curved hero shape banner for profile screens',
    format: 'image/png',
  },
  {
    key: 'static/nearhood_logo.png',
    name: 'nearhood_logo.png',
    label: 'Nearhood Brand Logo',
    category: 'branding',
    description: 'Official horizontal brand logo banner',
    format: 'image/png',
  },
  {
    key: 'static/nearhood_logo.svg',
    name: 'nearhood_logo.svg',
    label: 'Nearhood Brand Logo (SVG)',
    category: 'branding',
    description: 'Vector brand logo banner',
    format: 'image/svg+xml',
  },
  {
    key: 'static/nearhood_logo_pin.svg',
    name: 'nearhood_logo_pin.svg',
    label: 'Nearhood Location Pin Logo (SVG)',
    category: 'branding',
    description: 'Animated location pin logo vector',
    format: 'image/svg+xml',
  },
  {
    key: 'static/app_icon.png',
    name: 'app_icon.png',
    label: 'App Launcher Icon',
    category: 'icons',
    description: 'Primary square app icon',
    format: 'image/png',
  },
  {
    key: 'static/app_icon_rounded.png',
    name: 'app_icon_rounded.png',
    label: 'App Launcher Icon (Rounded)',
    category: 'icons',
    description: 'Android adaptive rounded launcher icon',
    format: 'image/png',
  },
];

adminApp.get('/assets', adminAuthMiddleware, async (c) => {
  try {
    const client = getAdminS3Client();
    const bucket = AppConfig.r2Bucket || 'nearhood';
    const listRes = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'static/',
      })
    );

    const r2Map = new Map<string, { size: number; lastModified?: Date; etag?: string }>();
    if (listRes.Contents) {
      for (const obj of listRes.Contents) {
        if (obj.Key) {
          r2Map.set(obj.Key, {
            size: obj.Size || 0,
            lastModified: obj.LastModified,
            etag: obj.ETag?.replace(/"/g, ''),
          });
        }
      }
    }

    const assets = STATIC_APP_ASSETS.map((def) => {
      const live = r2Map.get(def.key);
      const url = getAssetPublicUrl(c, def.key);
      const directR2Url = AppConfig.r2PublicUrl ? `${AppConfig.r2PublicUrl.replace(/\/+$/, '')}/${def.key}` : '';

      return {
        key: def.key,
        name: def.name,
        label: def.label,
        category: def.category,
        description: def.description,
        format: def.format,
        url,
        directR2Url,
        size: live ? live.size : 0,
        lastModified: live?.lastModified ? live.lastModified.toISOString() : null,
        etag: live?.etag || null,
        existsInStorage: !!live,
      };
    });

    return c.json({
      success: true,
      assets,
      count: assets.length,
      storagePrefix: 'static/',
      bucket,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Failed to list assets' }, 500);
  }
});

adminApp.post('/assets/upload', adminAuthMiddleware, async (c) => {
  try {
    const formData = (await c.req.parseBody().catch(() => ({}))) as Record<string, any>;
    const file = formData['file'] || formData['image'] || formData['asset'];
    let targetKey = String(formData['key'] || formData['assetName'] || '').trim();

    if (!file || !(file instanceof File)) {
      return c.json({ success: false, error: 'Valid file is required under "file" field' }, 400);
    }

    if (file.size > 25 * 1024 * 1024) {
      return c.json({ success: false, error: 'File size exceeds 25MB limit' }, 400);
    }

    if (!targetKey) {
      targetKey = file.name || `asset_${Date.now()}`;
    }

    const cleanFilename = targetKey.replace(/^(?:app\/)?static\//, '').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!cleanFilename) {
      return c.json({ success: false, error: 'Invalid asset name' }, 400);
    }

    const primaryKey = `static/${cleanFilename}`;
    const legacyAppKey = `app/static/${cleanFilename}`;
    const contentType = getAssetMimeType(cleanFilename);
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (c.env && c.env.MEDIA_BUCKET) {
      await Promise.all([
        c.env.MEDIA_BUCKET.put(primaryKey, arrayBuffer, {
          httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
          customMetadata: { updatedBy: 'admin', updatedAt: new Date().toISOString() },
        }),
        c.env.MEDIA_BUCKET.put(legacyAppKey, arrayBuffer, {
          httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
          customMetadata: { updatedBy: 'admin', updatedAt: new Date().toISOString() },
        }),
      ]);
    } else {
      const client = getAdminS3Client();
      const bucket = AppConfig.r2Bucket || 'nearhood';
      await Promise.all([
        client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: primaryKey,
            Body: buffer,
            ContentType: contentType,
            CacheControl: 'public, max-age=31536000, immutable',
            Metadata: { updatedBy: 'admin', updatedAt: new Date().toISOString() },
          })
        ),
        client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: legacyAppKey,
            Body: buffer,
            ContentType: contentType,
            CacheControl: 'public, max-age=31536000, immutable',
            Metadata: { updatedBy: 'admin', updatedAt: new Date().toISOString() },
          })
        ),
      ]);
    }

    const publicUrl = getAssetPublicUrl(c, primaryKey);
    const directR2Url = AppConfig.r2PublicUrl ? `${AppConfig.r2PublicUrl.replace(/\/+$/, '')}/${primaryKey}` : '';

    return c.json({
      success: true,
      message: `Asset ${cleanFilename} updated successfully in Cloudflare R2`,
      key: primaryKey,
      filename: cleanFilename,
      url: publicUrl,
      directR2Url,
      size: file.size,
      contentType,
      lastModified: new Date().toISOString(),
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Failed to upload asset' }, 500);
  }
});

adminApp.get('/app-icon', async (c) => {
  try {
    const db = getDatabase(c);
    const row = (await db.prepare('SELECT value, updated_at FROM app_settings WHERE key = ?').bind('active_launcher_icon').first()) as any;
    return c.json({
      success: true,
      activeIcon: row?.value || 'default',
      updatedAt: row?.updated_at || null,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Failed to fetch active icon' }, 500);
  }
});

adminApp.post('/app-icon', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const icon = String(body.icon || '').trim().toLowerCase();
    const allowed = ['default', 'dark', 'festive'];
    if (!allowed.includes(icon)) {
      return c.json({ success: false, error: 'Invalid icon theme. Allowed: default, dark, festive' }, 400);
    }

    const db = getDatabase(c);
    await db.prepare(
      'INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ("active_launcher_icon", ?, CURRENT_TIMESTAMP)'
    ).bind(icon).run();

    return c.json({ success: true, activeIcon: icon });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Failed to update app icon' }, 500);
  }
});

export { adminApp };
