import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';

const feedApp = new Hono<{ Bindings: Env; Variables: Variables }>();

function formatPostRow(row: any, userVote: number = 0) {
  let mediaUrls: string[] = [];
  try {
    mediaUrls = JSON.parse(row.media_urls_json || '[]');
  } catch (_) {
    mediaUrls = [];
  }

  let reporters: string[] = [];
  try {
    reporters = JSON.parse(row.reporters_json || '[]');
  } catch (_) {
    reporters = [];
  }

  return {
    id: row.id,
    authorHandle: row.author_handle,
    author_handle: row.author_handle,
    content: row.content || '',
    category: row.category || 'general',
    imageUrl: row.image_url || (mediaUrls.length > 0 ? mediaUrls[0] : null),
    image_url: row.image_url || (mediaUrls.length > 0 ? mediaUrls[0] : null),
    mediaUrls: mediaUrls,
    media_urls: mediaUrls,
    upvotes: row.upvotes ?? row.likes_count ?? 0,
    downvotes: row.downvotes ?? 0,
    likes_count: row.likes_count ?? row.upvotes ?? 0,
    commentCount: row.comments_count ?? 0,
    comments_count: row.comments_count ?? 0,
    userVote: userVote,
    reportCount: row.report_count ?? 0,
    reporters: reporters,
    createdAt: row.created_at,
    created_at: row.created_at,
    cityId: row.city_id || '',
    city_id: row.city_id || '',
    areaId: row.area_id || '',
    area_id: row.area_id || '',
    areaName: row.area_name || '',
    area_name: row.area_name || '',
    lat: row.lat,
    lng: row.lng,
    // Category specific attributes
    roomTitle: row.room_title || null,
    roomArea: row.room_area || null,
    roomRent: row.room_rent || null,
    shopTitle: row.shop_title || null,
    shopPrice: row.shop_price || null,
    shopCategory: row.shop_category || null,
    foodTitle: row.food_title || null,
    foodRating: row.food_rating != null ? Number(row.food_rating) : null,
    foodPrice: row.food_price || null,
    eventTitle: row.event_title || null,
    eventDate: row.event_date || null,
    eventLocationText: row.event_location_text || null,
    eventPrice: row.event_price || null,
    jobTitle: row.job_title || null,
    jobCompany: row.job_company || null,
    jobLocation: row.job_location || null,
    jobType: row.job_type || null,
    serviceTitle: row.service_title || null,
    serviceCategoryText: row.service_category_text || null,
    servicePrice: row.service_price || null,
    audioUrl: row.audio_url || '',
    displayName: row.display_name || row.author_handle,
    avatarUrl: row.avatar_r2_path || null,
  };
}

// Handler for getting feed posts
async function handleGetPosts(c: any) {
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');
  const category = c.req.query('category');
  const cityId = c.req.query('cityId') || c.req.query('city_id');
  const author = c.req.query('author');
  const cursor = c.req.query('cursor');

  let query = `
    SELECT p.*, pr.display_name, pr.avatar_r2_path
    FROM feed_posts p
    LEFT JOIN profiles pr ON p.author_handle = pr.handle
    WHERE p.status = 'active'
  `;
  const params: any[] = [];

  if (category && category.toUpperCase() !== 'ALL') {
    query += ' AND LOWER(p.category) = LOWER(?)';
    params.push(category);
  }

  if (cityId) {
    query += ' AND (p.city_id = ? OR p.city_id = "" OR p.city_id IS NULL)';
    params.push(cityId);
  }

  if (author) {
    query += ' AND p.author_handle = ?';
    params.push(author.startsWith('@') ? author : `@${author}`);
  }

  if (cursor) {
    query += ' AND p.created_at < ?';
    params.push(cursor);
  }

  query += ' ORDER BY p.created_at DESC LIMIT ?';
  params.push(limit);

  if (!cursor && offset > 0) {
    query += ' OFFSET ?';
    params.push(offset);
  }

  const db = getDatabase(c);
  const { results } = await db.prepare(query).bind(...params).all();

  const formatted = (results || []).map((row: any) => formatPostRow(row));

  const nextCursor = formatted.length >= limit ? formatted[formatted.length - 1].createdAt : null;

  return c.json({
    success: true,
    posts: formatted,
    nextCursor,
  });
}

// 1. Get Posts (Support GET /, GET /posts)
feedApp.get('/', handleGetPosts);
feedApp.get('/posts', handleGetPosts);

