import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { getDatabase } from '../../db/db_context';
import { authMiddleware } from '../../middleware/auth';
import { calculateHaversineDistanceKm } from '../../services/maps';

const civicPlacesApp = new Hono<{ Bindings: Env; Variables: Variables }>();

civicPlacesApp.get('/', async (c) => {
  const cityId = (c.req.query('city_id') || c.req.query('cityId') || 'GJ-VAD').trim();
  const areaId = (c.req.query('area_id') || c.req.query('areaId') || '').trim();
  const category = (c.req.query('category') || '').trim().toLowerCase();
  const rawLimit = parseInt(c.req.query('limit') || '20', 10);
  const limit = isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 100);
  const rawOffset = parseInt(c.req.query('offset') || '0', 10);
  const offset = isNaN(rawOffset) ? 0 : Math.max(rawOffset, 0);

  const latStr = c.req.query('lat');
  const lngStr = c.req.query('lng');
  const userLat = latStr ? Number(latStr) : null;
  const userLng = lngStr ? Number(lngStr) : null;

  const db = getDatabase(c);

  let query = 'SELECT * FROM civic_places WHERE LOWER(city_id) = LOWER(?)';
  const params: any[] = [cityId];

  if (category && category !== 'all') {
    query += ' AND LOWER(category) = LOWER(?)';
    params.push(category);
  }

  if (areaId && areaId.toUpperCase() !== 'ALL') {
    query += ' AND (LOWER(area_id) = LOWER(?) OR LOWER(area_id) = LOWER(?))';
    params.push(areaId, `${cityId}-${areaId}`);
  }

  query += ' ORDER BY name ASC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  try {
    const rows = await db.prepare(query).bind(...params).all();
    let places = (rows?.results || []) as any[];

    if (userLat != null && userLng != null && !isNaN(userLat) && !isNaN(userLng)) {
      places = places.map((p) => {
        const dist = calculateHaversineDistanceKm(userLat, userLng, p.lat, p.lng);
        return {
          ...p,
          distance_km: Math.round(dist * 10) / 10,
        };
      }).sort((a, b) => a.distance_km - b.distance_km);
    }

    return c.json({
      success: true,
      places,
      count: places.length,
      attribution: 'Data © OpenStreetMap contributors, licensed under ODbL',
    });
  } catch (err: any) {
    return c.json({ success: false, error: err?.message || 'Failed to fetch civic places' }, 500);
  }
});

civicPlacesApp.get('/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDatabase(c);

  try {
    const place = await db.prepare('SELECT * FROM civic_places WHERE id = ?').bind(id).first();
    if (!place) {
      return c.json({ success: false, error: 'Civic place not found' }, 404);
    }

    return c.json({
      success: true,
      place,
      attribution: 'Data © OpenStreetMap contributors, licensed under ODbL',
    });
  } catch (err: any) {
    return c.json({ success: false, error: err?.message || 'Database error' }, 500);
  }
});

civicPlacesApp.post('/:id/claim', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = getDatabase(c);
  const cleanHandle = user.userHandle.replace(/^@+/, '').trim();
  const body = await c.req.json().catch(() => ({}));

  const proofNote = String(body.business_proof_note || body.note || '').trim();
  const contactPhone = String(body.contact_phone || body.phone || '').trim();

  if (!proofNote || !contactPhone) {
    return c.json({ success: false, error: 'Proof details and contact phone are required' }, 400);
  }

  try {
    const place = await db.prepare('SELECT * FROM civic_places WHERE id = ?').bind(id).first() as any;
    if (!place) {
      return c.json({ success: false, error: 'Place not found' }, 404);
    }

    if (place.claimed_by_handle) {
      return c.json({ success: false, error: 'This place is already claimed' }, 409);
    }

    const claimId = `claim_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await db.prepare(
      `INSERT INTO place_claim_requests (
        id, place_id, requester_handle, business_proof_note, contact_phone, status
      ) VALUES (?, ?, ?, ?, ?, 'pending')`
    )
      .bind(claimId, id, cleanHandle, proofNote, contactPhone)
      .run();

    return c.json({
      success: true,
      message: 'Claim request submitted for admin review',
      claim_id: claimId,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err?.message || 'Failed to submit claim' }, 500);
  }
});

export { civicPlacesApp };
