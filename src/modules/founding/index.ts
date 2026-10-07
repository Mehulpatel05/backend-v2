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
  const areaId = (c.req.query('area_id') || c.req.query('areaId') || '').trim();
  const db = getDatabase(c);

  if (!userHandle) {
    return c.json({ success: false, error: 'User handle missing' }, 401);
  }

  try {
    // 1. Check if user is already an approved founder in any area or this area
    const founderRow = (await db.prepare(
      'SELECT * FROM area_founders WHERE LOWER(user_id) = ?'
    ).bind(userHandle).first()) as any;

    if (founderRow) {
      return c.json({
        success: true,
        state: 'approved',
        isApproved: true,
        seq: founderRow.seq,
        areaId: founderRow.area_id,
        areaName: getAreaName(founderRow.area_id),
      });
    }

    // 2. Check user's latest founding request
    const requestRow = (await db.prepare(
      'SELECT * FROM founding_requests WHERE LOWER(user_id) = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(userHandle).first()) as any;

    if (requestRow) {
      if (requestRow.status === 'pending') {
        return c.json({
          success: true,
          state: 'pending',
          isPending: true,
          areaId: requestRow.area_id,
          areaName: getAreaName(requestRow.area_id),
          createdAt: requestRow.created_at,
        });
      }

      if (requestRow.status === 'approved') {
        return c.json({
          success: true,
          state: 'approved',
          isApproved: true,
          areaId: requestRow.area_id,
          areaName: getAreaName(requestRow.area_id),
        });
      }

      if (requestRow.status === 'rejected') {
        const reviewedTime = new Date(requestRow.reviewed_at || requestRow.created_at).getTime();
        const diffDays = (Date.now() - reviewedTime) / (1000 * 60 * 60 * 24);
        const canReapply = diffDays >= 7;
        const daysRemaining = Math.max(0, Math.ceil(7 - diffDays));

        return c.json({
          success: true,
          state: 'rejected',
          reason: requestRow.reason || 'Requirements not met',
          canReapply,
          daysRemaining,
          areaId: requestRow.area_id,
          areaName: getAreaName(requestRow.area_id),
        });
      }
    }

    // 3. User has no active/recent request -> Check if user has posted in this area
    let postCount = 0;
    if (areaId) {
      const postRow = (await db.prepare(`
        SELECT COUNT(*) as cnt FROM feed_posts 
        WHERE (LOWER(author_handle) = ? OR LOWER(author_handle) = ?) 
          AND (area_id = ? OR area_name = ?) 
          AND (is_deleted = 0 OR is_deleted IS NULL)
      `).bind(userHandle, `@${userHandle}`, areaId, getAreaName(areaId)).first()) as any;
      postCount = postRow?.cnt || 0;
    } else {
      const postRow = (await db.prepare(`
        SELECT COUNT(*) as cnt FROM feed_posts 
        WHERE (LOWER(author_handle) = ? OR LOWER(author_handle) = ?) 
          AND (is_deleted = 0 OR is_deleted IS NULL)
      `).bind(userHandle, `@${userHandle}`).first()) as any;
      postCount = postRow?.cnt || 0;
    }

    const isAvailable = postCount >= 1;

    return c.json({
      success: true,
      state: isAvailable ? 'available' : 'locked',
      postCount,
      hasPost: isAvailable,
      areaId: areaId || 'GJ-VAD-WAGHODIA',
      areaName: getAreaName(areaId || 'GJ-VAD-WAGHODIA'),
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

foundingApp.post('/request', authMiddleware, async (c) => {
  const user = c.get('user');
  const userHandle = (user?.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const areaId = (body.area_id || body.areaId || '').trim();
  const cityId = (body.city_id || body.cityId || 'GJ-VAD').trim();
  const db = getDatabase(c);

  if (!userHandle) {
    return c.json({ success: false, error: 'User handle missing' }, 401);
  }
  if (!areaId) {
    return c.json({ success: false, error: 'area_id is required' }, 400);
  }

  try {
    // 1. Check if user has at least 1 post in that area
    const postRow = (await db.prepare(`
      SELECT COUNT(*) as cnt FROM feed_posts 
      WHERE (LOWER(author_handle) = ? OR LOWER(author_handle) = ?) 
        AND (area_id = ? OR area_name = ?) 
        AND (is_deleted = 0 OR is_deleted IS NULL)
    `).bind(userHandle, `@${userHandle}`, areaId, getAreaName(areaId)).first()) as any;

    if (!postRow || postRow.cnt < 1) {
      return c.json({
        success: false,
        error: 'You must publish at least 1 post in this area before requesting a Founding Neighbour badge.',
      }, 400);
    }

    // 2. Check if already an approved founder
    const existingFounder = (await db.prepare(
      'SELECT * FROM area_founders WHERE LOWER(user_id) = ?'
    ).bind(userHandle).first()) as any;

    if (existingFounder) {
      return c.json({
        success: false,
        error: 'You are already a Founding Neighbour in ' + getAreaName(existingFounder.area_id),
      }, 400);
    }

    // 3. Check for existing active requests
    const activeReq = (await db.prepare(`
      SELECT * FROM founding_requests 
      WHERE LOWER(user_id) = ? 
      ORDER BY created_at DESC LIMIT 1
    `).bind(userHandle).first()) as any;

    if (activeReq) {
      if (activeReq.status === 'pending') {
        return c.json({ success: false, error: 'You already have a pending request awaiting review.' }, 400);
      }
      if (activeReq.status === 'approved') {
        return c.json({ success: false, error: 'You already have an approved founding request.' }, 400);
      }
      if (activeReq.status === 'rejected') {
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

    // 4. Check if area is already at 100 founders
    const countRow = (await db.prepare(
      'SELECT COUNT(*) as cnt FROM area_founders WHERE area_id = ?'
    ).bind(areaId).first()) as any;

    if (countRow && countRow.cnt >= 100) {
      return c.json({
        success: false,
        error: 'All 100 Founding Neighbour spots for this area are full.',
      }, 400);
    }

    // 5. Create request
    const requestId = `freq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await db.prepare(`
      INSERT INTO founding_requests (id, user_id, area_id, city_id, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
    `).bind(requestId, userHandle, areaId, cityId).run();

    return c.json({
      success: true,
      message: 'Founding Neighbour request submitted successfully! Our team will review it soon.',
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
  const areaId = c.req.param('area_id');
  const status = c.req.query('status') || 'pending';
  const db = getDatabase(c);

  try {
    const { results } = await db.prepare(`
      SELECT 
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
      ORDER BY fr.created_at ASC
    `).bind(areaId, status).all();

    const formatted = [];
    let queueNum = 1;

    for (const row of results || []) {
      const firstPost = (await db.prepare(`
        SELECT content, created_at, image_url FROM feed_posts 
        WHERE (LOWER(author_handle) = ? OR LOWER(author_handle) = ?) 
          AND (area_id = ? OR area_name = ?)
        ORDER BY created_at ASC LIMIT 1
      `).bind(row.user_id.toLowerCase(), `@${row.user_id.toLowerCase()}`, areaId, getAreaName(areaId)).first()) as any;

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
        firstPostPreview: firstPost?.content || 'First community post in area',
        firstPostDate: firstPost?.created_at || '',
      });
    }

    const approvedRow = (await db.prepare(
      'SELECT COUNT(*) as cnt FROM area_founders WHERE area_id = ?'
    ).bind(areaId).first()) as any;

    const approvedCount = approvedRow?.cnt || 0;

    return c.json({
      success: true,
      areaId,
      areaName: getAreaName(areaId),
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
    const { results } = await db.prepare(`
      SELECT 
        af.area_id,
        af.user_id,
        af.seq,
        af.created_at,
        p.display_name,
        p.avatar_r2_path
      FROM area_founders af
      LEFT JOIN profiles p ON (LOWER(p.handle) = LOWER(af.user_id) OR LOWER(p.handle) = '@' || LOWER(af.user_id))
      WHERE af.area_id = ?
      ORDER BY af.seq ASC
    `).bind(areaId).all();

    return c.json({
      success: true,
      areaId,
      areaName: getAreaName(areaId),
      count: (results || []).length,
      founders: (results || []).map((r: any) => ({
        seq: r.seq,
        userId: r.user_id,
        displayName: r.display_name || r.user_id,
        avatarUrl: r.avatar_r2_path || '',
        createdAt: r.created_at,
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

    const areaId = reqRow.area_id;
    const targetUser = reqRow.user_id;

    // 1. Check spots count
    const approvedRow = (await db.prepare(
      'SELECT COUNT(*) as cnt FROM area_founders WHERE area_id = ?'
    ).bind(areaId).first()) as any;

    const currentApproved = approvedRow?.cnt || 0;
    if (currentApproved >= 100) {
      return c.json({ success: false, error: 'All 100 spots for this area are full.' }, 400);
    }

    const nextSeq = currentApproved + 1;
    const areaName = getAreaName(areaId);

    // 2. Insert into area_founders
    await db.prepare(`
      INSERT INTO area_founders (area_id, user_id, seq, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(areaId, targetUser, nextSeq).run();

    // 3. Update founding_requests status
    await db.prepare(`
      UPDATE founding_requests 
      SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? 
      WHERE id = ?
    `).bind(adminHandle, requestId).run();

    // 4. Add/Update founding_neighbour badge in user_badges
    try {
      const badgeKey = 'founding_neighbour';
      const badgeId = `bdg_${badgeKey}_${targetUser}`;
      await db.prepare(`
        INSERT INTO user_badges (id, user_handle, badge_key, earned_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_handle, badge_key) DO UPDATE SET earned_at = CURRENT_TIMESTAMP
      `).bind(badgeId, targetUser, badgeKey).run();
    } catch (_) {}

    // 5. Insert notification
    try {
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await db.prepare(`
        INSERT INTO notifications (id, target_handle, sender_handle, type, title, body, payload_json, is_read, created_at)
        VALUES (?, ?, 'nearhood_team', 'founding_approved', 'Founding Neighbour Approved! 🎉', ?, ?, 0, CURRENT_TIMESTAMP)
      `).bind(
        notifId,
        targetUser,
        `You are now Founding Neighbour #${nextSeq} in ${areaName}`,
        JSON.stringify({ area_id: areaId, seq: nextSeq, area_name: areaName })
      ).run();
    } catch (_) {}

    return c.json({
      success: true,
      message: `User @${targetUser} approved as Founding Neighbour #${nextSeq} in ${areaName}`,
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

  try {
    await db.prepare(
      'DELETE FROM area_founders WHERE LOWER(user_id) = ? AND (area_id = ? OR ? = "")'
    ).bind(targetUser, areaId, areaId).run();

    await db.prepare(`
      UPDATE founding_requests 
      SET status = 'rejected', reason = 'Badge revoked by administrator' 
      WHERE LOWER(user_id) = ? AND (area_id = ? OR ? = "")
    `).bind(targetUser, areaId, areaId).run();

    await db.prepare(
      "DELETE FROM user_badges WHERE LOWER(user_handle) = ? AND badge_key = 'founding_neighbour'"
    ).bind(targetUser).run();

    return c.json({
      success: true,
      message: `Founding Neighbour badge removed for @${targetUser}`,
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});
