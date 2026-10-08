export async function isBlockedBetween(db: any, userA: string, userB: string): Promise<boolean> {
  const cleanA = (userA || '').replace(/^@+/, '').trim().toLowerCase();
  const cleanB = (userB || '').replace(/^@+/, '').trim().toLowerCase();
  if (!cleanA || !cleanB || cleanA === cleanB) return false;

  try {
    const row = await db
      .prepare(
        `SELECT id FROM user_blocks 
         WHERE (LOWER(blocker_handle) = ? AND LOWER(blocked_handle) = ?)
            OR (LOWER(blocker_handle) = ? AND LOWER(blocked_handle) = ?)
         LIMIT 1`
      )
      .bind(cleanA, cleanB, cleanB, cleanA)
      .first();

    return Boolean(row);
  } catch (err) {
    console.error('[Blocks] Error checking isBlockedBetween:', err);
    return false;
  }
}

export async function getBlockRelationship(
  db: any,
  me: string,
  other: string
): Promise<'blockedByMe' | 'blockedByThem' | 'none'> {
  const cleanMe = (me || '').replace(/^@+/, '').trim().toLowerCase();
  const cleanOther = (other || '').replace(/^@+/, '').trim().toLowerCase();
  if (!cleanMe || !cleanOther || cleanMe === cleanOther) return 'none';

  try {
    const rows = (await db
      .prepare(
        `SELECT blocker_handle, blocked_handle FROM user_blocks 
         WHERE (LOWER(blocker_handle) = ? AND LOWER(blocked_handle) = ?)
            OR (LOWER(blocker_handle) = ? AND LOWER(blocked_handle) = ?)`
      )
      .bind(cleanMe, cleanOther, cleanOther, cleanMe)
      .all()) as any;

    const list = rows?.results || [];
    for (const r of list) {
      const blocker = (r.blocker_handle || '').replace(/^@+/, '').trim().toLowerCase();
      if (blocker === cleanMe) return 'blockedByMe';
      if (blocker === cleanOther) return 'blockedByThem';
    }
  } catch (err) {
    console.error('[Blocks] Error checking getBlockRelationship:', err);
  }
  return 'none';
}
