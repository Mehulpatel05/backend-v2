import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';
import { syncUserPreferencesToD1Folder } from '../../utils/d1_user_sync';

const preferencesApp = new Hono<{ Bindings: Env; Variables: Variables }>();

function buildPreferencesResponse(row: any) {
  let pinned: string[] = [];
  let muted: string[] = [];
  let favourites: string[] = [];
  let archived: string[] = [];
  let locked: string[] = [];
  let deleted: string[] = [];
  let pinnedTimestamps: Record<string, number> = {};
  let archivedTimestamps: Record<string, number> = {};
  let mutedExpiries: Record<string, number | null> = {};

  try { pinned = JSON.parse(row?.pinned_chats_json || '[]'); } catch (_) {}
  try { muted = JSON.parse(row?.muted_chats_json || '[]'); } catch (_) {}
  try { favourites = JSON.parse(row?.favourite_chats_json || '[]'); } catch (_) {}
  try { archived = JSON.parse(row?.archived_chats_json || '[]'); } catch (_) {}
  try { locked = JSON.parse(row?.locked_chats_json || '[]'); } catch (_) {}
  try { deleted = JSON.parse(row?.deleted_chats_json || '[]'); } catch (_) {}
  try { pinnedTimestamps = JSON.parse(row?.pinned_timestamps_json || '{}'); } catch (_) {}
  try { archivedTimestamps = JSON.parse(row?.archived_timestamps_json || '{}'); } catch (_) {}

  if (Array.isArray(muted)) {
    for (const m of muted) {
      mutedExpiries[m] = -1;
    }
  }

  return {
    callPrivacy: row?.call_privacy || 'everyone',
    call_privacy: row?.call_privacy || 'everyone',
    pinnedChats: pinned,
    mutedChats: muted,
    favouriteChats: favourites,
    archivedChats: archived,
    lockedChats: locked,
    deletedChats: deleted,
    pinnedChatIds: pinned,
    mutedChatExpiries: mutedExpiries,
    favouriteChatIds: favourites,
    archivedChatIds: archived,
    lockedChatIds: locked,
    deletedChatIds: deleted,
    pinnedTimestamps,
    archivedTimestamps,
    keepChatsArchived: Boolean(row?.keep_chats_archived),
    theme: row?.theme || 'dark',
  };
}

preferencesApp.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = (user.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const db = getDatabase(c);

  try {
    const row = (await db.prepare('SELECT * FROM user_preferences WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ? LIMIT 1')
      .bind(myHandle, `@${myHandle}`)
      .first()) as any;

    const preferences = buildPreferencesResponse(row);
    return c.json({
      success: true,
      preferences,
      callPrivacy: preferences.callPrivacy,
      call_privacy: preferences.call_privacy,
    });
  } catch (e: any) {
    const defaultPrefs = buildPreferencesResponse(null);
    return c.json({
      success: true,
      preferences: defaultPrefs,
      callPrivacy: defaultPrefs.callPrivacy,
      call_privacy: defaultPrefs.call_privacy,
    });
  }
});

preferencesApp.get('/:handle', async (c) => {
  const handle = (c.req.param('handle') || '').replace(/^@+/, '').trim().toLowerCase();
  const db = getDatabase(c);

  try {
    const row = (await db.prepare('SELECT * FROM user_preferences WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ? LIMIT 1')
      .bind(handle, `@${handle}`)
      .first()) as any;

    const preferences = buildPreferencesResponse(row);
    return c.json({
      success: true,
      preferences,
      callPrivacy: preferences.callPrivacy,
      call_privacy: preferences.call_privacy,
    });
  } catch (_) {
    const defaultPrefs = buildPreferencesResponse(null);
    return c.json({
      success: true,
      preferences: defaultPrefs,
      callPrivacy: defaultPrefs.callPrivacy,
      call_privacy: defaultPrefs.call_privacy,
    });
  }
});

