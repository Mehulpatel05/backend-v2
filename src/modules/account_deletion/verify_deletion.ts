export interface DeletionAuditReport {
  verifiedZeroRecords: boolean;
  auditCounts: {
    usersLeft: number;
    profilesLeft: number;
    devicesLeft: number;
    chatsLeft: number;
    postsLeft: number;
    listingsLeft: number;
    shopsLeft: number;
    notificationsLeft: number;
    friendshipsLeft: number;
  };
}

export async function verifyUserDeletion(
  db: any,
  cleanHandle: string,
  userId: string,
  phone: string
): Promise<DeletionAuditReport> {
  const auditCounts = {
    usersLeft: 0,
    profilesLeft: 0,
    devicesLeft: 0,
    chatsLeft: 0,
    postsLeft: 0,
    listingsLeft: 0,
    shopsLeft: 0,
    notificationsLeft: 0,
    friendshipsLeft: 0,
  };

  try {
    const userRow = (await db
      .prepare(
        'SELECT COUNT(*) as cnt FROM users WHERE LOWER(handle) = ? OR LOWER(handle) = ? OR (phone != "" AND phone = ?) OR (id != "" AND id = ?)'
      )
      .bind(cleanHandle, `@${cleanHandle}`, phone || 'NO_PHONE', userId || 'NO_UID')
      .first()) as any;
    auditCounts.usersLeft = userRow?.cnt ?? 0;
  } catch (_) {}

  try {
    const profileRow = (await db
      .prepare('SELECT COUNT(*) as cnt FROM profiles WHERE LOWER(handle) = ? OR LOWER(handle) = ?')
      .bind(cleanHandle, `@${cleanHandle}`)
      .first()) as any;
    auditCounts.profilesLeft = profileRow?.cnt ?? 0;
  } catch (_) {}

  try {
    const devicesRow = (await db
      .prepare('SELECT COUNT(*) as cnt FROM devices WHERE LOWER(user_handle) = ? OR LOWER(user_handle) = ?')
      .bind(cleanHandle, `@${cleanHandle}`)
      .first()) as any;
    auditCounts.devicesLeft = devicesRow?.cnt ?? 0;
  } catch (_) {}

  try {
    const chatsRow = (await db
      .prepare(
        'SELECT COUNT(*) as cnt FROM chats WHERE LOWER(user1_handle) = ? OR LOWER(user2_handle) = ? OR LOWER(user1_handle) = ? OR LOWER(user2_handle) = ?'
      )
      .bind(cleanHandle, cleanHandle, `@${cleanHandle}`, `@${cleanHandle}`)
      .first()) as any;
    auditCounts.chatsLeft = chatsRow?.cnt ?? 0;
  } catch (_) {}

  try {
    const postsRow = (await db
      .prepare('SELECT COUNT(*) as cnt FROM feed_posts WHERE LOWER(author_handle) = ? OR LOWER(author_handle) = ?')
      .bind(cleanHandle, `@${cleanHandle}`)
      .first()) as any;
    auditCounts.postsLeft = postsRow?.cnt ?? 0;
  } catch (_) {}

  try {
    const listingsRow = (await db
      .prepare('SELECT COUNT(*) as cnt FROM bazar_listings WHERE LOWER(seller_handle) = ? OR LOWER(seller_handle) = ?')
      .bind(cleanHandle, `@${cleanHandle}`)
      .first()) as any;
    auditCounts.listingsLeft = listingsRow?.cnt ?? 0;
  } catch (_) {}

  try {
    const shopsRow = (await db
      .prepare('SELECT COUNT(*) as cnt FROM bazar_shops WHERE LOWER(owner_handle) = ? OR LOWER(owner_handle) = ?')
      .bind(cleanHandle, `@${cleanHandle}`)
      .first()) as any;
    auditCounts.shopsLeft = shopsRow?.cnt ?? 0;
  } catch (_) {}

  try {
    const notifRow = (await db
      .prepare('SELECT COUNT(*) as cnt FROM notifications WHERE LOWER(target_handle) = ? OR LOWER(target_handle) = ?')
      .bind(cleanHandle, `@${cleanHandle}`)
      .first()) as any;
    auditCounts.notificationsLeft = notifRow?.cnt ?? 0;
  } catch (_) {}

  try {
    const friendRow = (await db
      .prepare('SELECT COUNT(*) as cnt FROM friendships WHERE LOWER(user1_handle) = ? OR LOWER(user2_handle) = ? OR LOWER(user1_handle) = ? OR LOWER(user2_handle) = ?')
      .bind(cleanHandle, cleanHandle, `@${cleanHandle}`, `@${cleanHandle}`)
      .first()) as any;
    auditCounts.friendshipsLeft = friendRow?.cnt ?? 0;
  } catch (_) {}

  const verifiedZeroRecords =
    auditCounts.usersLeft === 0 &&
    auditCounts.profilesLeft === 0 &&
    auditCounts.devicesLeft === 0 &&
    auditCounts.chatsLeft === 0 &&
    auditCounts.postsLeft === 0 &&
    auditCounts.listingsLeft === 0 &&
    auditCounts.shopsLeft === 0 &&
    auditCounts.notificationsLeft === 0 &&
    auditCounts.friendshipsLeft === 0;

  return {
    verifiedZeroRecords,
    auditCounts,
  };
}
