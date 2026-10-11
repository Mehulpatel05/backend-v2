export function normalizeContentText(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function calculateTextSimilarity(textA: string, textB: string): number {
  const normA = normalizeContentText(textA);
  const normB = normalizeContentText(textB);

  if (!normA && !normB) return 1.0;
  if (!normA || !normB) return 0.0;
  if (normA === normB) return 1.0;

  const wordsA = new Set(normA.split(' ').filter(w => w.length > 0));
  const wordsB = new Set(normB.split(' ').filter(w => w.length > 0));

  let intersectionCount = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) {
      intersectionCount++;
    }
  }

  const unionSize = new Set([...wordsA, ...wordsB]).size;
  const wordJaccard = unionSize > 0 ? intersectionCount / unionSize : 0;

  const getBigrams = (s: string): Set<string> => {
    const bigrams = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) {
      bigrams.add(s.substring(i, i + 2));
    }
    return bigrams;
  };

  const bigramsA = getBigrams(normA);
  const bigramsB = getBigrams(normB);

  let bigramIntersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) {
      bigramIntersection++;
    }
  }

  const totalBigrams = bigramsA.size + bigramsB.size;
  const bigramDice = totalBigrams > 0 ? (2 * bigramIntersection) / totalBigrams : 0;

  return Math.max(wordJaccard, bigramDice);
}

export function validateContentQuality(text: string): { valid: boolean; error?: string } {
  const trimmed = (text || '').trim();

  if (trimmed.length < 20) {
    return { valid: false, error: 'Content must be at least 20 characters' };
  }

  if (/(.)\1{4,}/i.test(trimmed)) {
    return { valid: false, error: 'Content contains repeated characters' };
  }

  if (/(.{2,6})\1{3,}/i.test(trimmed)) {
    return { valid: false, error: 'Content contains repetitive patterns' };
  }

  const nonWhitespace = trimmed.replace(/\s+/g, '');
  const uniqueChars = new Set(nonWhitespace.toLowerCase());
  if (uniqueChars.size < 4) {
    return { valid: false, error: 'Content lacks sufficient character diversity' };
  }

  const charCounts: Record<string, number> = {};
  for (const ch of nonWhitespace.toLowerCase()) {
    charCounts[ch] = (charCounts[ch] || 0) + 1;
  }

  const highestCount = Math.max(...Object.values(charCounts));
  if (highestCount / nonWhitespace.length > 0.45) {
    return { valid: false, error: 'Content is dominated by a repeated character' };
  }

  return { valid: true };
}

export async function checkDuplicateContent(
  db: any,
  userHandle: string,
  text: string,
  type: 'post' | 'reply',
  excludeId?: string
): Promise<{ isDuplicate: boolean; error?: string }> {
  const cleanHandle = userHandle.replace(/^@+/, '').trim();
  const tableName = type === 'post' ? 'feed_posts' : 'feed_comments';

  let query = `
    SELECT id, content FROM ${tableName}
    WHERE (LOWER(author_handle) = LOWER(?) OR LOWER(author_handle) = LOWER(?))
      AND created_at >= datetime('now', '-7 days')
  `;
  const params: any[] = [cleanHandle, `@${cleanHandle}`];
  if (excludeId) {
    query += ' AND id != ?';
    params.push(excludeId);
  }
  query += ' ORDER BY created_at DESC LIMIT 100';

  const rows = await db.prepare(query).bind(...params).all() as any;

  const newNormalized = normalizeContentText(text);

  for (const row of rows.results || []) {
    const existing = row.content || '';
    const existingNormalized = normalizeContentText(existing);

    if (newNormalized === existingNormalized) {
      return {
        isDuplicate: true,
        error: 'Duplicate text from the same user within 7 days is not allowed',
      };
    }

    const similarity = calculateTextSimilarity(text, existing);
    if (similarity >= 0.75) {
      return {
        isDuplicate: true,
        error: 'Near-duplicate text from the same user within 7 days is not allowed',
      };
    }
  }

  return { isDuplicate: false };
}

export function parseSqliteTimestamp(ts: string): number {
  if (!ts) return 0;
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T') + (ts.endsWith('Z') ? '' : 'Z');
  const parsed = new Date(iso).getTime();
  return isNaN(parsed) ? new Date(ts).getTime() : parsed;
}