preferencesApp.post('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = (user.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const prefs = body.preferences || body;
  const db = getDatabase(c);

  try {
    const userRow = (await db.prepare(
      'SELECT handle FROM users WHERE LOWER(handle) = ? OR LOWER(handle) = ? LIMIT 1'
    ).bind(myHandle, `@${myHandle}`).first()) as any;

    const existing = (await db.prepare(
      'SELECT * FROM user_preferences WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ? LIMIT 1'
    ).bind(myHandle, `@${myHandle}`).first()) as any;

    const targetHandle = existing?.user_handle || userRow?.handle || myHandle;

    let existingPinned: any[] = [];
    let existingMuted: any[] = [];
    let existingFavourites: any[] = [];
    let existingArchived: any[] = [];
    let existingLocked: any[] = [];
    let existingDeleted: any[] = [];
    let existingPinnedTimes: any = {};
    let existingArchivedTimes: any = {};

    try { existingPinned = JSON.parse(existing?.pinned_chats_json || '[]'); } catch (_) {}
    try { existingMuted = JSON.parse(existing?.muted_chats_json || '[]'); } catch (_) {}
    try { existingFavourites = JSON.parse(existing?.favourite_chats_json || '[]'); } catch (_) {}
    try { existingArchived = JSON.parse(existing?.archived_chats_json || '[]'); } catch (_) {}
    try { existingLocked = JSON.parse(existing?.locked_chats_json || '[]'); } catch (_) {}
    try { existingDeleted = JSON.parse(existing?.deleted_chats_json || '[]'); } catch (_) {}
    try { existingPinnedTimes = JSON.parse(existing?.pinned_timestamps_json || '{}'); } catch (_) {}
    try { existingArchivedTimes = JSON.parse(existing?.archived_timestamps_json || '{}'); } catch (_) {}

    const callPrivacy = body.callPrivacy ?? prefs.callPrivacy ?? body.call_privacy ?? prefs.call_privacy ?? existing?.call_privacy ?? 'everyone';
    const theme = body.theme ?? prefs.theme ?? existing?.theme ?? 'dark';

    const pinnedChats = prefs.pinnedChatIds ?? prefs.pinnedChats ?? prefs.pinned_chats ?? existingPinned;
    const favouriteChats = prefs.favouriteChatIds ?? prefs.favouriteChats ?? prefs.favourite_chats ?? existingFavourites;
    const archivedChats = prefs.archivedChatIds ?? prefs.archivedChats ?? prefs.archived_chats ?? existingArchived;
    const lockedChats = prefs.lockedChatIds ?? prefs.lockedChats ?? prefs.locked_chats ?? existingLocked;
    const deletedChats = prefs.deletedChatIds ?? prefs.deletedChats ?? prefs.deleted_chats ?? existingDeleted;

    let mutedChats = prefs.mutedChats ?? prefs.muted_chats;
    if (!mutedChats && prefs.mutedChatExpiries && typeof prefs.mutedChatExpiries === 'object') {
      mutedChats = Object.keys(prefs.mutedChatExpiries);
    }
    if (!mutedChats) {
      mutedChats = existingMuted;
    }

    const pinnedTimestamps = prefs.pinnedTimestamps ?? prefs.pinned_timestamps ?? existingPinnedTimes;
    const archivedTimestamps = prefs.archivedTimestamps ?? prefs.archived_timestamps ?? existingArchivedTimes;
    const keepChatsArchived = (prefs.keepChatsArchived ?? prefs.keep_chats_archived ?? existing?.keep_chats_archived) ? 1 : 0;

    try {
      await db.prepare(
        `INSERT INTO user_preferences (
           user_handle, call_privacy, pinned_chats_json, muted_chats_json,
           favourite_chats_json, archived_chats_json, locked_chats_json, deleted_chats_json,
           pinned_timestamps_json, archived_timestamps_json, keep_chats_archived,
           theme, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_handle) DO UPDATE SET
           call_privacy = excluded.call_privacy,
           pinned_chats_json = excluded.pinned_chats_json,
           muted_chats_json = excluded.muted_chats_json,
           favourite_chats_json = excluded.favourite_chats_json,
           archived_chats_json = excluded.archived_chats_json,
           locked_chats_json = excluded.locked_chats_json,
           deleted_chats_json = excluded.deleted_chats_json,
           pinned_timestamps_json = excluded.pinned_timestamps_json,
           archived_timestamps_json = excluded.archived_timestamps_json,
           keep_chats_archived = excluded.keep_chats_archived,
           theme = excluded.theme,
           updated_at = CURRENT_TIMESTAMP`
      )
        .bind(
          targetHandle,
          callPrivacy,
          JSON.stringify(pinnedChats),
          JSON.stringify(mutedChats),
          JSON.stringify(favouriteChats),
          JSON.stringify(archivedChats),
          JSON.stringify(lockedChats),
          JSON.stringify(deletedChats),
          JSON.stringify(pinnedTimestamps),
          JSON.stringify(archivedTimestamps),
          keepChatsArchived,
          theme
        )
        .run();
    } catch (_) {
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
        .bind(targetHandle, callPrivacy, JSON.stringify(pinnedChats), JSON.stringify(mutedChats), theme)
        .run();
    }

    syncUserPreferencesToD1Folder(db, myHandle, c).catch(() => {});

    return c.json({
      success: true,
      message: 'Preferences saved successfully',
      preferences: {
        callPrivacy,
        pinnedChats,
        pinnedChatIds: pinnedChats,
        mutedChats,
        favouriteChats,
        favouriteChatIds: favouriteChats,
        archivedChats,
        archivedChatIds: archivedChats,
        lockedChats,
        lockedChatIds: lockedChats,
        deletedChats,
        deletedChatIds: deletedChats,
        pinnedTimestamps,
        archivedTimestamps,
        keepChatsArchived: Boolean(keepChatsArchived),
        theme,
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

preferencesApp.post('/favourite', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = (user.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const chatId = body.chatId || body.chat_id;
  const isFavourite = body.isFavourite ?? body.is_favourite ?? true;
  const db = getDatabase(c);

  if (!chatId) return c.json({ success: false, error: 'chatId required' }, 400);

  try {
    const userRow = (await db.prepare(
      'SELECT handle FROM users WHERE LOWER(handle) = ? OR LOWER(handle) = ? LIMIT 1'
    ).bind(myHandle, `@${myHandle}`).first()) as any;

    const existing = (await db.prepare(
      'SELECT * FROM user_preferences WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ? LIMIT 1'
    ).bind(myHandle, `@${myHandle}`).first()) as any;

    const targetHandle = existing?.user_handle || userRow?.handle || myHandle;

    let favourites: string[] = [];
    try { favourites = JSON.parse(existing?.favourite_chats_json || '[]'); } catch (_) {}

    if (isFavourite && !favourites.includes(chatId)) {
      favourites.push(chatId);
    } else if (!isFavourite) {
      favourites = favourites.filter((id) => id !== chatId);
    }

    await db.prepare(
      `INSERT INTO user_preferences (user_handle, favourite_chats_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_handle) DO UPDATE SET
         favourite_chats_json = excluded.favourite_chats_json,
         updated_at = CURRENT_TIMESTAMP`
    )
      .bind(targetHandle, JSON.stringify(favourites))
      .run();

    return c.json({
      success: true,
      isFavourite,
      favouriteChats: favourites,
      favouriteChatIds: favourites,
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

preferencesApp.post('/pin', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = (user.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const chatId = body.chatId || body.chat_id;
  const isPinned = body.isPinned ?? body.is_pinned ?? true;
  const db = getDatabase(c);

  if (!chatId) return c.json({ success: false, error: 'chatId required' }, 400);

  try {
    const userRow = (await db.prepare(
      'SELECT handle FROM users WHERE LOWER(handle) = ? OR LOWER(handle) = ? LIMIT 1'
    ).bind(myHandle, `@${myHandle}`).first()) as any;

    const existing = (await db.prepare(
      'SELECT * FROM user_preferences WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ? LIMIT 1'
    ).bind(myHandle, `@${myHandle}`).first()) as any;

    const targetHandle = existing?.user_handle || userRow?.handle || myHandle;

    let pinned: string[] = [];
    try { pinned = JSON.parse(existing?.pinned_chats_json || '[]'); } catch (_) {}

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
      .bind(targetHandle, JSON.stringify(pinned))
      .run();

    return c.json({ success: true, isPinned, pinnedChats: pinned, pinnedChatIds: pinned });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

preferencesApp.post('/mute', authMiddleware, async (c) => {
  const user = c.get('user');
  const myHandle = (user.userHandle || '').replace(/^@+/, '').trim().toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const chatId = body.chatId || body.chat_id;
  const isMuted = body.isMuted ?? body.is_muted ?? true;
  const db = getDatabase(c);

  if (!chatId) return c.json({ success: false, error: 'chatId required' }, 400);

  try {
    const userRow = (await db.prepare(
      'SELECT handle FROM users WHERE LOWER(handle) = ? OR LOWER(handle) = ? LIMIT 1'
    ).bind(myHandle, `@${myHandle}`).first()) as any;

    const existing = (await db.prepare(
      'SELECT * FROM user_preferences WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ? LIMIT 1'
    ).bind(myHandle, `@${myHandle}`).first()) as any;

    const targetHandle = existing?.user_handle || userRow?.handle || myHandle;

    let muted: string[] = [];
    try { muted = JSON.parse(existing?.muted_chats_json || '[]'); } catch (_) {}

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
      .bind(targetHandle, JSON.stringify(muted))
      .run();

    return c.json({ success: true, isMuted, mutedChats: muted });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export { preferencesApp };
