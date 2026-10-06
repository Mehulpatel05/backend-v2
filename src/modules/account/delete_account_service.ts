export interface DeleteAccountResult {
  success: boolean;
  message: string;
  purgedTables?: string[];
  error?: string;
}

export async function executeDeleteAccount(
  db: any,
  rawHandle: string,
  installationId?: string
): Promise<DeleteAccountResult> {
  const cleanHandle = (rawHandle || '').replace(/^@+/, '').trim().toLowerCase();
  if (!cleanHandle) {
    return { success: false, message: 'Invalid handle provided for deletion' };
  }

  const handleVariants = [cleanHandle, `@${cleanHandle}`];
  const purgedTables: string[] = [];

  const safeRun = async (tableName: string, query: string, params: any[]) => {
    try {
      await db.prepare(query).bind(...params).run();
      purgedTables.push(tableName);
    } catch (e: any) {
      console.warn(`[deleteAccount] Warn on table ${tableName}:`, e?.message || e);
    }
  };

  try {
    let userRow: { id?: string; phone?: string; handle?: string } | null = null;
    try {
      userRow = (await db.prepare(
        'SELECT id, phone, handle FROM users WHERE LOWER(handle) = ? OR LOWER(handle) = ? LIMIT 1'
      ).bind(cleanHandle, `@${cleanHandle}`).first()) as any;
    } catch (_) {}

    const userId = userRow?.id || '';
    const phone = userRow?.phone || '';

    let userPostIds: string[] = [];
    try {
      const { results } = await db.prepare(
        'SELECT id FROM feed_posts WHERE LOWER(author_handle) = ? OR LOWER(author_handle) = ?'
      ).bind(cleanHandle, `@${cleanHandle}`).all();
      if (results && Array.isArray(results)) {
        userPostIds = results.map((r: any) => r.id).filter(Boolean);
      }
    } catch (_) {}

    if (userPostIds.length > 0) {
      for (const pid of userPostIds) {
        await safeRun('post_votes_children', 'DELETE FROM post_votes WHERE post_id = ?', [pid]);
        await safeRun('feed_likes_children', 'DELETE FROM feed_likes WHERE post_id = ?', [pid]);
        await safeRun('feed_comments_children', 'DELETE FROM feed_comments WHERE post_id = ?', [pid]);
      }
    }

    await safeRun(
      'post_votes_user',
      'DELETE FROM post_votes WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ?',
      handleVariants
    );
    await safeRun(
      'feed_likes_user',
      'DELETE FROM feed_likes WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ?',
      handleVariants
    );
    await safeRun(
      'feed_comments_user',
      'DELETE FROM feed_comments WHERE LOWER(author_handle) = ? OR LOWER(author_handle) = ?',
      handleVariants
    );
    await safeRun(
      'feed_posts',
      'DELETE FROM feed_posts WHERE LOWER(author_handle) = ? OR LOWER(author_handle) = ?',
      handleVariants
    );

    let userShopIds: string[] = [];
    try {
      const { results } = await db.prepare(
        'SELECT id FROM bazar_shops WHERE LOWER(owner_handle) = ? OR LOWER(owner_handle) = ?'
      ).bind(cleanHandle, `@${cleanHandle}`).all();
      if (results && Array.isArray(results)) {
        userShopIds = results.map((r: any) => r.id).filter(Boolean);
      }
    } catch (_) {}

    for (const sid of userShopIds) {
      await safeRun('shop_coupons_children', 'DELETE FROM shop_coupons WHERE shop_id = ?', [sid]);
    }
    await safeRun(
      'shop_coupons_owner',
      'DELETE FROM shop_coupons WHERE LOWER(owner_handle) = ? OR LOWER(owner_handle) = ?',
      handleVariants
    );

    let userListingIds: string[] = [];
    try {
      const { results } = await db.prepare(
        'SELECT id FROM bazar_listings WHERE LOWER(seller_handle) = ? OR LOWER(seller_handle) = ?'
      ).bind(cleanHandle, `@${cleanHandle}`).all();
      if (results && Array.isArray(results)) {
        userListingIds = results.map((r: any) => r.id).filter(Boolean);
      }
    } catch (_) {}

    for (const lid of userListingIds) {
      await safeRun('bazar_saved_children', 'DELETE FROM bazar_saved WHERE listing_id = ?', [lid]);
      await safeRun('listing_boosts_children', 'DELETE FROM listing_boosts WHERE listing_id = ?', [lid]);
    }
    await safeRun(
      'bazar_saved_user',
      'DELETE FROM bazar_saved WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ?',
      handleVariants
    );
    await safeRun(
      'listing_boosts_user',
      'DELETE FROM listing_boosts WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ?',
      handleVariants
    );
    await safeRun(
      'bazar_listings',
      'DELETE FROM bazar_listings WHERE LOWER(seller_handle) = ? OR LOWER(seller_handle) = ?',
      handleVariants
    );
    await safeRun(
      'bazar_shops',
      'DELETE FROM bazar_shops WHERE LOWER(owner_handle) = ? OR LOWER(owner_handle) = ?',
      handleVariants
    );

    let userChatIds: string[] = [];
    try {
      const { results } = await db.prepare(
        'SELECT id FROM chats WHERE LOWER(user1_handle) = ? OR LOWER(user2_handle) = ? OR LOWER(user1_handle) = ? OR LOWER(user2_handle) = ?'
      ).bind(cleanHandle, cleanHandle, `@${cleanHandle}`, `@${cleanHandle}`).all();
      if (results && Array.isArray(results)) {
        userChatIds = results.map((r: any) => r.id).filter(Boolean);
      }
    } catch (_) {}

    for (const cid of userChatIds) {
      await safeRun('chat_messages_children', 'DELETE FROM chat_messages WHERE chat_id = ?', [cid]);
    }
    await safeRun(
      'chat_messages_user',
      'DELETE FROM chat_messages WHERE LOWER(sender_handle) = ? OR LOWER(receiver_handle) = ? OR LOWER(sender_handle) = ? OR LOWER(receiver_handle) = ?',
      [cleanHandle, cleanHandle, `@${cleanHandle}`, `@${cleanHandle}`]
    );
    await safeRun(
      'chats_user',
      'DELETE FROM chats WHERE LOWER(user1_handle) = ? OR LOWER(user2_handle) = ? OR LOWER(user1_handle) = ? OR LOWER(user2_handle) = ?',
      [cleanHandle, cleanHandle, `@${cleanHandle}`, `@${cleanHandle}`]
    );

    await safeRun(
      'friend_requests',
      'DELETE FROM friend_requests WHERE LOWER(sender_handle) = ? OR LOWER(receiver_handle) = ? OR LOWER(sender_handle) = ? OR LOWER(receiver_handle) = ?',
      [cleanHandle, cleanHandle, `@${cleanHandle}`, `@${cleanHandle}`]
    );
    await safeRun(
      'friendships',
      'DELETE FROM friendships WHERE LOWER(user1_handle) = ? OR LOWER(user2_handle) = ? OR LOWER(user1_handle) = ? OR LOWER(user2_handle) = ?',
      [cleanHandle, cleanHandle, `@${cleanHandle}`, `@${cleanHandle}`]
    );
    await safeRun(
      'notifications',
      'DELETE FROM notifications WHERE LOWER(target_handle) = ? OR LOWER(sender_handle) = ? OR LOWER(target_handle) = ? OR LOWER(sender_handle) = ?',
      [cleanHandle, cleanHandle, `@${cleanHandle}`, `@${cleanHandle}`]
    );

    await safeRun(
      'helpful_votes',
      'DELETE FROM helpful_votes WHERE LOWER(voter_handle) = ? OR LOWER(author_handle) = ? OR LOWER(voter_handle) = ? OR LOWER(author_handle) = ?',
      [cleanHandle, cleanHandle, `@${cleanHandle}`, `@${cleanHandle}`]
    );
    await safeRun(
      'referrals',
      'DELETE FROM referrals WHERE LOWER(inviter_handle) = ? OR LOWER(invitee_handle) = ? OR LOWER(inviter_handle) = ? OR LOWER(invitee_handle) = ?',
      [cleanHandle, cleanHandle, `@${cleanHandle}`, `@${cleanHandle}`]
    );
    await safeRun(
      'user_coupons',
      'DELETE FROM user_coupons WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ?',
      handleVariants
    );
    await safeRun(
      'user_badges',
      'DELETE FROM user_badges WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ?',
      handleVariants
    );
    await safeRun(
      'user_rewards',
      'DELETE FROM user_rewards WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ?',
      handleVariants
    );
    await safeRun(
      'points_ledger',
      'DELETE FROM points_ledger WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ?',
      handleVariants
    );

    const userIdentifiers = [cleanHandle, `@${cleanHandle}`];
    if (userId) userIdentifiers.push(userId);

    for (const uid of userIdentifiers) {
      await safeRun('area_founders', 'DELETE FROM area_founders WHERE LOWER(user_id) = ?', [uid.toLowerCase()]);
      await safeRun('founding_requests', 'DELETE FROM founding_requests WHERE LOWER(user_id) = ?', [uid.toLowerCase()]);
    }

    await safeRun(
      'user_preferences',
      'DELETE FROM user_preferences WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ?',
      handleVariants
    );
    await safeRun(
      'user_feedback',
      'DELETE FROM user_feedback WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ?',
      handleVariants
    );

    if (installationId) {
      await safeRun(
        'devices',
        'DELETE FROM devices WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ? OR installation_id = ?',
        [cleanHandle, `@${cleanHandle}`, installationId]
      );
    } else {
      await safeRun(
        'devices',
        'DELETE FROM devices WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ?',
        handleVariants
      );
    }

    await safeRun(
      'profiles',
      'DELETE FROM profiles WHERE LOWER(handle) = ? OR LOWER(handle) = ?',
      handleVariants
    );

    if (phone) {
      await safeRun('phone_otps', 'DELETE FROM phone_otps WHERE phone = ?', [phone]);
      const tenDigits = phone.replace(/\D/g, '').slice(-10);
      if (tenDigits) {
        await safeRun(
          'phone_otps_variations',
          'DELETE FROM phone_otps WHERE phone LIKE ?',
          [`%${tenDigits}`]
        );
      }
    }

    if (phone) {
      await safeRun(
        'users',
        'DELETE FROM users WHERE LOWER(handle) = ? OR LOWER(handle) = ? OR phone = ?',
        [cleanHandle, `@${cleanHandle}`, phone]
      );
    } else {
      await safeRun(
        'users',
        'DELETE FROM users WHERE LOWER(handle) = ? OR LOWER(handle) = ?',
        handleVariants
      );
    }

    return {
      success: true,
      message: 'Account and all associated records permanently purged',
      purgedTables,
    };
  } catch (err: any) {
    console.error('[executeDeleteAccount] Critical failure during deletion:', err);
    return {
      success: false,
      message: 'Failed to completely purge account records',
      error: err?.message || String(err),
    };
  }
}
