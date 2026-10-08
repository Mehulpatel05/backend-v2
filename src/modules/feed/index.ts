import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';
import { sendPushNotification } from '../../services/fcm_service';
import { awardPoints } from '../rewards';

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

  const cleanAuthor = (row.author_handle || '').replace(/^@+/, '').trim();
  const isFounder = row.founder_seq != null && row.founder_seq > 0;
  const isVerifiedCitizen = row.is_verified === 1 || (row.bio && row.bio.includes('[Verified]'));
  const isVerified = isFounder || isVerifiedCitizen;
  const authorBadge = isFounder
    ? `FOUNDING #${row.founder_seq}`
    : (isVerifiedCitizen ? 'VERIFIED' : (row.author_badge || null));

  return {
    id: row.id,
    authorHandle: cleanAuthor,
    author_handle: cleanAuthor,
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
    authorName: row.display_name || row.author_handle,
    author_name: row.display_name || row.author_handle,
    avatarUrl: row.avatar_r2_path || null,
    isVerified,
    is_verified: isVerified ? 1 : 0,
    authorBadge,
    author_badge: authorBadge,
    founderSeq: row.founder_seq ?? null,
  };
}

// Handler for getting feed posts
async function handleGetPosts(c: any) {
  const rawLimit = parseInt(c.req.query('limit') || '50', 10);
  const limit = isNaN(rawLimit) ? 50 : Math.min(Math.max(rawLimit, 1), 100);
  const rawOffset = parseInt(c.req.query('offset') || '0', 10);
  const offset = isNaN(rawOffset) ? 0 : Math.max(rawOffset, 0);
  const category = c.req.query('category');
  const cityId = c.req.query('cityId') || c.req.query('city_id');
  const areaId = c.req.query('areaId') || c.req.query('area_id');
  const author = c.req.query('author');
  const cursor = c.req.query('cursor');

  let query = `
    SELECT p.*, pr.display_name, pr.avatar_r2_path, pr.is_verified, pr.bio, af.seq AS founder_seq
    FROM feed_posts p
    LEFT JOIN profiles pr ON (LOWER(p.author_handle) = LOWER(pr.handle) OR LOWER(p.author_handle) = '@' || LOWER(pr.handle) OR '@' || LOWER(p.author_handle) = LOWER(pr.handle))
    LEFT JOIN area_founders af ON (LOWER(af.user_id) = LOWER(p.author_handle) OR LOWER(af.user_id) = LOWER(REPLACE(p.author_handle, '@', '')))
    WHERE (p.status = 'active' OR p.status IS NULL OR p.status = '')
  `;
  const params: any[] = [];

  if (category && category.toUpperCase() !== 'ALL') {
    query += ' AND LOWER(p.category) = LOWER(?)';
    params.push(category);
  }

  if (cityId && cityId.toUpperCase() !== 'ALL') {
    query += ' AND LOWER(p.city_id) = LOWER(?)';
    params.push(cityId);
  }

  if (areaId && areaId.toUpperCase() !== 'ALL') {
    query += ' AND LOWER(p.area_id) = LOWER(?)';
    params.push(areaId);
  }

  if (author) {
    const cleanAuthor = author.replace(/^@+/, '').trim();
    query += ' AND (p.author_handle = ? OR p.author_handle = ?)';
    params.push(cleanAuthor, `@${cleanAuthor}`);
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
  const lat = (body.lat !== undefined && body.lat !== null && body.lat !== '') ? Number(body.lat) : null;
  const lng = (body.lng !== undefined && body.lng !== null && body.lng !== '') ? Number(body.lng) : null;

  if (!content && mediaUrls.length === 0 && !imageUrl) {
    return c.json({ success: false, error: 'Post must contain text or media' }, 400);
  }

  if (content.length > 5000) {
    return c.json({ success: false, error: 'Post content exceeds 5000 characters limit' }, 400);
  }

  const postId = `post_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  const mediaJson = JSON.stringify(mediaUrls.length > 0 ? mediaUrls : (imageUrl ? [imageUrl] : []));
  const cleanHandle = (authorHandle || user.userHandle || '').replace(/^@+/, '').trim();

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

  let pointsAwarded = 0;
  let dailyCapReached = false;
  let newBalance: number | undefined;

  if (content.length >= 20 && category !== 'safety' && category !== 'urgent_safety') {
    try {
      const rewardResult = await awardPoints(db, {
        userHandle: cleanHandle,
        delta: 5,
        reason: 'Created a post in your neighbourhood',
        refType: 'post',
        refId: postId,
        isAction: true,
      });
      pointsAwarded = rewardResult.awardedDelta;
      dailyCapReached = rewardResult.capReached ?? false;
      newBalance = rewardResult.newBalance;

      const pendingRef = await db.prepare("SELECT * FROM referrals WHERE invitee_handle = ? AND status = 'pending'")
        .bind(cleanHandle).first() as any;
      if (pendingRef) {
        await db.prepare("UPDATE referrals SET status = 'rewarded', rewarded_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(pendingRef.id).run();
        await awardPoints(db, {
          userHandle: pendingRef.inviter_handle,
          delta: 25,
          reason: `Friend @${cleanHandle} made their first post`,
          refType: 'invite',
          refId: pendingRef.id,
          isAction: false,
        });
        await awardPoints(db, {
          userHandle: cleanHandle,
          delta: 25,
          reason: 'Created first post after joining via invite',
          refType: 'invite',
          refId: pendingRef.id,
          isAction: false,
        });
      }
    } catch (_) {}
  }

  return c.json({
    success: true,
    id: postId,
    postId,
    pointsAwarded,
    dailyCapReached,
    newBalance,
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

  let voteType = 1;
  if (body.voteType !== undefined) {
    voteType = Number(body.voteType);
  } else if (body.type !== undefined) {
    voteType = Number(body.type);
  } else if (body.direction !== undefined) {
    if (typeof body.direction === 'string') {
      const dir = body.direction.toLowerCase();
      if (dir === 'up' || dir === '1') voteType = 1;
      else if (dir === 'down' || dir === '-1') voteType = -1;
      else if (dir === 'none' || dir === '0' || dir === 'clear') voteType = 0;
      else voteType = Number(body.direction) || 0;
    } else {
      voteType = Number(body.direction);
    }
  }

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
      const delRes = await db.prepare('DELETE FROM post_votes WHERE post_id = ? AND user_handle = ?').bind(postId, cleanHandle).run();
      if (delRes.meta?.changes === 1) {
        if (prevType === 1) {
          await db.prepare('UPDATE feed_posts SET upvotes = MAX(0, upvotes - 1), likes_count = MAX(0, likes_count - 1) WHERE id = ?').bind(postId).run();
        } else {
          await db.prepare('UPDATE feed_posts SET downvotes = MAX(0, downvotes - 1) WHERE id = ?').bind(postId).run();
        }
      }
    }
    return c.json({ success: true, userVote: 0 });
  } else {
    const voteId = `vote_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
    if (existingVote) {
      if (existingVote.vote_type === voteType) {
        // Toggle off
        const delRes = await db.prepare('DELETE FROM post_votes WHERE post_id = ? AND user_handle = ?').bind(postId, cleanHandle).run();
        if (delRes.meta?.changes === 1) {
          if (voteType === 1) {
            await db.prepare('UPDATE feed_posts SET upvotes = MAX(0, upvotes - 1), likes_count = MAX(0, likes_count - 1) WHERE id = ?').bind(postId).run();
          } else {
            await db.prepare('UPDATE feed_posts SET downvotes = MAX(0, downvotes - 1) WHERE id = ?').bind(postId).run();
          }
        }
        return c.json({ success: true, userVote: 0 });
      } else {
        // Flip vote
        const updateRes = await db.prepare('UPDATE post_votes SET vote_type = ? WHERE post_id = ? AND user_handle = ?').bind(voteType, postId, cleanHandle).run();
        if (updateRes.meta?.changes === 1) {
          if (voteType === 1) {
            await db.prepare('UPDATE feed_posts SET upvotes = upvotes + 1, likes_count = likes_count + 1, downvotes = MAX(0, downvotes - 1) WHERE id = ?').bind(postId).run();
          } else {
            await db.prepare('UPDATE feed_posts SET downvotes = downvotes + 1, upvotes = MAX(0, upvotes - 1), likes_count = MAX(0, likes_count - 1) WHERE id = ?').bind(postId).run();
          }
        }
        return c.json({ success: true, userVote: voteType });
      }
    } else {
      // New vote with ON CONFLICT safety
      const insertRes = await db.prepare(
        'INSERT INTO post_votes (id, post_id, user_handle, vote_type) VALUES (?, ?, ?, ?) ON CONFLICT(post_id, user_handle) DO UPDATE SET vote_type = excluded.vote_type'
      ).bind(voteId, postId, cleanHandle, voteType).run();

      if (insertRes.meta?.changes === 1) {
        if (voteType === 1) {
          await db.prepare('UPDATE feed_posts SET upvotes = upvotes + 1, likes_count = likes_count + 1 WHERE id = ?').bind(postId).run();
        } else {
          await db.prepare('UPDATE feed_posts SET downvotes = downvotes + 1 WHERE id = ?').bind(postId).run();
        }
      }

      // Send like notification to post author (only for upvotes, not self-likes)
      if (voteType === 1) {
        try {
          const post = (await db.prepare('SELECT author_handle FROM feed_posts WHERE id = ? LIMIT 1')
            .bind(postId).first()) as any;
          const authorHandle = (post?.author_handle || '').replace(/^@+/, '').trim().toLowerCase();
          const likerHandle = cleanHandle.replace(/^@+/, '').trim().toLowerCase();
          if (authorHandle && authorHandle !== likerHandle) {
            const notifId = `notif_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
            const payload = {
              type: 'post_like',
              postId,
              senderHandle: likerHandle,
              likerHandle,
            };
            await db.prepare(
              `INSERT INTO notifications (id, target_handle, sender_handle, type, title, body, payload_json, is_read, created_at)
               VALUES (?, ?, ?, 'post_like', ?, ?, ?, 0, CURRENT_TIMESTAMP)`
            ).bind(
              notifId,
              authorHandle,
              likerHandle,
              `Nearhood`,
              `@${likerHandle} liked your post 👍`,
              JSON.stringify(payload)
            ).run();

            // FCM push to post author
            sendPushNotification({
              targetHandle: authorHandle,
              title: `Nearhood`,
              body: `@${likerHandle} liked your post 👍`,
              data: payload,
              channelId: 'nearhood_channel',
              db,
            }).catch(() => {});
          }
        } catch (_) {}
      }

      return c.json({ success: true, userVote: voteType });
    }
  }
}

feedApp.post('/:id/vote', authMiddleware, handlePostVote);
feedApp.post('/posts/:id/vote', authMiddleware, handlePostVote);

// 4. Like Post (Legacy compatibility)
// 4. Like Post (Legacy compatibility)
async function handlePostLike(c: any) {
  const user = c.get('user');
  const postId = c.req.param('id');
  const db = getDatabase(c);

  const existing = await db.prepare(
    'SELECT id FROM feed_likes WHERE post_id = ? AND (user_handle = ? OR user_handle = ?) LIMIT 1'
  )
    .bind(postId, user.userHandle, `@${user.userHandle}`)
    .first();

  if (existing) {
    await db.prepare('DELETE FROM feed_likes WHERE post_id = ? AND (user_handle = ? OR user_handle = ?)').bind(postId, user.userHandle, `@${user.userHandle}`).run();
    await db.prepare('UPDATE feed_posts SET likes_count = MAX(0, likes_count - 1), upvotes = MAX(0, upvotes - 1) WHERE id = ?').bind(postId).run();
    return c.json({ success: true, isLiked: false, message: 'Post unliked' });
  } else {
    const likeId = `like_${Date.now()}`;
    await db.prepare('INSERT INTO feed_likes (id, post_id, user_handle) VALUES (?, ?, ?) ON CONFLICT(post_id, user_handle) DO NOTHING').bind(likeId, postId, user.userHandle).run();
    await db.prepare('UPDATE feed_posts SET likes_count = likes_count + 1, upvotes = upvotes + 1 WHERE id = ?').bind(postId).run();

    // Notify post author about the like
    try {
      const post = (await db.prepare('SELECT author_handle FROM feed_posts WHERE id = ? LIMIT 1')
        .bind(postId).first()) as any;
      const authorHandle = (post?.author_handle || '').replace(/^@+/, '').trim().toLowerCase();
      const likerHandle = user.userHandle.replace(/^@+/, '').trim().toLowerCase();
      if (authorHandle && authorHandle !== likerHandle) {
        const notifId = `notif_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
        const payload = { type: 'post_like', postId: postId || '', senderHandle: likerHandle, likerHandle };
        await db.prepare(
          `INSERT INTO notifications (id, target_handle, sender_handle, type, title, body, payload_json, is_read, created_at)
           VALUES (?, ?, ?, 'post_like', ?, ?, ?, 0, CURRENT_TIMESTAMP)`
        ).bind(notifId, authorHandle, likerHandle, `Nearhood`, `@${likerHandle} liked your post 👍`, JSON.stringify(payload)).run();
        sendPushNotification({
          targetHandle: authorHandle,
          title: 'Nearhood',
          body: `@${likerHandle} liked your post 👍`,
          data: payload,
          channelId: 'nearhood_channel',
          db,
        }).catch(() => {});
      }
    } catch (_) {}

    return c.json({ success: true, isLiked: true, message: 'Post liked' });
  }
}

feedApp.post('/:id/like', authMiddleware, handlePostLike);
feedApp.post('/posts/:id/like', authMiddleware, handlePostLike);

// 5. Comments
async function handleGetComments(c: any) {
  const postId = c.req.param('id');
  const db = getDatabase(c);
  const { results } = await db.prepare(
    `SELECT c.*, pr.display_name, pr.avatar_r2_path, pr.is_verified, pr.bio, af.seq AS founder_seq
     FROM feed_comments c
     LEFT JOIN profiles pr ON (LOWER(c.author_handle) = LOWER(pr.handle) OR LOWER(c.author_handle) = '@' || LOWER(pr.handle) OR '@' || LOWER(c.author_handle) = LOWER(pr.handle))
     LEFT JOIN area_founders af ON (LOWER(af.user_id) = LOWER(c.author_handle) OR LOWER(af.user_id) = LOWER(REPLACE(c.author_handle, '@', '')))
     WHERE c.post_id = ?
     ORDER BY c.created_at ASC`
  )
    .bind(postId)
    .all();

  const formatted = (results || []).map((row: any) => {
    const isFounder = row.founder_seq != null && row.founder_seq > 0;
    const isVerifiedCitizen = row.is_verified === 1 || (row.bio && row.bio.includes('[Verified]'));
    const isVerified = isFounder || isVerifiedCitizen;
    const authorBadge = isFounder ? `FOUNDING #${row.founder_seq}` : (isVerifiedCitizen ? 'VERIFIED' : null);
    const cleanAuthor = (row.author_handle || '').replace(/^@+/, '').trim();
    return {
      ...row,
      authorHandle: cleanAuthor,
      author_handle: cleanAuthor,
      displayName: row.display_name || cleanAuthor,
      avatarUrl: row.avatar_r2_path || '',
      isVerified,
      is_verified: isVerified ? 1 : 0,
      authorBadge,
      author_badge: authorBadge,
      founderSeq: row.founder_seq ?? null,
    };
  });

  return c.json({
    success: true,
    comments: formatted,
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

  if (content.length > 1000) {
    return c.json({ success: false, error: 'Comment cannot exceed 1000 characters' }, 400);
  }

  const db = getDatabase(c);
  const post = (await db.prepare('SELECT id, author_handle, status FROM feed_posts WHERE id = ? LIMIT 1').bind(postId).first()) as any;
  if (!post || post.status === 'deleted') {
    return c.json({ success: false, error: 'Post not found or deleted' }, 404);
  }

  const commentId = `comment_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

  await db.batch([
    db.prepare('INSERT INTO feed_comments (id, post_id, author_handle, content) VALUES (?, ?, ?, ?)').bind(
      commentId,
      postId,
      user.userHandle,
      content
    ),
    db.prepare('UPDATE feed_posts SET comments_count = comments_count + 1 WHERE id = ?').bind(postId),
  ]);

  let pointsAwarded = 0;
  let dailyCapReached = false;
  let newBalance: number | undefined;

  if (content.length >= 10) {
    try {
      const post = await db.prepare('SELECT author_handle FROM feed_posts WHERE id = ?').bind(postId).first() as any;
      const cleanAuthor = (post?.author_handle || '').replace(/^@+/, '').trim();
      const cleanUser = (user.userHandle || '').replace(/^@+/, '').trim();

      if (cleanAuthor !== cleanUser) {
        const rewardResult = await awardPoints(db, {
          userHandle: cleanUser,
          delta: 3,
          reason: 'Replied to a neighbour’s post',
          refType: 'reply',
          refId: commentId,
          isAction: true,
        });
        pointsAwarded = rewardResult.awardedDelta;
        dailyCapReached = rewardResult.capReached ?? false;
        newBalance = rewardResult.newBalance;
      }
    } catch (_) {}
  }

  return c.json({
    success: true,
    commentId,
    pointsAwarded,
    dailyCapReached,
    newBalance,
    message: 'Comment added successfully',
  }, 201);
}

feedApp.post('/:id/comments', authMiddleware, handleAddComment);
feedApp.post('/posts/:id/comments', authMiddleware, handleAddComment);
feedApp.post('/:id/comment', authMiddleware, handleAddComment);
feedApp.post('/posts/:id/comment', authMiddleware, handleAddComment);

// 6. Report Post
async function handleReportPost(c: any) {
  const user = c.get('user');
  const postId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const reason = body.reason || 'spam';
  const db = getDatabase(c);

  try {
    const post = (await db.prepare('SELECT status, report_count, reporters_json FROM feed_posts WHERE id = ? LIMIT 1')
      .bind(postId)
      .first()) as any;

    if (!post) {
      return c.json({ success: false, error: 'Post not found' }, 404);
    }

    let reporters: string[] = [];
    try {
      reporters = JSON.parse(post.reporters_json || '[]');
    } catch (_) {}

    const cleanUser = (user.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
    if (reporters.map((r: string) => r.replace(/^@+/, '').trim().toLowerCase()).includes(cleanUser)) {
      return c.json({
        success: true,
        reportCount: post.report_count || 0,
        status: post.status,
        message: 'You have already reported this post',
      });
    }

    reporters.push(cleanUser);
    const newReportCount = (post.report_count || 0) + 1;
    const newStatus = newReportCount >= 5 ? 'flagged' : (post.status || 'active');

    await db.prepare('UPDATE feed_posts SET report_count = ?, reporters_json = ?, status = ? WHERE id = ?')
      .bind(newReportCount, JSON.stringify(reporters), newStatus, postId)
      .run();

    return c.json({
      success: true,
      reportCount: newReportCount,
      status: newStatus,
      message: 'Post reported successfully',
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || 'Failed to report post' }, 500);
  }
}

feedApp.post('/:id/report', authMiddleware, handleReportPost);
feedApp.post('/posts/:id/report', authMiddleware, handleReportPost);

// 7. Restore Post
async function handleRestorePost(c: any) {
  const user = c.get('user');
  const postId = c.req.param('id');
  const db = getDatabase(c);

  const post = (await db.prepare('SELECT author_handle FROM feed_posts WHERE id = ? LIMIT 1')
    .bind(postId)
    .first()) as any;

  if (!post) {
    return c.json({ success: false, error: 'Post not found' }, 404);
  }

  const cleanAuthor = (post.author_handle || '').replace(/^@+/, '').trim().toLowerCase();
  const cleanUser = (user.userHandle || '').replace(/^@+/, '').trim().toLowerCase();

  if (cleanUser !== cleanAuthor) {
    return c.json({ success: false, error: 'Forbidden: You can only restore your own post' }, 403);
  }

  await db.prepare('UPDATE feed_posts SET status = "active", report_count = 0, reporters_json = "[]" WHERE id = ?')
    .bind(postId)
    .run();

  return c.json({
    success: true,
    message: 'Post restored successfully',
  });
}

feedApp.post('/:id/restore', authMiddleware, handleRestorePost);
feedApp.post('/posts/:id/restore', authMiddleware, handleRestorePost);

// 8. Mark Post / Item as Sold
async function handleMarkSold(c: any) {
  const user = c.get('user');
  const postId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const isSold = body.isSold !== false && body.is_sold !== false;
  const db = getDatabase(c);

  const status = isSold ? 'sold' : 'active';
  const res = await db.prepare(
    'UPDATE feed_posts SET status = ? WHERE id = ? AND (author_handle = ? OR author_handle = ?)'
  )
    .bind(status, postId, user.userHandle, `@${user.userHandle}`)
    .run();

  return c.json({
    success: true,
    isSold,
    status,
    message: isSold ? 'Post marked as sold' : 'Post marked as active',
  });
}

feedApp.post('/:id/sold', authMiddleware, handleMarkSold);
feedApp.post('/posts/:id/sold', authMiddleware, handleMarkSold);
feedApp.post('/:id/mark-sold', authMiddleware, handleMarkSold);

// 9. Toggle Recommend Service
async function handleToggleRecommend(c: any) {
  const user = c.get('user');
  const postId = c.req.param('id');
  const db = getDatabase(c);

  const cleanUser = (user.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const existing = await db.prepare(
    'SELECT id FROM feed_likes WHERE post_id = ? AND (LOWER(user_handle) = ? OR LOWER(user_handle) = ?)'
  ).bind(postId, cleanUser, `@${cleanUser}`).first();

  if (existing) {
    await db.prepare('DELETE FROM feed_likes WHERE post_id = ? AND (LOWER(user_handle) = ? OR LOWER(user_handle) = ?)').bind(postId, cleanUser, `@${cleanUser}`).run();
    await db.prepare('UPDATE feed_posts SET upvotes = MAX(0, upvotes - 1), likes_count = MAX(0, likes_count - 1) WHERE id = ?').bind(postId).run();
    return c.json({ success: true, isRecommended: false, message: 'Recommendation removed' });
  } else {
    await db.prepare('INSERT INTO feed_likes (id, post_id, user_handle) VALUES (?, ?, ?) ON CONFLICT(post_id, user_handle) DO NOTHING')
      .bind(`rec_${Date.now()}`, postId, cleanUser).run();
    await db.prepare('UPDATE feed_posts SET upvotes = upvotes + 1, likes_count = likes_count + 1 WHERE id = ?').bind(postId).run();
    return c.json({ success: true, isRecommended: true, message: 'Recommendation added' });
  }
}

feedApp.post('/:id/recommend', authMiddleware, handleToggleRecommend);
feedApp.post('/posts/:id/recommend', authMiddleware, handleToggleRecommend);

// 10. Toggle Event RSVP
async function handleToggleRsvp(c: any) {
  const user = c.get('user');
  const postId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const isRsvped = body.isRsvped !== false;
  const db = getDatabase(c);

  const cleanUser = (user.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const existing = await db.prepare(
    'SELECT id FROM feed_likes WHERE post_id = ? AND (LOWER(user_handle) = ? OR LOWER(user_handle) = ?)'
  ).bind(postId, cleanUser, `@${cleanUser}`).first();

  if (isRsvped) {
    if (!existing) {
      await db.prepare('INSERT INTO feed_likes (id, post_id, user_handle) VALUES (?, ?, ?) ON CONFLICT(post_id, user_handle) DO NOTHING')
        .bind(`rsvp_${Date.now()}`, postId, cleanUser).run();
      await db.prepare('UPDATE feed_posts SET upvotes = upvotes + 1 WHERE id = ?').bind(postId).run();
    }
    return c.json({ success: true, isRsvped: true, message: 'RSVP confirmed' });
  } else {
    if (existing) {
      await db.prepare('DELETE FROM feed_likes WHERE post_id = ? AND (LOWER(user_handle) = ? OR LOWER(user_handle) = ?)').bind(postId, cleanUser, `@${cleanUser}`).run();
      await db.prepare('UPDATE feed_posts SET upvotes = MAX(0, upvotes - 1) WHERE id = ?').bind(postId).run();
    }
    return c.json({ success: true, isRsvped: false, message: 'RSVP cancelled' });
  }
}

feedApp.post('/:id/rsvp', authMiddleware, handleToggleRsvp);
feedApp.post('/posts/:id/rsvp', authMiddleware, handleToggleRsvp);

// 11. Delete Post
async function handleDeletePost(c: any) {
  const user = c.get('user');
  const postId = c.req.param('id');
  const db = getDatabase(c);

  const res = await db.prepare(
    'DELETE FROM feed_posts WHERE id = ? AND (author_handle = ? OR author_handle = ?)'
  )
    .bind(postId, user.userHandle, `@${user.userHandle}`)
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

