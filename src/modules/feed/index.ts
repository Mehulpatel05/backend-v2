import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';

const feedApp = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. Get Feed Posts
feedApp.get('/posts', async (c) => {
  const limit = parseInt(c.req.query('limit') || '30');
  const offset = parseInt(c.req.query('offset') || '0');
  const author = c.req.query('author');

  let query = `
    SELECT p.*, pr.display_name, pr.avatar_r2_path
    FROM feed_posts p
    LEFT JOIN profiles pr ON p.author_handle = pr.handle
    WHERE p.status = 'active'
  `;
  const params: any[] = [];

  if (author) {
    query += ' AND p.author_handle = ?';
    params.push(author.startsWith('@') ? author : `@${author}`);
  }

  query += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const db = getDatabase(c);
  const { results } = await db.prepare(query).bind(...params).all();

  const formatted = (results || []).map((row: any) => ({
    ...row,
    mediaUrls: JSON.parse(row.media_urls_json || '[]'),
  }));

  return c.json({
    success: true,
    posts: formatted,
  });
});

// 2. Create Feed Post
feedApp.post('/posts', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));

  const { content, mediaUrls = [], audioUrl = '' } = body;

  if (!content && mediaUrls.length === 0 && !audioUrl) {
    return c.json({ success: false, error: 'Post must contain text, media, or audio' }, 400);
  }

  const postId = `post_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  const mediaJson = JSON.stringify(mediaUrls);
  const db = getDatabase(c);

  await db.prepare(
    `INSERT INTO feed_posts (
      id, author_handle, content, media_urls_json, audio_url
    ) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(postId, user.userHandle, content || '', mediaJson, audioUrl)
    .run();

  return c.json({
    success: true,
    postId,
    message: 'Post created successfully',
  });
});

// 3. Toggle Like on Post
feedApp.post('/posts/:id/like', authMiddleware, async (c) => {
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
      db.prepare('UPDATE feed_posts SET likes_count = MAX(0, likes_count - 1) WHERE id = ?').bind(postId),
    ]);
    return c.json({ success: true, isLiked: false, message: 'Post unliked' });
  } else {
    const likeId = `like_${Date.now()}`;
    await db.batch([
      db.prepare('INSERT INTO feed_likes (id, post_id, user_handle) VALUES (?, ?, ?)').bind(likeId, postId, user.userHandle),
      db.prepare('UPDATE feed_posts SET likes_count = likes_count + 1 WHERE id = ?').bind(postId),
    ]);
    return c.json({ success: true, isLiked: true, message: 'Post liked' });
  }
});

// 4. Get Comments
feedApp.get('/posts/:id/comments', async (c) => {
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
});

// 5. Add Comment
feedApp.post('/posts/:id/comments', authMiddleware, async (c) => {
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
});

// 6. Delete Post
feedApp.delete('/posts/:id', authMiddleware, async (c) => {
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
});

export { feedApp };
