import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { getDatabase } from '../../db/db_context';
import { getMapsProvider, calculateHaversineDistanceKm } from '../../services/maps';

const placesApp = new Hono<{ Bindings: Env; Variables: Variables }>();

const autocompleteCache = new Map<string, { timestamp: number; data: any }>();
const CACHE_TTL_MS = 15 * 60 * 1000;

const autocompleteRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const AUTOCOMPLETE_RATE_LIMIT_MAX = 60;
const AUTOCOMPLETE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

const waitlistRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const WAITLIST_RATE_LIMIT_MAX = 5;
const WAITLIST_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

function isAutocompleteRateLimited(clientKey: string): boolean {
  const now = Date.now();
  const entry = autocompleteRateLimitMap.get(clientKey);

  if (!entry || now > entry.resetAt) {
    autocompleteRateLimitMap.set(clientKey, { count: 1, resetAt: now + AUTOCOMPLETE_RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (entry.count >= AUTOCOMPLETE_RATE_LIMIT_MAX) {
    return true;
  }

  entry.count++;
  return false;
}

function isWaitlistRateLimited(clientKey: string): boolean {
  const now = Date.now();
  const entry = waitlistRateLimitMap.get(clientKey);

  if (!entry || now > entry.resetAt) {
    waitlistRateLimitMap.set(clientKey, { count: 1, resetAt: now + WAITLIST_RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (entry.count >= WAITLIST_RATE_LIMIT_MAX) {
    return true;
  }

  entry.count++;
  return false;
}

if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of autocompleteCache.entries()) {
      if (now - v.timestamp > CACHE_TTL_MS) autocompleteCache.delete(k);
    }
    for (const [k, v] of autocompleteRateLimitMap.entries()) {
      if (now > v.resetAt) autocompleteRateLimitMap.delete(k);
    }
    for (const [k, v] of waitlistRateLimitMap.entries()) {
      if (now > v.resetAt) waitlistRateLimitMap.delete(k);
    }
  }, 10 * 60 * 1000).unref?.();
}

function cleanSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();
}

function getClientIp(c: any): string {
  const xRealIp = c.req.header('x-real-ip');
  if (xRealIp && xRealIp.trim().length > 0) {
    return xRealIp.trim();
  }

  const rawReq = c.env?.incoming || (c.req.raw as any);
  const socketIp = rawReq?.socket?.remoteAddress;
  if (socketIp) return socketIp;

  return '127.0.0.1';
}

placesApp.get('/autocomplete', async (c) => {
  const clientIp = getClientIp(c);
  if (isAutocompleteRateLimited(clientIp)) {
    return c.json({ success: false, error: 'Too many requests. Please wait.' }, 429);
  }

  const query = (c.req.query('q') || c.req.query('input') || '').trim();
  const sessionToken = (c.req.query('session') || c.req.query('sessionToken') || '').trim();

  if (query.length < 2) {
    return c.json({ success: true, predictions: [] });
  }

  const cacheKey = `${query.toLowerCase()}`;
  const now = Date.now();
  const cached = autocompleteCache.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return c.json({ success: true, predictions: cached.data });
  }

  const db = getDatabase(c);
  let biasCoords: { lat: number; lng: number } | undefined;

  try {
    const firstEnabledCity = (await db.prepare(
      'SELECT center_lat, center_lng, lat, lng FROM cities WHERE is_enabled = 1 OR is_active = 1 LIMIT 1'
    ).first()) as any;

    if (firstEnabledCity) {
      const lat = Number(firstEnabledCity.center_lat || firstEnabledCity.lat || 22.3072);
      const lng = Number(firstEnabledCity.center_lng || firstEnabledCity.lng || 73.1812);
      if (lat && lng) {
        biasCoords = { lat, lng };
      }
    }
  } catch (_) {}

  const apiKey = c.env?.OLA_MAPS_API_KEY || (typeof process !== 'undefined' ? process.env.OLA_MAPS_API_KEY : '');
  const provider = getMapsProvider(apiKey);
  const predictions = await provider.autocomplete(query, biasCoords, sessionToken);

  autocompleteCache.set(cacheKey, { timestamp: now, data: predictions });

  return c.json({ success: true, predictions });
});

