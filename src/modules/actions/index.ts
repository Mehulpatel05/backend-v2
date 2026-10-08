import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware, hashToken } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';

const actionsApp = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. Get Current User Action States (Liked, Saved, Reported, Voted)
actionsApp.get('/state/current', authMiddleware, async (c) => {
  const user = c.get('user');
  const handle = user.userHandle;
  const db = getDatabase(c);

  try {
    const [likesRes, savedRes, votesRes, blocksRes] = await Promise.all([
      db.prepare('SELECT post_id FROM feed_likes WHERE user_handle = ? OR user_handle = ?').bind(handle, `@${handle}`).all(),
      db.prepare('SELECT listing_id FROM bazar_saved WHERE user_handle = ? OR user_handle = ?').bind(handle, `@${handle}`).all(),
      db.prepare('SELECT post_id, vote_type FROM post_votes WHERE user_handle = ? OR user_handle = ?').bind(handle, `@${handle}`).all(),
      db.prepare('SELECT blocked_handle FROM user_blocks WHERE blocker_handle = ? OR blocker_handle = ?').bind(handle, `@${handle}`).all(),
    ]);

    const likedIds = (likesRes.results || []).map((r: any) => r.post_id);
    const savedIds = (savedRes.results || []).map((r: any) => r.listing_id);
    const blockedHandles = (blocksRes.results || []).map((r: any) => r.blocked_handle);
    const votedPostIds: Record<string, number> = {};
    (votesRes.results || []).forEach((r: any) => {
      votedPostIds[r.post_id] = r.vote_type;
    });

    return c.json({
      success: true,
      likedIds,
      savedIds,
      reportedIds: [],
      blockedHandles,
      votedPostIds,
    });
  } catch (e: any) {
    return c.json({
      success: true,
      likedIds: [],
      savedIds: [],
      reportedIds: [],
      blockedHandles: [],
      votedPostIds: {},
    });
  }
});

// 2. Update Action State
actionsApp.post('/states', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const targetId = body.target_id || body.targetId;
  const isLiked = body.is_liked ?? body.isLiked;
  const isSaved = body.is_saved ?? body.isSaved;
  const voteType = body.vote_type ?? body.voteType;
  const db = getDatabase(c);

  if (!targetId) {
    return c.json({ success: false, error: 'target_id is required' }, 400);
  }

  try {
    if (isLiked !== undefined) {
      if (isLiked) {
        const res = await db.prepare('INSERT INTO feed_likes (id, post_id, user_handle) VALUES (?, ?, ?) ON CONFLICT(post_id, user_handle) DO NOTHING')
          .bind(`like_${Date.now()}`, targetId, user.userHandle)
          .run();
        if (res.meta?.changes && res.meta.changes > 0) {
          await db.prepare('UPDATE feed_posts SET likes_count = likes_count + 1 WHERE id = ?').bind(targetId).run().catch(() => {});
        }
      } else {
        const res = await db.prepare('DELETE FROM feed_likes WHERE post_id = ? AND (user_handle = ? OR user_handle = ?)')
          .bind(targetId, user.userHandle, `@${user.userHandle}`)
          .run();
        if (res.meta?.changes && res.meta.changes > 0) {
          await db.prepare('UPDATE feed_posts SET likes_count = MAX(0, likes_count - 1) WHERE id = ?').bind(targetId).run().catch(() => {});
        }
      }
    }

    if (isSaved !== undefined) {
      if (isSaved) {
        await db.prepare('INSERT INTO bazar_saved (id, listing_id, user_handle) VALUES (?, ?, ?) ON CONFLICT(listing_id, user_handle) DO NOTHING')
          .bind(`save_${Date.now()}`, targetId, user.userHandle)
          .run();
      } else {
        await db.prepare('DELETE FROM bazar_saved WHERE listing_id = ? AND (user_handle = ? OR user_handle = ?)')
          .bind(targetId, user.userHandle, `@${user.userHandle}`)
          .run();
      }
    }

    if (voteType !== undefined) {
      if (voteType === 0) {
        await db.prepare('DELETE FROM post_votes WHERE post_id = ? AND (user_handle = ? OR user_handle = ?)')
          .bind(targetId, user.userHandle, `@${user.userHandle}`)
          .run();
      } else {
        await db.prepare('INSERT INTO post_votes (id, post_id, user_handle, vote_type) VALUES (?, ?, ?, ?) ON CONFLICT(post_id, user_handle) DO UPDATE SET vote_type = excluded.vote_type')
          .bind(`vote_${Date.now()}`, targetId, user.userHandle, Number(voteType))
          .run();
      }
    }

    return c.json({ success: true, message: 'Action state updated' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 3. Batch Action States
actionsApp.post('/states/batch', authMiddleware, async (c) => {
  return c.json({ success: true, states: {} });
});

// 4. Counters
actionsApp.get('/counters', async (c) => {
  const authHeader = c.req.header('Authorization');
  let unreadNotifications = 0;
  let unreadChats = 0;
  let pendingFriends = 0;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.replace('Bearer ', '').trim();
      const tokenHash = await hashToken(token);
      const db = getDatabase(c);
      const dev = (await db.prepare('SELECT user_handle FROM devices WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1').bind(tokenHash).first()) as any;
      if (dev?.user_handle) {
        const h = dev.user_handle.replace(/^@+/, '').trim().toLowerCase();
        const notifRow = (await db.prepare('SELECT COUNT(*) as cnt FROM notifications WHERE (LOWER(target_handle) = ? OR LOWER(target_handle) = ?) AND is_read = 0').bind(h, `@${h}`).first()) as any;
        unreadNotifications = notifRow?.cnt || 0;

        const chatRow = (await db.prepare('SELECT SUM(CASE WHEN LOWER(user1_handle) = ? THEN unread_count_user1 ELSE unread_count_user2 END) as cnt FROM chats WHERE LOWER(user1_handle) = ? OR LOWER(user2_handle) = ?').bind(h, h, h).first()) as any;
        unreadChats = chatRow?.cnt || 0;

        const reqRow = (await db.prepare('SELECT COUNT(*) as cnt FROM friend_requests WHERE (LOWER(receiver_handle) = ? OR LOWER(receiver_handle) = ?) AND status = "pending"').bind(h, `@${h}`).first()) as any;
        pendingFriends = reqRow?.cnt || 0;
      }
    } catch (_) {}
  }

  return c.json({
    success: true,
    counters: {
      unreadNotifications,
      unreadChats,
      pendingFriends,
    },
    unreadNotifications,
    unreadChats,
    pendingFriends,
  });
});

export { actionsApp };
