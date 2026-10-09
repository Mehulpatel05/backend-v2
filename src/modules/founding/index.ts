import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { adminAuthMiddleware } from '../../middleware/admin_auth';
import { getDatabase } from '../../db/db_context';

export const foundingApp = new Hono<{ Bindings: Env; Variables: Variables }>();
export const adminFoundingApp = new Hono<{ Bindings: Env; Variables: Variables }>();

const CITY_NAMES: Record<string, string> = {
  'GJ-VAD': 'Vadodara',
  'GJ-SRT': 'Surat',
  'GJ-AMD': 'Ahmedabad',
  'MH-MUM': 'Mumbai',
  'MH-PUN': 'Pune',
  'DL-DEL': 'Delhi',
  'KA-BLR': 'Bangalore',
  'TS-HYD': 'Hyderabad',
};

const AREA_NAMES: Record<string, string> = {
  'GJ-VAD-ALKAPURI': 'Alkapuri',
  'GJ-VAD-SAYAJIGUNJ': 'Sayajigunj',
  'GJ-VAD-GOTRI': 'Gotri',
  'GJ-VAD-MANJALPUR': 'Manjalpur',
  'GJ-VAD-KARELIBAUG': 'Karelibaug',
  'GJ-VAD-FATEHGUNJ': 'Fatehgunj',
  'GJ-VAD-SUBHANPURA': 'Subhanpura',
  'GJ-VAD-WAGHODIA': 'Waghodia Road',
  'GJ-VAD-AKOTA': 'Akota',
  'GJ-VAD-VASNA': 'Vasna',
  'GJ-VAD-BHAYLI': 'Bhayli',
  'GJ-VAD-SAMA': 'Sama',
  'GJ-VAD-HARNI': 'Harni',
  'GJ-VAD-MAKARPURA': 'Makarpura',
  'GJ-VAD-TANDALJA': 'Tandalja',
  'GJ-VAD-NIZAMPURA': 'Nizampura',
  'GJ-VAD-CHHANI': 'Chhani',
  'GJ-VAD-DANDIA': 'Dandia Bazaar',
  'GJ-VAD-RAOPURA': 'Raopura',
  'GJ-VAD-OPR': 'Old Padra Road',
  'GJ-VAD-OTHER': 'Other / Not listed',
};

function getAreaName(areaId: string): string {
  return AREA_NAMES[areaId] || areaId.replace(/^[A-Z]+-[A-Z]+-/, '');
}

function getCityName(cityId: string): string {
  return CITY_NAMES[cityId] || cityId;
}

// ── USER ROUTES ─────────────────────────────────────────────────────────────

foundingApp.get('/counts', async (c) => {
  const db = getDatabase(c);
  try {
    const { results } = await db.prepare(
      'SELECT area_id, COUNT(*) as cnt FROM area_founders GROUP BY area_id'
    ).all();

    const counts: Record<string, number> = {};
    for (const row of results || []) {
      if (row.area_id) {
        counts[row.area_id] = Number(row.cnt) || 0;
        if (row.area_id.startsWith('GJ-VAD')) {
          counts['GJ-VAD'] = (counts['GJ-VAD'] || 0) + Number(row.cnt);
        }
      }
    }

    return c.json({ success: true, counts });
  } catch (e: any) {
    return c.json({ success: false, error: e.message, counts: {} }, 500);
  }
});