placesApp.get('/reverse-geocode', async (c) => {
  const latStr = c.req.query('lat') || '';
  const lngStr = c.req.query('lng') || '';

  const lat = Number(latStr);
  const lng = Number(lngStr);

  if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
    return c.json({ success: false, error: 'Valid latitude and longitude are required.' }, 400);
  }

  const apiKey = c.env?.OLA_MAPS_API_KEY || (typeof process !== 'undefined' ? process.env.OLA_MAPS_API_KEY : '');
  const provider = getMapsProvider(apiKey);
  const reverseResult = await provider.reverseGeocode(lat, lng);

  if (!reverseResult) {
    return c.json({ success: false, error: 'Could not reverse geocode coordinates.' }, 404);
  }

  const db = getDatabase(c);
  let enabledCities: any[] = [];
  try {
    const rows = await db.prepare(
      'SELECT id, name, state, country, center_lat, center_lng, radius_km, lat, lng FROM cities WHERE is_enabled = 1 OR is_active = 1'
    ).all();
    enabledCities = rows?.results || [];
  } catch (_) {}

  let matchedCity: any = null;
  for (const city of enabledCities) {
    const cityLat = Number(city.center_lat || city.lat || 0);
    const cityLng = Number(city.center_lng || city.lng || 0);
    const radius = Number(city.radius_km || 30);

    if (cityLat && cityLng) {
      const distance = calculateHaversineDistanceKm(lat, lng, cityLat, cityLng);
      if (distance <= radius) {
        matchedCity = city;
        break;
      }
    }
  }

  if (matchedCity) {
    const areaName = reverseResult.name.trim();
    const slug = cleanSlug(areaName) || 'AREA';
    const areaId = `${matchedCity.id}-${slug}`;

    try {
      await db.prepare(
        `INSERT INTO areas (id, city_id, name, place_id, lat, lng, created_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(place_id) DO UPDATE SET
           name = excluded.name,
           lat = excluded.lat,
           lng = excluded.lng`
      ).bind(areaId, matchedCity.id, areaName, reverseResult.placeId, lat, lng).run();

      const saved = (await db.prepare('SELECT * FROM areas WHERE place_id = ?').bind(reverseResult.placeId).first()) as any;

      return c.json({
        success: true,
        live: true,
        area: {
          id: saved?.id || areaId,
          name: saved?.name || areaName,
          city_id: matchedCity.id,
          cityId: matchedCity.id,
          lat,
          lng,
        },
        city: {
          id: matchedCity.id,
          name: matchedCity.name,
          state: matchedCity.state || 'GJ',
        },
      });
    } catch (e: any) {
      return c.json({
        success: true,
        live: true,
        area: {
          id: areaId,
          name: areaName,
          city_id: matchedCity.id,
          cityId: matchedCity.id,
          lat,
          lng,
        },
        city: {
          id: matchedCity.id,
          name: matchedCity.name,
          state: matchedCity.state || 'GJ',
        },
      });
    }
  }

  return c.json({
    success: true,
    live: false,
    detected_city: reverseResult.city || 'Your City',
    lat,
    lng,
    formatted_address: reverseResult.formattedAddress,
  });
});

