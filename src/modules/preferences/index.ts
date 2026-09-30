import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';

const preferencesApp = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. Get Preferences
preferencesApp.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = getDatabase(c);

  try {
    const row = (await db.prepare('SELECT * FROM user_preferences WHERE user_handle = ? OR user_handle = ? LIMIT 1')
      .bind(user.userHandle, `@${user.userHandle}`)
      .first()) as any;

    if (!row) {
      return c.json({
        success: true,
        preferences: {
          callPrivacy: 'everyone',
          pinnedChats: [],
          mutedChats: [],
          theme: 'dark',
        },
      });
    }

    let pinned: string[] = [];
    let muted: string[] = [];
    try { pinned = JSON.parse(row.pinned_chats_json || '[]'); } catch (_) {}
    try { muted = JSON.parse(row.muted_chats_json || '[]'); } catch (_) {}

    return c.json({
      success: true,
      preferences: {
        callPrivacy: row.call_privacy || 'everyone',
        pinnedChats: pinned,
        mutedChats: muted,
        theme: row.theme || 'dark',
      },
    });
  } catch (e: any) {
    return c.json({
      success: true,
      preferences: {
        callPrivacy: 'everyone',
        pinnedChats: [],
        mutedChats: [],
        theme: 'dark',
      },
    });
  }
});

// 1.1 Get Preferences for Specific Handle
preferencesApp.get('/:handle', async (c) => {
  const handle = (c.req.param('handle') || '').replace(/^@+/, '').trim();
  const db = getDatabase(c);

  try {
    const row = (await db.prepare('SELECT call_privacy FROM user_preferences WHERE user_handle = ? OR user_handle = ? LIMIT 1')
      .bind(handle, `@${handle}`)
      .first()) as any;

    return c.json({
      success: true,
      callPrivacy: row?.call_privacy || 'everyone',
      call_privacy: row?.call_privacy || 'everyone',
    });
  } catch (_) {
    return c.json({
      success: true,
      callPrivacy: 'everyone',
      call_privacy: 'everyone',
    });
  }
});

// 2. Save Preferences
preferencesApp.post('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const callPrivacy = body.callPrivacy || body.call_privacy || 'everyone';
  const pinnedChats = body.pinnedChats || body.pinned_chats || [];
  const mutedChats = body.mutedChats || body.muted_chats || [];
  const theme = body.theme || 'dark';
  const db = getDatabase(c);

  try {
    await db.prepare(
      `INSERT INTO user_preferences (user_handle, call_privacy, pinned_chats_json, muted_chats_json, theme, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_handle) DO UPDATE SET
         call_privacy = excluded.call_privacy,
         pinned_chats_json = excluded.pinned_chats_json,
         muted_chats_json = excluded.muted_chats_json,
         theme = excluded.theme,
         updated_at = CURRENT_TIMESTAMP`
    )
      .bind(user.userHandle, callPrivacy, JSON.stringify(pinnedChats), JSON.stringify(mutedChats), theme)
      .run();

    return c.json({ success: true, message: 'Preferences saved successfully' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 3. Pin / Unpin Chat
preferencesApp.post('/pin', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const chatId = body.chatId || body.chat_id;
  const isPinned = body.isPinned ?? body.is_pinned ?? true;
  const db = getDatabase(c);

  if (!chatId) return c.json({ success: false, error: 'chatId required' }, 400);

  try {
    const row = (await db.prepare('SELECT pinned_chats_json FROM user_preferences WHERE user_handle = ? LIMIT 1')
      .bind(user.userHandle)
      .first()) as any;

    let pinned: string[] = [];
    try { pinned = JSON.parse(row?.pinned_chats_json || '[]'); } catch (_) {}

    if (isPinned && !pinned.includes(chatId)) {
      pinned.push(chatId);
    } else if (!isPinned) {
      pinned = pinned.filter((id) => id !== chatId);
    }

    await db.prepare(
      `INSERT INTO user_preferences (user_handle, pinned_chats_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_handle) DO UPDATE SET
         pinned_chats_json = excluded.pinned_chats_json,
         updated_at = CURRENT_TIMESTAMP`
    )
      .bind(user.userHandle, JSON.stringify(pinned))
      .run();

    return c.json({ success: true, isPinned, pinnedChats: pinned });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 4. Mute / Unmute Chat
preferencesApp.post('/mute', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const chatId = body.chatId || body.chat_id;
  const isMuted = body.isMuted ?? body.is_muted ?? true;
  const db = getDatabase(c);

  if (!chatId) return c.json({ success: false, error: 'chatId required' }, 400);

  try {
    const row = (await db.prepare('SELECT muted_chats_json FROM user_preferences WHERE user_handle = ? LIMIT 1')
      .bind(user.userHandle)
      .first()) as any;

    let muted: string[] = [];
    try { muted = JSON.parse(row?.muted_chats_json || '[]'); } catch (_) {}

    if (isMuted && !muted.includes(chatId)) {
      muted.push(chatId);
    } else if (!isMuted) {
      muted = muted.filter((id) => id !== chatId);
    }

    await db.prepare(
      `INSERT INTO user_preferences (user_handle, muted_chats_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_handle) DO UPDATE SET
         muted_chats_json = excluded.muted_chats_json,
         updated_at = CURRENT_TIMESTAMP`
    )
      .bind(user.userHandle, JSON.stringify(muted))
      .run();

    return c.json({ success: true, isMuted, mutedChats: muted });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export { preferencesApp };
