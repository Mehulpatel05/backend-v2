import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';

const bazarApp = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. Get Marketplace Listings (Feed)
bazarApp.get('/listings', async (c) => {
  const { category, search, seller, limit = '50', offset = '0' } = c.req.query();

  let query = 'SELECT * FROM bazar_listings WHERE is_active = 1';
  const params: any[] = [];

  if (category && category !== 'All') {
    query += ' AND category = ?';
    params.push(category);
  }
  if (seller) {
    query += ' AND seller_handle = ?';
    params.push(seller.startsWith('@') ? seller : `@${seller}`);
  }
  if (search) {
    query += ' AND (title LIKE ? OR description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const db = getDatabase(c);
  const { results } = await db.prepare(query).bind(...params).all();

  const formatted = (results || []).map((row: any) => ({
    ...row,
    imageUrls: JSON.parse(row.image_urls_json || '[]'),
  }));

  return c.json({
    success: true,
    listings: formatted,
  });
});

// 2. Create Bazar Listing
bazarApp.post('/listings', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));

  const {
    title,
    price,
    originalPrice = '',
    description,
    category = 'General',
    condition = 'Used - Good',
    location = 'Vadodara',
    imageUrls = [],
    shopId = null,
  } = body;

  if (!title || price === undefined || !description) {
    return c.json({ success: false, error: 'Title, price, and description are required' }, 400);
  }

  const id = `item_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  const imagesJson = JSON.stringify(imageUrls);
  const db = getDatabase(c);

  await db.prepare(
    `INSERT INTO bazar_listings (
      id, seller_handle, shop_id, title, price, original_price,
      description, category, condition, location, image_urls_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      user.userHandle,
      shopId,
      title,
      parseInt(price),
      originalPrice.toString(),
      description,
      category,
      condition,
      location,
      imagesJson
    )
    .run();

  return c.json({
    success: true,
    listingId: id,
    message: 'Listing created successfully',
  });
});

// 3. Get Current User's Listings
bazarApp.get('/my-listings', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = getDatabase(c);
  const { results } = await db.prepare(
    'SELECT * FROM bazar_listings WHERE seller_handle = ? ORDER BY created_at DESC'
  )
    .bind(user.userHandle)
    .all();

  const formatted = (results || []).map((row: any) => ({
    ...row,
    imageUrls: JSON.parse(row.image_urls_json || '[]'),
  }));

  return c.json({
    success: true,
    listings: formatted,
  });
});

// 4. Delete Own Listing
bazarApp.delete('/listings/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDatabase(c);

  const res = await db.prepare(
    'DELETE FROM bazar_listings WHERE id = ? AND seller_handle = ?'
  )
    .bind(id, user.userHandle)
    .run();

  if (res.meta?.changes === 0) {
    return c.json({ success: false, error: 'Listing not found or unauthorized' }, 404);
  }

  return c.json({
    success: true,
    message: 'Listing deleted successfully',
  });
});

// 5. Register / Update Shop
bazarApp.post('/shops', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));

  const {
    shopName,
    category = 'Retail',
    address,
    phone,
    bannerR2Path = '',
    logoR2Path = '',
    description = '',
  } = body;

  if (!shopName || !address || !phone) {
    return c.json({ success: false, error: 'Shop name, address, and phone are required' }, 400);
  }

  const shopId = `shop_${user.userHandle.replace('@', '')}`;
  const db = getDatabase(c);

  await db.prepare(
    `INSERT INTO bazar_shops (
      id, owner_handle, shop_name, category, address, phone,
      banner_r2_path, logo_r2_path, description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      shop_name = excluded.shop_name,
      category = excluded.category,
      address = excluded.address,
      phone = excluded.phone,
      banner_r2_path = excluded.banner_r2_path,
      logo_r2_path = excluded.logo_r2_path,
      description = excluded.description`
  )
    .bind(
      shopId,
      user.userHandle,
      shopName,
      category,
      address,
      phone,
      bannerR2Path,
      logoR2Path,
      description
    )
    .run();

  return c.json({
    success: true,
    shopId,
    message: 'Shop registered successfully',
  });
});

// 6. Get Saved Listings for User
bazarApp.get('/saved', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = getDatabase(c);
  const { results } = await db.prepare(
    `SELECT l.* FROM bazar_listings l
     JOIN bazar_saved s ON l.id = s.listing_id
     WHERE s.user_handle = ?
     ORDER BY s.created_at DESC`
  )
    .bind(user.userHandle)
    .all();

  const formatted = (results || []).map((row: any) => ({
    ...row,
    imageUrls: JSON.parse(row.image_urls_json || '[]'),
  }));

  return c.json({
    success: true,
    savedListings: formatted,
  });
});

// 7. Toggle Save / Bookmark
bazarApp.post('/saved/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const listingId = c.req.param('id');
  const db = getDatabase(c);

  const existing = await db.prepare(
    'SELECT id FROM bazar_saved WHERE user_handle = ? AND listing_id = ? LIMIT 1'
  )
    .bind(user.userHandle, listingId)
    .first();

  if (existing) {
    await db.prepare(
      'DELETE FROM bazar_saved WHERE user_handle = ? AND listing_id = ?'
    )
      .bind(user.userHandle, listingId)
      .run();

    return c.json({ success: true, isSaved: false, message: 'Item unsaved' });
  } else {
    const saveId = `save_${Date.now()}`;
    await db.prepare(
      'INSERT INTO bazar_saved (id, user_handle, listing_id) VALUES (?, ?, ?)'
    )
      .bind(saveId, user.userHandle, listingId)
      .run();

    return c.json({ success: true, isSaved: true, message: 'Item saved' });
  }
});

export { bazarApp };