placesApp.post('/resolve', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  let placeId = (body.place_id || body.placeId || '').trim();
  const name = (body.name || body.area_name || body.areaName || '').trim();
  const cityId = (body.city_id || body.cityId || '').trim();
  const sessionToken = (body.session || body.sessionToken || '').trim();

  if (!placeId && !name) {
    return c.json({ success: false, error: 'place_id or area name is required.' }, 400);
  }

  const db = getDatabase(c);

  if (placeId) {
    const existingArea = (await db.prepare('SELECT * FROM areas WHERE place_id = ?').bind(placeId).first()) as any;
    if (existingArea) {
      const cityRow = (await db.prepare('SELECT id, name, state, is_enabled, is_active FROM cities WHERE id = ?').bind(existingArea.city_id).first()) as any;
      const isLive = cityRow && (cityRow.is_enabled === 1 || cityRow.is_active === 1);
      if (isLive) {
        return c.json({
          success: true,
          live: true,
          area: {
            id: existingArea.id,
            name: existingArea.name,
            city_id: existingArea.city_id,
            cityId: existingArea.city_id,
            lat: existingArea.lat,
            lng: existingArea.lng,
          },
          city: {
            id: cityRow.id,
            name: cityRow.name,
            state: cityRow.state || 'GJ',
          },
        });
      }
    }
  }

  if (!placeId && name) {
    let matchedArea: any = null;
    let matchedCity: any = null;

    if (cityId) {
      matchedArea = (await db.prepare('SELECT * FROM areas WHERE city_id = ? AND LOWER(name) = LOWER(?)').bind(cityId, name).first()) as any;
      if (!matchedArea) {
        matchedArea = (await db.prepare('SELECT * FROM city_areas WHERE city_id = ? AND LOWER(name) = LOWER(?)').bind(cityId, name).first()) as any;
      }
      matchedCity = (await db.prepare('SELECT id, name, state, is_enabled, is_active FROM cities WHERE id = ?').bind(cityId).first()) as any;
    } else {
      matchedArea = (await db.prepare('SELECT * FROM areas WHERE LOWER(name) = LOWER(?) LIMIT 1').bind(name).first()) as any;
      if (!matchedArea) {
        matchedArea = (await db.prepare('SELECT * FROM city_areas WHERE LOWER(name) = LOWER(?) LIMIT 1').bind(name).first()) as any;
      }
      if (matchedArea) {
        matchedCity = (await db.prepare('SELECT id, name, state, is_enabled, is_active FROM cities WHERE id = ?').bind(matchedArea.city_id).first()) as any;
      }
    }

    if (matchedArea && matchedCity) {
      const isLive = matchedCity.is_enabled === 1 || matchedCity.is_active === 1;
      if (isLive) {
        return c.json({
          success: true,
          live: true,
          area: {
            id: matchedArea.id,
            name: matchedArea.name,
            city_id: matchedCity.id,
            cityId: matchedCity.id,
            lat: matchedArea.lat,
            lng: matchedArea.lng,
          },
          city: {
            id: matchedCity.id,
            name: matchedCity.name,
            state: matchedCity.state || 'GJ',
          },
        });
      } else {
        return c.json({
          success: true,
          live: false,
          detected_city: matchedCity.name,
          lat: matchedArea.lat,
          lng: matchedArea.lng,
        });
      }
    }

    return c.json({ success: false, error: 'Area not found. Please choose from search suggestions.' }, 404);
  }

  if (!placeId) {
    return c.json({ success: false, error: 'place_id is required.' }, 400);
  }

  const apiKey = c.env?.OLA_MAPS_API_KEY || (typeof process !== 'undefined' ? process.env.OLA_MAPS_API_KEY : '');
  const provider = getMapsProvider(apiKey);

  const details = await provider.getPlaceDetails(placeId, sessionToken);

  if (!details || (!details.lat && !details.lng)) {
    return c.json({ success: false, error: 'Place details could not be retrieved.' }, 404);
  }

  let enabledCities: any[] = [];
  try {
    const rows = await db.prepare(
      'SELECT id, name, state, country, center_lat, center_lng, radius_km, lat, lng FROM cities WHERE is_enabled = 1 OR is_active = 1'
    ).all();
    enabledCities = rows?.results || [];
  } catch (_) {}

  let matchedCity: any = null;
  for (const city of enabledCities) {
    const cityLat = Number(city.center_lat || city.lat || 0);
    const cityLng = Number(city.center_lng || city.lng || 0);
    const radius = Number(city.radius_km || 30);

    if (cityLat && cityLng) {
      const distance = calculateHaversineDistanceKm(details.lat, details.lng, cityLat, cityLng);
      if (distance <= radius) {
        matchedCity = city;
        break;
      }
    }
  }

  if (matchedCity) {
    const areaName = (name && name.length > 0 ? name : details.name).trim();
    const slug = cleanSlug(areaName) || 'AREA';
    const areaId = `${matchedCity.id}-${slug}`;

    try {
      await db.prepare(
        `INSERT INTO areas (id, city_id, name, place_id, lat, lng, created_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(place_id) DO UPDATE SET
           name = excluded.name,
           lat = excluded.lat,
           lng = excluded.lng`
      ).bind(areaId, matchedCity.id, areaName, placeId, details.lat, details.lng).run();

      const saved = (await db.prepare('SELECT * FROM areas WHERE place_id = ?').bind(placeId).first()) as any;

      return c.json({
        success: true,
        live: true,
        area: {
          id: saved?.id || areaId,
          name: saved?.name || areaName,
          city_id: matchedCity.id,
          cityId: matchedCity.id,
          lat: details.lat,
          lng: details.lng,
        },
        city: {
          id: matchedCity.id,
          name: matchedCity.name,
          state: matchedCity.state || 'GJ',
        },
      });
    } catch (_) {
      return c.json({
        success: true,
        live: true,
        area: {
          id: areaId,
          name: areaName,
          city_id: matchedCity.id,
          cityId: matchedCity.id,
          lat: details.lat,
          lng: details.lng,
        },
        city: {
          id: matchedCity.id,
          name: matchedCity.name,
          state: matchedCity.state || 'GJ',
        },
      });
    }
  }

  return c.json({
    success: true,
    live: false,
    detected_city: details.city || 'Your City',
    lat: details.lat,
    lng: details.lng,
    formatted_address: details.formattedAddress,
  });
});