export async function checkPostCooldown(
  db: any,
  userHandle: string
): Promise<{ allowed: boolean; waitSeconds?: number; error?: string }> {
  const cleanHandle = userHandle.replace(/^@+/, '').trim();

  const lastPost = await db.prepare(`
    SELECT created_at FROM points_ledger
    WHERE LOWER(user_handle) = LOWER(?)
      AND (action = 'post' OR ref_type = 'post')
      AND delta > 0
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(cleanHandle).first() as any;

  if (!lastPost || !lastPost.created_at) {
    return { allowed: true };
  }

  const lastTime = parseSqliteTimestamp(String(lastPost.created_at));
  const now = Date.now();
  const elapsedMs = Math.abs(now - lastTime);
  const cooldownMs = 120 * 1000;

  if (elapsedMs < cooldownMs) {
    const waitSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000);
    return {
      allowed: false,
      waitSeconds,
      error: `Reward cooldown active: wait ${waitSeconds}s between rewarded posts`,
    };
  }

  return { allowed: true };
}

export async function validateHelpfulVote(
  db: any,
  voterHandle: string,
  authorHandle: string,
  replyId: string
): Promise<{ eligible: boolean; reason?: string }> {
  const cleanVoter = voterHandle.replace(/^@+/, '').trim().toLowerCase();
  const cleanAuthor = authorHandle.replace(/^@+/, '').trim().toLowerCase();

  if (cleanVoter === cleanAuthor) {
    return { eligible: false, reason: 'No self-votes allowed' };
  }

  const voterUser = await db.prepare(`
    SELECT created_at FROM users
    WHERE LOWER(handle) = LOWER(?) OR LOWER(handle) = LOWER(?)
    LIMIT 1
  `).bind(cleanVoter, `@${cleanVoter}`).first() as any;

  if (!voterUser || !voterUser.created_at) {
    return { eligible: false, reason: 'Voter profile not found' };
  }

  const voterAgeMs = Date.now() - parseSqliteTimestamp(String(voterUser.created_at));
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  if (voterAgeMs < sevenDaysMs) {
    return { eligible: false, reason: 'Voter account must be at least 7 days old to reward points' };
  }

  const todayVotes = await db.prepare(`
    SELECT COUNT(*) as cnt FROM helpful_votes
    WHERE LOWER(voter_handle) = LOWER(?)
      AND LOWER(author_handle) = LOWER(?)
      AND is_rewarded = 1
      AND date(created_at) = date('now')
  `).bind(cleanVoter, cleanAuthor).first() as any;

  if ((todayVotes?.cnt || 0) >= 1) {
    return { eligible: false, reason: 'Only 1 rewarded vote per author per day allowed' };
  }

  const weeklyPairVotes = await db.prepare(`
    SELECT COUNT(*) as cnt FROM helpful_votes
    WHERE ((LOWER(voter_handle) = LOWER(?) AND LOWER(author_handle) = LOWER(?))
        OR (LOWER(voter_handle) = LOWER(?) AND LOWER(author_handle) = LOWER(?)))
      AND is_rewarded = 1
      AND created_at >= datetime('now', '-7 days')
  `).bind(cleanVoter, cleanAuthor, cleanAuthor, cleanVoter).first() as any;

  if ((weeklyPairVotes?.cnt || 0) >= 3) {
    return { eligible: false, reason: 'Maximum 3 rewarded votes between the same pair of users per week' };
  }

  return { eligible: true };
}

export async function reversePoints(
  db: any,
  sourceId: string,
  action: 'post' | 'reply' | 'bazaar'
): Promise<{ reversed: boolean; delta: number; newBalance?: number }> {
  const cleanSourceId = (sourceId || '').trim();
  if (!cleanSourceId) {
    return { reversed: false, delta: 0 };
  }

  const originalLedger = await db.prepare(`
    SELECT user_handle, delta, action, ref_type, source_id, ref_id, date(created_at) as credit_date
    FROM points_ledger
    WHERE (source_id = ? OR ref_id = ?)
      AND (action = ? OR ref_type = ?)
      AND delta > 0
    LIMIT 1
  `).bind(cleanSourceId, cleanSourceId, action, action).first() as any;

  if (!originalLedger) {
    return { reversed: false, delta: 0 };
  }

  const reversalAction = `${action}_reversal`;
  const existingReversal = await db.prepare(`
    SELECT id FROM points_ledger
    WHERE user_handle = ?
      AND (action = ? OR ref_type = ?)
      AND (source_id = ? OR ref_id = ?)
    LIMIT 1
  `).bind(originalLedger.user_handle, reversalAction, reversalAction, cleanSourceId, cleanSourceId).first() as any;

  if (existingReversal) {
    return { reversed: false, delta: 0 };
  }

  const userHandle = originalLedger.user_handle;
  const originalDelta = originalLedger.delta;
  const reversalDelta = -originalDelta;
  const reversalId = `rev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  await db.prepare(`
    INSERT INTO points_ledger (id, user_handle, delta, action, source_id, reason, ref_type, ref_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    reversalId,
    userHandle,
    reversalDelta,
    reversalAction,
    cleanSourceId,
    `Points reversed: ${action} deleted or removed`,
    reversalAction,
    cleanSourceId
  ).run();

  const userRewards = await db.prepare(`
    SELECT balance, lifetime_points, daily_points_today, daily_date
    FROM user_rewards
    WHERE user_handle = ?
  `).bind(userHandle).first() as any;

  const currentBalance = userRewards?.balance ?? 0;
  const currentLifetime = userRewards?.lifetime_points ?? 0;
  const newBalance = currentBalance + reversalDelta;
  const newLifetime = Math.max(0, currentLifetime + reversalDelta);

  let newDailyPoints = userRewards?.daily_points_today ?? 0;
  const todayDate = new Date().toISOString().split('T')[0];
  if (originalLedger.credit_date === todayDate && userRewards?.daily_date === todayDate) {
    newDailyPoints = Math.max(0, newDailyPoints + reversalDelta);
  }

  await db.prepare(`
    UPDATE user_rewards
    SET balance = ?, lifetime_points = ?, daily_points_today = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_handle = ?
  `).bind(newBalance, newLifetime, newDailyPoints, userHandle).run();

  if (originalLedger.credit_date === todayDate) {
    const colName = action === 'post' ? 'posts_count' : (action === 'reply' ? 'replies_count' : 'listings_count');
    await db.prepare(`
      UPDATE user_daily_rewards
      SET ${colName} = MAX(0, ${colName} - 1),
          daily_points = MAX(0, daily_points + ?),
          updated_at = CURRENT_TIMESTAMP
      WHERE user_handle = ? AND date = ?
    `).bind(reversalDelta, userHandle, todayDate).run().catch(() => {});
  }

  return { reversed: true, delta: reversalDelta, newBalance };
}

export async function validateReferralApplication(
  db: any,
  inviteeHandle: string,
  code: string,
  deviceId?: string
): Promise<{ success: boolean; inviterHandle?: string; error?: string }> {
  const cleanInvitee = inviteeHandle.replace(/^@+/, '').trim().toLowerCase();
  const cleanCode = (code || '').trim().toUpperCase();
  const cleanDeviceId = (deviceId || '').trim();

  if (!cleanCode) {
    return { success: false, error: 'Referral code is required' };
  }

  const inviteeUser = await db.prepare(`
    SELECT phone, is_verified FROM users
    WHERE LOWER(handle) = LOWER(?) OR LOWER(handle) = LOWER(?)
    LIMIT 1
  `).bind(cleanInvitee, `@${cleanInvitee}`).first() as any;

  if (!inviteeUser) {
    return { success: false, error: 'User account not found' };
  }

  if (inviteeUser.is_verified !== 1) {
    return { success: false, error: 'Friend must verify phone number before applying referral code' };
  }

  const inviterRow = await db.prepare(`
    SELECT user_handle FROM user_rewards
    WHERE referral_code = ?
    LIMIT 1
  `).bind(cleanCode).first() as any;

  if (!inviterRow) {
    return { success: false, error: 'Invalid referral code' };
  }

  const cleanInviter = inviterRow.user_handle.replace(/^@+/, '').trim().toLowerCase();

  if (cleanInviter === cleanInvitee) {
    return { success: false, error: 'Cannot refer yourself' };
  }

  const inviterUser = await db.prepare(`
    SELECT phone FROM users
    WHERE LOWER(handle) = LOWER(?) OR LOWER(handle) = LOWER(?)
    LIMIT 1
  `).bind(cleanInviter, `@${cleanInviter}`).first() as any;

  if (inviterUser && inviterUser.phone && inviteeUser.phone && inviterUser.phone === inviteeUser.phone) {
    return { success: false, error: 'Multiple accounts with the same phone number are blocked' };
  }

  const sharedDevice = await db.prepare(`
    SELECT d1.installation_id FROM devices d1
    JOIN devices d2 ON d1.installation_id = d2.installation_id
    WHERE (LOWER(d1.user_handle) = LOWER(?) OR LOWER(d1.user_handle) = LOWER(?))
      AND (LOWER(d2.user_handle) = LOWER(?) OR LOWER(d2.user_handle) = LOWER(?))
    LIMIT 1
  `).bind(cleanInviter, `@${cleanInviter}`, cleanInvitee, `@${cleanInvitee}`).first() as any;

  if (sharedDevice) {
    return { success: false, error: 'Multiple accounts on the same device are blocked' };
  }

  if (cleanDeviceId) {
    const inviterUsedDevice = await db.prepare(`
      SELECT installation_id FROM devices
      WHERE installation_id = ? AND (LOWER(user_handle) = LOWER(?) OR LOWER(user_handle) = LOWER(?))
      LIMIT 1
    `).bind(cleanDeviceId, cleanInviter, `@${cleanInviter}`).first() as any;

    if (inviterUsedDevice) {
      return { success: false, error: 'Multiple accounts on the same device are blocked' };
    }

    const deviceAlreadyUsedInReferrals = await db.prepare(`
      SELECT id FROM referrals
      WHERE device_id = ? AND device_id != ''
      LIMIT 1
    `).bind(cleanDeviceId).first() as any;

    if (deviceAlreadyUsedInReferrals) {
      return { success: false, error: 'This device has already been used for a referral' };
    }
  }

  const existingReferral = await db.prepare(`
    SELECT id FROM referrals
    WHERE LOWER(invitee_handle) = LOWER(?) OR LOWER(invitee_handle) = LOWER(?)
    LIMIT 1
  `).bind(cleanInvitee, `@${cleanInvitee}`).first();

  if (existingReferral) {
    return { success: false, error: 'You have already applied a referral code' };
  }

  const now = new Date();
  const currentMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const monthlyInvites = await db.prepare(`
    SELECT COUNT(*) as cnt FROM referrals
    WHERE LOWER(inviter_handle) = LOWER(?)
      AND status = 'rewarded'
      AND created_at >= ?
  `).bind(cleanInviter, currentMonthStart).first() as any;

  if ((monthlyInvites?.cnt || 0) >= 5) {
    return { success: false, error: 'Inviter has reached the limit of 5 rewarded invites for this month' };
  }

  return { success: true, inviterHandle: inviterRow.user_handle };
}

export async function checkAndFlagDailyCapAbuse(
  db: any,
  userHandle: string,
  todayDate: string
): Promise<boolean> {
  const cleanHandle = userHandle.replace(/^@+/, '').trim();

  const consecutiveDaysRow = await db.prepare(`
    SELECT COUNT(*) as count FROM user_daily_rewards
    WHERE user_handle = ?
      AND daily_points >= 50
      AND date >= date(?, '-4 days')
      AND date <= ?
  `).bind(cleanHandle, todayDate, todayDate).first() as any;

  const count = consecutiveDaysRow?.count ?? 0;

  if (count >= 5) {
    await db.prepare(`
      UPDATE user_rewards
      SET consecutive_cap_days = ?,
          is_flagged = 1,
          flagged_reason = 'Hit daily points cap 5 consecutive days',
          updated_at = CURRENT_TIMESTAMP
      WHERE user_handle = ?
    `).bind(count, cleanHandle).run();

    const flagId = `flag_${Date.now()}_${cleanHandle}`;
    await db.prepare(`
      INSERT OR IGNORE INTO abuse_flags (id, user_handle, flag_type, reason, details_json, status, created_at)
      VALUES (?, ?, 'five_day_cap_streak', 'User hit the daily cap 5 days in a row', ?, 'pending_review', CURRENT_TIMESTAMP)
    `).bind(flagId, cleanHandle, JSON.stringify({ consecutiveDays: count, date: todayDate })).run();

    return true;
  }

  return false;
}