foundingApp.get('/me', authMiddleware, async (c) => {
  const user = c.get('user');
  const userHandle = (user?.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const cityId = (c.req.query('city_id') || c.req.query('cityId') || 'GJ-VAD').trim();
  const areaId = (c.req.query('area_id') || c.req.query('areaId') || '').trim();
  const db = getDatabase(c);

  if (!userHandle) {
    return c.json({ success: false, error: 'User handle missing' }, 401);
  }

  try {
    const founderRow = (await db.prepare(
      'SELECT * FROM area_founders WHERE LOWER(user_id) = ? OR LOWER(user_id) = ?'
    ).bind(userHandle, `@${userHandle}`).first()) as any;

    if (founderRow) {
      const founderCityId = founderRow.area_id.startsWith('GJ-')
        ? (founderRow.area_id.includes('-') && founderRow.area_id.length > 6 ? founderRow.area_id.substring(0, 6) : founderRow.area_id)
        : cityId;
      return c.json({
        success: true,
        state: 'approved',
        isApproved: true,
        seq: founderRow.seq,
        cityId: founderCityId,
        cityName: getCityName(founderCityId),
        areaId: founderRow.area_id,
        areaName: getAreaName(founderRow.area_id),
      });
    }

    const requestRow = (await db.prepare(
      'SELECT * FROM founding_requests WHERE LOWER(user_id) = ? OR LOWER(user_id) = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(userHandle, `@${userHandle}`).first()) as any;

    if (requestRow) {
      const reqCityId = requestRow.city_id || cityId;
      if (requestRow.status === 'pending') {
        return c.json({
          success: true,
          state: 'pending',
          isPending: true,
          cityId: reqCityId,
          cityName: getCityName(reqCityId),
          areaId: requestRow.area_id,
          areaName: getAreaName(requestRow.area_id),
          createdAt: requestRow.created_at,
        });
      }

      if (requestRow.status === 'approved' && founderRow) {
        return c.json({
          success: true,
          state: 'approved',
          isApproved: true,
          seq: founderRow.seq,
          cityId: reqCityId,
          cityName: getCityName(reqCityId),
          areaId: requestRow.area_id,
          areaName: getAreaName(requestRow.area_id),
        });
      }

      if (requestRow.status === 'rejected' || requestRow.status === 'approved') {
        const reviewedTime = new Date(requestRow.reviewed_at || requestRow.created_at).getTime();
        const diffDays = (Date.now() - reviewedTime) / (1000 * 60 * 60 * 24);
        const canReapply = diffDays >= 7;
        const daysRemaining = Math.max(0, Math.ceil(7 - diffDays));

        return c.json({
          success: true,
          state: 'rejected',
          reason: requestRow.reason || (requestRow.status === 'approved' ? 'Badge revoked by administrator' : 'Requirements not met'),
          canReapply,
          daysRemaining,
          cityId: reqCityId,
          cityName: getCityName(reqCityId),
          areaId: requestRow.area_id,
          areaName: getAreaName(requestRow.area_id),
        });
      }
    }

    const postRow = (await db.prepare(`
      SELECT COUNT(*) as cnt FROM feed_posts 
      WHERE (LOWER(author_handle) = ? OR LOWER(author_handle) = ?) 
        AND status != 'deleted'
    `).bind(userHandle, `@${userHandle}`).first()) as any;
    const postCount = postRow?.cnt || 0;
    const isAvailable = postCount >= 1;

    const cityFounderCount = (await db.prepare(
      "SELECT COUNT(*) as cnt FROM area_founders WHERE area_id = ? OR area_id LIKE ? || '%'"
    ).bind(cityId, cityId).first()) as any;
    const approvedCount = cityFounderCount?.cnt || 0;
    const spotsLeft = Math.max(0, 100 - approvedCount);

    return c.json({
      success: true,
      state: isAvailable ? 'available' : 'locked',
      postCount,
      hasPost: isAvailable,
      cityId,
      cityName: getCityName(cityId),
      areaId: areaId || 'GJ-VAD-WAGHODIA',
      areaName: getAreaName(areaId || 'GJ-VAD-WAGHODIA'),
      approvedCount,
      spotsLeft,
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

foundingApp.post('/request', authMiddleware, async (c) => {
  const user = c.get('user');
  const userHandle = (user?.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const cityId = (body.city_id || body.cityId || 'GJ-VAD').trim();
  const areaId = (body.area_id || body.areaId || '').trim();
  const db = getDatabase(c);

  if (!userHandle) {
    return c.json({ success: false, error: 'User handle missing' }, 401);
  }

  try {
    const postRow = (await db.prepare(`
      SELECT COUNT(*) as cnt FROM feed_posts 
      WHERE (LOWER(author_handle) = ? OR LOWER(author_handle) = ?) 
        AND status != 'deleted'
    `).bind(userHandle, `@${userHandle}`).first()) as any;

    if (!postRow || postRow.cnt < 1) {
      return c.json({
        success: false,
        error: 'You must publish at least 1 post in ' + getCityName(cityId) + ' before requesting a Founding Neighbour badge.',
      }, 400);
    }

    const existingFounder = (await db.prepare(
      'SELECT * FROM area_founders WHERE LOWER(user_id) = ? OR LOWER(user_id) = ?'
    ).bind(userHandle, `@${userHandle}`).first()) as any;

    if (existingFounder) {
      return c.json({
        success: false,
        error: 'You are already a Founding Neighbour in ' + getCityName(cityId),
      }, 400);
    }

    const activeReq = (await db.prepare(`
      SELECT * FROM founding_requests 
      WHERE (LOWER(user_id) = ? OR LOWER(user_id) = ?)
      ORDER BY created_at DESC LIMIT 1
    `).bind(userHandle, `@${userHandle}`).first()) as any;

    if (activeReq) {
      if (activeReq.status === 'pending') {
        return c.json({ success: false, error: 'You already have a pending request awaiting review.' }, 400);
      }
      if (activeReq.status === 'approved' && existingFounder) {
        return c.json({ success: false, error: 'You already have an approved founding request.' }, 400);
      }
      if (activeReq.status === 'rejected' || (activeReq.status === 'approved' && !existingFounder)) {
        const reviewedTime = new Date(activeReq.reviewed_at || activeReq.created_at).getTime();
        const diffDays = (Date.now() - reviewedTime) / (1000 * 60 * 60 * 24);
        if (diffDays < 7) {
          const daysLeft = Math.ceil(7 - diffDays);
          return c.json({
            success: false,
            error: `You can re-apply after 7 days of rejection (${daysLeft} day${daysLeft > 1 ? 's' : ''} left).`,
          }, 400);
        }
      }
    }

    const countRow = (await db.prepare(
      "SELECT COUNT(*) as cnt FROM area_founders WHERE area_id = ? OR area_id LIKE ? || '%'"
    ).bind(cityId, cityId).first()) as any;

    if (countRow && countRow.cnt >= 100) {
      return c.json({
        success: false,
        error: 'All 100 Founding Neighbour spots for ' + getCityName(cityId) + ' are full.',
      }, 400);
    }

    const requestId = `freq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await db.prepare(`
      INSERT INTO founding_requests (id, user_id, area_id, city_id, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
    `).bind(requestId, userHandle, areaId || cityId, cityId).run();

    return c.json({
      success: true,
      message: 'Founding Neighbour request submitted successfully for ' + getCityName(cityId) + '! Our team will review it soon.',
      requestId,
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ── ADMIN ROUTES ────────────────────────────────────────────────────────────

adminFoundingApp.use('/*', adminAuthMiddleware);

adminFoundingApp.get('/cities', async (c) => {
  const db = getDatabase(c);

  try {
    const cities = [
      { id: 'GJ-VAD', name: 'Vadodara' },
      { id: 'MH-MUM', name: 'Mumbai' },
      { id: 'MH-PUN', name: 'Pune' },
      { id: 'DL-DEL', name: 'Delhi' },
      { id: 'KA-BLR', name: 'Bangalore' },
      { id: 'TS-HYD', name: 'Hyderabad' },
    ];

    const results = [];
    for (const city of cities) {
      const pendingRow = (await db.prepare(
        "SELECT COUNT(*) as cnt FROM founding_requests WHERE city_id = ? AND status = 'pending'"
      ).bind(city.id).first()) as any;

      const approvedRow = (await db.prepare(
        "SELECT COUNT(*) as cnt FROM area_founders WHERE area_id LIKE ? || '%'"
      ).bind(city.id).first()) as any;

      results.push({
        cityId: city.id,
        name: city.name,
        pendingCount: pendingRow?.cnt || 0,
        approvedCount: approvedRow?.cnt || 0,
      });
    }

    return c.json({ success: true, cities: results });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminFoundingApp.get('/cities/:city_id/areas', async (c) => {
  const cityId = c.req.param('city_id');
  const db = getDatabase(c);

  try {
    const areasList = Object.entries(AREA_NAMES)
      .filter(([id]) => id.startsWith(cityId))
      .map(([id, name]) => ({ id, name }));

    const results = [];
    for (const area of areasList) {
      const pendingRow = (await db.prepare(
        "SELECT COUNT(*) as cnt FROM founding_requests WHERE area_id = ? AND status = 'pending'"
      ).bind(area.id).first()) as any;

      const approvedRow = (await db.prepare(
        'SELECT COUNT(*) as cnt FROM area_founders WHERE area_id = ?'
      ).bind(area.id).first()) as any;

      results.push({
        areaId: area.id,
        name: area.name,
        pendingCount: pendingRow?.cnt || 0,
        approvedCount: approvedRow?.cnt || 0,
        spotsLeft: Math.max(0, 100 - (approvedRow?.cnt || 0)),
      });
    }

    return c.json({ success: true, areas: results, cityName: getCityName(cityId) });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminFoundingApp.get('/areas/:area_id/requests', async (c) => {
  const areaParam = c.req.param('area_id');
  const status = c.req.query('status') || 'pending';
  const db = getDatabase(c);
  const isCity = areaParam.startsWith('GJ-') && areaParam.length <= 6;
  const isAll = !areaParam || areaParam === 'all' || isCity;
  const cityId = isCity ? areaParam : 'GJ-VAD';

  try {
    const query = isAll
      ? `SELECT 
          fr.id,
          fr.user_id,
          fr.area_id,
          fr.city_id,
          fr.status,
          fr.reason,
          fr.created_at,
          fr.reviewed_at,
          p.display_name,
          p.avatar_r2_path
        FROM founding_requests fr
        LEFT JOIN profiles p ON (LOWER(p.handle) = LOWER(fr.user_id) OR LOWER(p.handle) = '@' || LOWER(fr.user_id))
        WHERE fr.status = ?
        ORDER BY fr.created_at ASC`
      : `SELECT 
          fr.id,
          fr.user_id,
          fr.area_id,
          fr.city_id,
          fr.status,
          fr.reason,
          fr.created_at,
          fr.reviewed_at,
          p.display_name,
          p.avatar_r2_path
        FROM founding_requests fr
        LEFT JOIN profiles p ON (LOWER(p.handle) = LOWER(fr.user_id) OR LOWER(p.handle) = '@' || LOWER(fr.user_id))
        WHERE fr.area_id = ? AND fr.status = ?
        ORDER BY fr.created_at ASC`;

    const { results } = isAll
      ? await db.prepare(query).bind(status).all()
      : await db.prepare(query).bind(areaParam, status).all();

    const formatted = [];
    let queueNum = 1;

    for (const row of results || []) {
      const firstPost = (await db.prepare(`
        SELECT content, created_at, image_url FROM feed_posts 
        WHERE (LOWER(author_handle) = ? OR LOWER(author_handle) = ?) 
          AND status != 'deleted'
        ORDER BY created_at ASC LIMIT 1
      `).bind(row.user_id.toLowerCase(), `@${row.user_id.toLowerCase()}`).first()) as any;

      formatted.push({
        id: row.id,
        queueNumber: queueNum++,
        userId: row.user_id,
        displayName: row.display_name || row.user_id,
        avatarUrl: row.avatar_r2_path || '',
        status: row.status,
        reason: row.reason || '',
        createdAt: row.created_at,
        reviewedAt: row.reviewed_at,
        areaId: row.area_id,
        areaName: getAreaName(row.area_id),
        cityId: row.city_id || cityId,
        cityName: getCityName(row.city_id || cityId),
        firstPostPreview: firstPost?.content || 'First community post',
        firstPostDate: firstPost?.created_at || '',
      });
    }

    const approvedRow = (await db.prepare(
      "SELECT COUNT(*) as cnt FROM area_founders WHERE area_id = ? OR area_id LIKE ? || '%'"
    ).bind(cityId, cityId).first()) as any;

    const approvedCount = approvedRow?.cnt || 0;

    return c.json({
      success: true,
      areaId: areaParam,
      areaName: isAll ? 'All Localities' : getAreaName(areaParam),
      cityId,
      cityName: getCityName(cityId),
      approvedCount,
      spotsLeft: Math.max(0, 100 - approvedCount),
      requests: formatted,
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminFoundingApp.get('/areas/:area_id/founders', async (c) => {
  const areaId = c.req.param('area_id');
  const db = getDatabase(c);

  try {
    const isAll = !areaId || areaId === 'all' || (areaId.startsWith('GJ-') && areaId.length <= 6);
    const query = isAll
      ? `SELECT 
          af.area_id,
          af.user_id,
          af.seq,
          af.created_at,
          p.display_name,
          p.avatar_r2_path
        FROM area_founders af
        LEFT JOIN profiles p ON (LOWER(p.handle) = LOWER(af.user_id) OR LOWER(p.handle) = '@' || LOWER(af.user_id))
        ORDER BY af.seq ASC`
      : `SELECT 
          af.area_id,
          af.user_id,
          af.seq,
          af.created_at,
          p.display_name,
          p.avatar_r2_path
        FROM area_founders af
        LEFT JOIN profiles p ON (LOWER(p.handle) = LOWER(af.user_id) OR LOWER(p.handle) = '@' || LOWER(af.user_id))
        WHERE af.area_id = ?
        ORDER BY af.seq ASC`;

    const { results } = isAll
      ? await db.prepare(query).all()
      : await db.prepare(query).bind(areaId).all();

    return c.json({
      success: true,
      areaId,
      areaName: isAll ? 'Vadodara City' : getAreaName(areaId),
      count: (results || []).length,
      founders: (results || []).map((r: any) => ({
        seq: r.seq,
        userId: r.user_id,
        displayName: r.display_name || r.user_id,
        avatarUrl: r.avatar_r2_path || '',
        createdAt: r.created_at,
        areaId: r.area_id,
        areaName: getAreaName(r.area_id),
      })),
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminFoundingApp.post('/requests/:id/approve', async (c) => {
  const requestId = c.req.param('id');
  const db = getDatabase(c);
  const user = c.get('user');
  const adminHandle = user?.userHandle || 'admin';

  try {
    const reqRow = (await db.prepare(
      "SELECT * FROM founding_requests WHERE id = ? AND status = 'pending'"
    ).bind(requestId).first()) as any;

    if (!reqRow) {
      return c.json({ success: false, error: 'Pending request not found' }, 404);
    }

    const cityId = reqRow.city_id || 'GJ-VAD';
    const cityName = getCityName(cityId);
    const targetUser = reqRow.user_id;

    const approvedRow = (await db.prepare(
      "SELECT COUNT(*) as cnt, COALESCE(MAX(seq), 0) as max_seq FROM area_founders WHERE area_id = ? OR area_id LIKE ? || '%'"
    ).bind(cityId, cityId).first()) as any;

    const currentApproved = approvedRow?.cnt || 0;
    if (currentApproved >= 100) {
      return c.json({ success: false, error: 'All 100 spots for ' + cityName + ' are full.' }, 400);
    }

    const nextSeq = (approvedRow?.max_seq || 0) + 1;

    await db.prepare(`
      INSERT INTO area_founders (area_id, user_id, seq, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(cityId, targetUser, nextSeq).run();

    await db.prepare(`
      UPDATE founding_requests 
      SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? 
      WHERE id = ?
    `).bind(adminHandle, requestId).run();

    try {
      const badgeKey = 'founding_neighbour';
      const badgeId = `bdg_${badgeKey}_${targetUser}`;
      await db.prepare(`
        INSERT INTO user_badges (id, user_handle, badge_key, earned_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_handle, badge_key) DO UPDATE SET earned_at = CURRENT_TIMESTAMP
      `).bind(badgeId, targetUser, badgeKey).run();
    } catch (_) {}

    try {
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await db.prepare(`
        INSERT INTO notifications (id, target_handle, sender_handle, type, title, body, payload_json, is_read, created_at)
        VALUES (?, ?, 'nearhood_team', 'founding_approved', 'Founding Neighbour Approved! 🎉', ?, ?, 0, CURRENT_TIMESTAMP)
      `).bind(
        notifId,
        targetUser,
        `You are now Founding Neighbour #${nextSeq} in ${cityName}`,
        JSON.stringify({ city_id: cityId, seq: nextSeq, city_name: cityName, area_id: reqRow.area_id })
      ).run();
    } catch (_) {}

    return c.json({
      success: true,
      message: `User @${targetUser} approved as Founding Neighbour #${nextSeq} in ${cityName}`,
      seq: nextSeq,
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminFoundingApp.post('/requests/:id/reject', async (c) => {
  const requestId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const reason = (body.reason || '').trim();
  const db = getDatabase(c);
  const user = c.get('user');
  const adminHandle = user?.userHandle || 'admin';

  if (!reason) {
    return c.json({ success: false, error: 'Rejection reason is required' }, 400);
  }

  try {
    const reqRow = (await db.prepare(
      "SELECT * FROM founding_requests WHERE id = ? AND status = 'pending'"
    ).bind(requestId).first()) as any;

    if (!reqRow) {
      return c.json({ success: false, error: 'Pending request not found' }, 404);
    }

    const targetUser = reqRow.user_id;
    const areaName = getAreaName(reqRow.area_id);

    // 1. Update request
    await db.prepare(`
      UPDATE founding_requests 
      SET status = 'rejected', reason = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? 
      WHERE id = ?
    `).bind(reason, adminHandle, requestId).run();

    // 2. Insert notification
    try {
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await db.prepare(`
        INSERT INTO notifications (id, target_handle, sender_handle, type, title, body, payload_json, is_read, created_at)
        VALUES (?, ?, 'nearhood_team', 'founding_rejected', 'Founding Request Update', ?, ?, 0, CURRENT_TIMESTAMP)
      `).bind(
        notifId,
        targetUser,
        `Founding request rejected: ${reason}`,
        JSON.stringify({ area_id: reqRow.area_id, reason, area_name: areaName })
      ).run();
    } catch (_) {}

    return c.json({
      success: true,
      message: `Request for @${targetUser} rejected.`,
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

adminFoundingApp.post('/founders/:user_id/remove', async (c) => {
  const targetUser = c.req.param('user_id').replace(/^@+/, '').trim().toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const areaId = (body.area_id || body.areaId || '').trim();
  const db = getDatabase(c);

  if (!areaId && body.all_areas !== true) {
    return c.json({ success: false, error: 'area_id is required' }, 400);
  }

  try {
    if (areaId && body.all_areas !== true) {
      await db.prepare(
        'DELETE FROM area_founders WHERE (LOWER(user_id) = ? OR LOWER(user_id) = ?) AND area_id = ?'
      ).bind(targetUser, `@${targetUser}`, areaId).run();

      await db.prepare(`
        UPDATE founding_requests 
        SET status = 'rejected', reason = 'Badge revoked by administrator', reviewed_at = CURRENT_TIMESTAMP 
        WHERE (LOWER(user_id) = ? OR LOWER(user_id) = ?) AND area_id = ?
      `).bind(targetUser, `@${targetUser}`, areaId).run();
    } else {
      await db.prepare(
        'DELETE FROM area_founders WHERE LOWER(user_id) = ? OR LOWER(user_id) = ?'
      ).bind(targetUser, `@${targetUser}`).run();

      await db.prepare(`
        UPDATE founding_requests 
        SET status = 'rejected', reason = 'Badge revoked by administrator', reviewed_at = CURRENT_TIMESTAMP 
        WHERE LOWER(user_id) = ? OR LOWER(user_id) = ?
      `).bind(targetUser, `@${targetUser}`).run();
    }

    await db.prepare(
      "DELETE FROM user_badges WHERE (LOWER(user_handle) = ? OR LOWER(user_handle) = ?) AND badge_key = 'founding_neighbour'"
    ).bind(targetUser, `@${targetUser}`).run();

    try {
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await db.prepare(`
        INSERT INTO notifications (id, target_handle, sender_handle, type, title, body, payload_json, is_read, created_at)
        VALUES (?, ?, 'nearhood_team', 'founding_rejected', 'Founding Badge Revoked', 'Your Founding Neighbour badge has been revoked by an administrator.', ?, 0, CURRENT_TIMESTAMP)
      `).bind(
        notifId,
        targetUser,
        JSON.stringify({ reason: 'Badge revoked by administrator' })
      ).run();
    } catch (_) {}

    return c.json({
      success: true,
      message: `Founding Neighbour badge removed for @${targetUser}`,
    });
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || 'Removal failed' }, 500);
  }
});