export const handleWaitlist = async (c: any) => {
  const clientIp = getClientIp(c);
  const body = await c.req.json().catch(() => ({}));
  const cityText = (body.city_text || body.cityText || body.city || '').trim();
  const contactOrDeviceId = (body.contact_or_device_id || body.deviceId || body.phone || body.contact || '').trim();
  const lat = body.lat != null ? Number(body.lat) : null;
  const lng = body.lng != null ? Number(body.lng) : null;

  if (!cityText || !contactOrDeviceId) {
    return c.json({ success: false, error: 'City and contact/device identifier are required.' }, 400);
  }

  const clientKey = `${clientIp}_${contactOrDeviceId}`;
  if (isWaitlistRateLimited(clientKey)) {
    return c.json({ success: false, error: 'Too many waitlist requests. Please try again later.' }, 429);
  }

  const id = `wl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const db = getDatabase(c);

  try {
    await db.prepare(
      `INSERT INTO waitlist (id, city_text, lat, lng, contact_or_device_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
       ON CONFLICT(contact_or_device_id, city_text) DO UPDATE SET
         lat = excluded.lat,
         lng = excluded.lng,
         created_at = CURRENT_TIMESTAMP`
    ).bind(id, cityText, lat, lng, contactOrDeviceId).run();

    return c.json({ success: true, message: 'Added to waitlist successfully.' });
  } catch (err: any) {
    return c.json({ success: false, error: err?.message || 'Failed to save waitlist entry.' }, 500);
  }
};

placesApp.post('/waitlist', handleWaitlist);

placesApp.get('/popular', async (c) => {
  const cityId = (c.req.query('city_id') || c.req.query('cityId') || 'GJ-VAD').trim();
  const db = getDatabase(c);

  try {
    const popularRows = (await db.prepare(`
      SELECT a.id, a.name, a.city_id, a.lat, a.lng, COUNT(u.id) as user_count
      FROM areas a
      LEFT JOIN users u ON (u.area_id = a.id)
      WHERE a.city_id = ?
      GROUP BY a.id, a.name, a.city_id, a.lat, a.lng
      ORDER BY user_count DESC, a.name ASC
      LIMIT 6
    `).bind(cityId).all()) as any;

    const list = popularRows?.results || [];

    if (list.length < 6) {
      const remainingRows = (await db.prepare(`
        SELECT id, name, city_id, lat, lng, 0 as user_count
        FROM areas
        WHERE city_id = ? AND id NOT IN (${list.map(() => '?').join(',') || "''"})
        ORDER BY name ASC
        LIMIT ?
      `).bind(cityId, ...list.map((r: any) => r.id), 6 - list.length).all()) as any;

      if (remainingRows?.results?.length) {
        list.push(...remainingRows.results);
      }
    }

    return c.json({ success: true, areas: list });
  } catch (e: any) {
    return c.json({ success: true, areas: [] });
  }
});

export { placesApp };