// Handler for creating posts
async function handleCreatePost(c: any) {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));

  const authorHandle = user?.userHandle || body.authorHandle || body.author_handle;
  if (!authorHandle) {
    return c.json({ success: false, error: 'Unauthorized user session' }, 401);
  }

  const content = (body.content || '').trim();
  const category = body.category || 'general';
  const imageUrl = body.imageUrl || body.image_url || '';
  const mediaUrls = Array.isArray(body.mediaUrls) ? body.mediaUrls : body.media_urls || [];
  const cityId = body.cityId || body.city_id || '';
  const areaId = body.areaId || body.area_id || '';
  const areaName = body.areaName || body.area_name || '';
  const lat = body.lat ? Number(body.lat) : null;
  const lng = body.lng ? Number(body.lng) : null;

  if (!content && mediaUrls.length === 0 && !imageUrl) {
    return c.json({ success: false, error: 'Post must contain text or media' }, 400);
  }

  const postId = `post_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  const mediaJson = JSON.stringify(mediaUrls.length > 0 ? mediaUrls : (imageUrl ? [imageUrl] : []));
  const cleanHandle = authorHandle.startsWith('@') ? authorHandle : `@${authorHandle}`;

  const db = getDatabase(c);

  await db.prepare(
    `INSERT INTO feed_posts (
      id, author_handle, content, category, image_url, media_urls_json,
      city_id, area_id, area_name, lat, lng,
      room_title, room_area, room_rent,
      shop_title, shop_price, shop_category,
      food_title, food_rating, food_price,
      event_title, event_date, event_location_text, event_price,
      job_title, job_company, job_location, job_type,
      service_title, service_category_text, service_price
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?
    )`
  )
    .bind(
      postId,
      cleanHandle,
      content,
      category,
      imageUrl,
      mediaJson,
      cityId,
      areaId,
      areaName,
      lat,
      lng,
      body.roomTitle || '',
      body.roomArea || '',
      body.roomRent || '',
      body.shopTitle || '',
      body.shopPrice || '',
      body.shopCategory || '',
      body.foodTitle || '',
      body.foodRating ? Number(body.foodRating) : null,
      body.foodPrice || '',
      body.eventTitle || '',
      body.eventDate || '',
      body.eventLocationText || '',
      body.eventPrice || '',
      body.jobTitle || '',
      body.jobCompany || '',
      body.jobLocation || '',
      body.jobType || '',
      body.serviceTitle || '',
      body.serviceCategoryText || '',
      body.servicePrice || ''
    )
    .run();

  return c.json({
    success: true,
    id: postId,
    postId,
    post: {
      id: postId,
      authorHandle: cleanHandle,
      content,
      category,
      imageUrl,
      mediaUrls,
      cityId,
      areaId,
    },
    message: 'Post created successfully',
  }, 201);
}

// 2. Create Post (Support POST /create, POST /posts, POST /)
feedApp.post('/create', authMiddleware, handleCreatePost);
feedApp.post('/posts', authMiddleware, handleCreatePost);
feedApp.post('/', authMiddleware, handleCreatePost);

// 3. Post Voting (Upvote / Downvote)
async function handlePostVote(c: any) {
  const user = c.get('user');
  const postId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const voteType = Number(body.voteType ?? body.type ?? 1); // 1 = upvote, -1 = downvote, 0 = remove

  const db = getDatabase(c);
  const cleanHandle = user.userHandle;

  const existingVote: any = await db.prepare(
    'SELECT * FROM post_votes WHERE post_id = ? AND user_handle = ?'
  )
    .bind(postId, cleanHandle)
    .first();

  if (voteType === 0) {
    if (existingVote) {
      const prevType = existingVote.vote_type;
      await db.batch([
        db.prepare('DELETE FROM post_votes WHERE post_id = ? AND user_handle = ?').bind(postId, cleanHandle),
        prevType === 1
          ? db.prepare('UPDATE feed_posts SET upvotes = MAX(0, upvotes - 1), likes_count = MAX(0, likes_count - 1) WHERE id = ?').bind(postId)
          : db.prepare('UPDATE feed_posts SET downvotes = MAX(0, downvotes - 1) WHERE id = ?').bind(postId),
      ]);
    }
    return c.json({ success: true, userVote: 0 });
  } else {
    const voteId = `vote_${Date.now()}`;
    if (existingVote) {
      if (existingVote.vote_type === voteType) {
        // Toggle off
        await db.batch([
          db.prepare('DELETE FROM post_votes WHERE post_id = ? AND user_handle = ?').bind(postId, cleanHandle),
          voteType === 1
            ? db.prepare('UPDATE feed_posts SET upvotes = MAX(0, upvotes - 1), likes_count = MAX(0, likes_count - 1) WHERE id = ?').bind(postId)
            : db.prepare('UPDATE feed_posts SET downvotes = MAX(0, downvotes - 1) WHERE id = ?').bind(postId),
        ]);
        return c.json({ success: true, userVote: 0 });
      } else {
        // Flip vote
        await db.batch([
          db.prepare('UPDATE post_votes SET vote_type = ? WHERE post_id = ? AND user_handle = ?').bind(voteType, postId, cleanHandle),
          voteType === 1
            ? db.prepare('UPDATE feed_posts SET upvotes = upvotes + 1, likes_count = likes_count + 1, downvotes = MAX(0, downvotes - 1) WHERE id = ?').bind(postId)
            : db.prepare('UPDATE feed_posts SET downvotes = downvotes + 1, upvotes = MAX(0, upvotes - 1), likes_count = MAX(0, likes_count - 1) WHERE id = ?').bind(postId),
        ]);
        return c.json({ success: true, userVote: voteType });
      }
    } else {
      // New vote
      await db.batch([
        db.prepare('INSERT INTO post_votes (id, post_id, user_handle, vote_type) VALUES (?, ?, ?, ?)').bind(voteId, postId, cleanHandle, voteType),
        voteType === 1
          ? db.prepare('UPDATE feed_posts SET upvotes = upvotes + 1, likes_count = likes_count + 1 WHERE id = ?').bind(postId)
          : db.prepare('UPDATE feed_posts SET downvotes = downvotes + 1 WHERE id = ?').bind(postId),
      ]);
      return c.json({ success: true, userVote: voteType });
    }
  }
}

feedApp.post('/:id/vote', authMiddleware, handlePostVote);
feedApp.post('/posts/:id/vote', authMiddleware, handlePostVote);

// 4. Like Post (Legacy compatibility)
feedApp.post('/:id/like', authMiddleware, async (c) => {
  const user = c.get('user');
  const postId = c.req.param('id');
  const db = getDatabase(c);

  const existing = await db.prepare(
    'SELECT id FROM feed_likes WHERE post_id = ? AND user_handle = ? LIMIT 1'
  )
    .bind(postId, user.userHandle)
    .first();

  if (existing) {
    await db.batch([
      db.prepare('DELETE FROM feed_likes WHERE post_id = ? AND user_handle = ?').bind(postId, user.userHandle),
      db.prepare('UPDATE feed_posts SET likes_count = MAX(0, likes_count - 1), upvotes = MAX(0, upvotes - 1) WHERE id = ?').bind(postId),
    ]);
    return c.json({ success: true, isLiked: false, message: 'Post unliked' });
  } else {
    const likeId = `like_${Date.now()}`;
    await db.batch([
      db.prepare('INSERT INTO feed_likes (id, post_id, user_handle) VALUES (?, ?, ?)').bind(likeId, postId, user.userHandle),
      db.prepare('UPDATE feed_posts SET likes_count = likes_count + 1, upvotes = upvotes + 1 WHERE id = ?').bind(postId),
    ]);
    return c.json({ success: true, isLiked: true, message: 'Post liked' });
  }
});
feedApp.post('/posts/:id/like', authMiddleware, async (c) => {
  return feedApp.fetch(c.req.raw, c.env, c.executionCtx);
});

// 5. Comments
async function handleGetComments(c: any) {
  const postId = c.req.param('id');
  const db = getDatabase(c);
  const { results } = await db.prepare(
    `SELECT c.*, pr.display_name, pr.avatar_r2_path
     FROM feed_comments c
     LEFT JOIN profiles pr ON c.author_handle = pr.handle
     WHERE c.post_id = ?
     ORDER BY c.created_at ASC`
  )
    .bind(postId)
    .all();

  return c.json({
    success: true,
    comments: results || [],
  });
}

feedApp.get('/:id/comments', handleGetComments);
feedApp.get('/posts/:id/comments', handleGetComments);

async function handleAddComment(c: any) {
  const user = c.get('user');
  const postId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const content = (body.content || '').trim();

  if (!content) {
    return c.json({ success: false, error: 'Comment content cannot be empty' }, 400);
  }

  const commentId = `comment_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  const db = getDatabase(c);

  await db.batch([
    db.prepare('INSERT INTO feed_comments (id, post_id, author_handle, content) VALUES (?, ?, ?, ?)').bind(
      commentId,
      postId,
      user.userHandle,
      content
    ),
    db.prepare('UPDATE feed_posts SET comments_count = comments_count + 1 WHERE id = ?').bind(postId),
  ]);

  return c.json({
    success: true,
    commentId,
    message: 'Comment added successfully',
  });
}

feedApp.post('/:id/comments', authMiddleware, handleAddComment);
feedApp.post('/posts/:id/comments', authMiddleware, handleAddComment);

// 6. Delete Post
async function handleDeletePost(c: any) {
  const user = c.get('user');
  const postId = c.req.param('id');
  const db = getDatabase(c);

  const res = await db.prepare(
    'DELETE FROM feed_posts WHERE id = ? AND author_handle = ?'
  )
    .bind(postId, user.userHandle)
    .run();

  if (res.meta?.changes === 0) {
    return c.json({ success: false, error: 'Post not found or unauthorized' }, 404);
  }

  return c.json({
    success: true,
    message: 'Post deleted successfully',
  });
}

feedApp.delete('/:id', authMiddleware, handleDeletePost);
feedApp.delete('/posts/:id', authMiddleware, handleDeletePost);

export { feedApp };
