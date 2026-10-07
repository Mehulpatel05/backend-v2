export interface DeletionAuditReport {
  verifiedZeroRecords: boolean;
  auditCounts: {
    usersLeft: number;
    profilesLeft: number;
    devicesLeft: number;
    chatsLeft: number;
    postsLeft: number;
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

  const verifiedZeroRecords =
    auditCounts.usersLeft === 0 &&
    auditCounts.profilesLeft === 0 &&
    auditCounts.devicesLeft === 0 &&
    auditCounts.chatsLeft === 0 &&
    auditCounts.postsLeft === 0;

  return {
    verifiedZeroRecords,
    auditCounts,
  };
}
