import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { getDatabase } from '../../db/db_context';

const searchApp = new Hono<{ Bindings: Env; Variables: Variables }>();

function sanitizeFtsQuery(raw: string): string {
  return raw
    .replace(/[^\w\s\u0900-\u097F]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => `"${w}"*`)
    .join(' ');
}

searchApp.get('/universal', async (c) => {
  const query = (c.req.query('q') || c.req.query('query') || '').trim();
  const cityId = (c.req.query('city_id') || c.req.query('cityId') || 'GJ-VAD').trim();
  const type = (c.req.query('type') || 'all').trim().toLowerCase();
  const rawLimit = parseInt(c.req.query('limit') || '20', 10);
  const limit = isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 50);

  if (!query || query.length < 2) {
    return c.json({
      success: true,
      query,
      results: { civic_places: [], shops: [], posts: [] },
      attribution: 'Data © OpenStreetMap contributors, licensed under ODbL',
    });
  }

  const db = getDatabase(c);
  const ftsQuery = sanitizeFtsQuery(query);
  const likeQuery = `%${query.toLowerCase()}%`;

  let civicPlaces: any[] = [];
  let shops: any[] = [];
  let posts: any[] = [];

  if (type === 'all' || type === 'places') {
    try {
      if (ftsQuery) {
        const rows = await db.prepare(`
          SELECT p.* FROM civic_places_fts f
          JOIN civic_places p ON p.rowid = f.rowid
          WHERE f MATCH ? AND LOWER(p.city_id) = LOWER(?)
          LIMIT ?
        `).bind(ftsQuery, cityId, limit).all();
        civicPlaces = rows?.results || [];
      }
    } catch (_) {}

    if (civicPlaces.length === 0) {
      try {
        const rows = await db.prepare(`
          SELECT * FROM civic_places
          WHERE LOWER(city_id) = LOWER(?)
            AND (LOWER(name) LIKE ? OR LOWER(category) LIKE ? OR LOWER(sub_category) LIKE ? OR LOWER(address) LIKE ?)
          ORDER BY name ASC
          LIMIT ?
        `).bind(cityId, likeQuery, likeQuery, likeQuery, likeQuery, limit).all();
        civicPlaces = rows?.results || [];
      } catch (_) {}
    }
  }

  if (type === 'all' || type === 'shops') {
    try {
      const rows = await db.prepare(`
        SELECT id, owner_handle, shop_name, category, address, phone, logo_r2_path, banner_r2_path, status
        FROM bazar_shops
        WHERE status = 'active'
          AND (LOWER(shop_name) LIKE ? OR LOWER(category) LIKE ? OR LOWER(address) LIKE ?)
        LIMIT ?
      `).bind(likeQuery, likeQuery, likeQuery, limit).all();
      shops = rows?.results || [];
    } catch (_) {}
  }

  if (type === 'all' || type === 'posts') {
    try {
      const rows = await db.prepare(`
        SELECT p.id, p.author_handle, p.content, p.category, p.area_name, p.created_at, p.likes_count, p.comments_count,
               pr.display_name, pr.avatar_r2_path
        FROM feed_posts p
        LEFT JOIN profiles pr ON (LOWER(p.author_handle) = LOWER(pr.handle) OR LOWER(p.author_handle) = '@' || LOWER(pr.handle))
        WHERE (p.status = 'active' OR p.status IS NULL OR p.status = '')
          AND LOWER(p.content) LIKE ?
        ORDER BY p.created_at DESC
        LIMIT ?
      `).bind(likeQuery, limit).all();
      posts = rows?.results || [];
    } catch (_) {}
  }

  return c.json({
    success: true,
    query,
    results: {
      civic_places: civicPlaces,
      shops,
      posts,
    },
    counts: {
      civic_places: civicPlaces.length,
      shops: shops.length,
      posts: posts.length,
      total: civicPlaces.length + shops.length + posts.length,
    },
    attribution: 'Data © OpenStreetMap contributors, licensed under ODbL',
  });
});

export { searchApp };
