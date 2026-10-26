import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { AppConfig } from './config';
import { R2UserStorageHelper } from './r2_helper';

let s3ClientInstance: S3Client | null = null;

function getS3Client(): S3Client | null {
  if (!AppConfig.r2AccessKeyId || !AppConfig.r2SecretAccessKey || !AppConfig.r2Endpoint) {
    return null;
  }
  if (!s3ClientInstance) {
    s3ClientInstance = new S3Client({
      region: 'auto',
      endpoint: AppConfig.r2Endpoint,
      credentials: {
        accessKeyId: AppConfig.r2AccessKeyId,
        secretAccessKey: AppConfig.r2SecretAccessKey,
      },
    });
  }
  return s3ClientInstance;
}

async function writeJsonToR2(r2Path: string, data: any, c?: any): Promise<boolean> {
  const jsonString = JSON.stringify(data, null, 2);
  const buffer = Buffer.from(jsonString, 'utf-8');

  try {
    if (c?.env?.MEDIA_BUCKET) {
      await c.env.MEDIA_BUCKET.put(r2Path, buffer, {
        httpMetadata: { contentType: 'application/json' },
      });
      return true;
    }

    const client = getS3Client();
    const bucket = AppConfig.r2Bucket;
    if (!client || !bucket) return false;

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: r2Path,
        Body: buffer,
        ContentType: 'application/json',
      })
    );
    return true;
  } catch (error) {
    console.error(`[D1UserSync] Failed to write ${r2Path}:`, error);
    return false;
  }
}

export async function syncUserProfileToD1Folder(db: any, rawHandle: string, c?: any): Promise<void> {
  const clean = R2UserStorageHelper.cleanHandle(rawHandle);
  if (!clean) return;

  try {
    const profile = await db.prepare(
      `SELECT p.*, u.phone, u.created_at as account_created_at
       FROM profiles p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE LOWER(p.handle) = LOWER(?) OR LOWER(p.handle) = LOWER(?)
       LIMIT 1`
    ).bind(clean, `@${clean}`).first();

    if (!profile) return;

    const r2Path = R2UserStorageHelper.getD1DataPath(clean, 'profile');
    await writeJsonToR2(r2Path, {
      syncedAt: new Date().toISOString(),
      userHandle: `@${clean}`,
      profile,
    }, c);
  } catch (err) {
    console.error(`[D1UserSync] Profile sync error for @${clean}:`, err);
  }
}

export async function syncUserFeedPostsToD1Folder(db: any, rawHandle: string, c?: any): Promise<void> {
  const clean = R2UserStorageHelper.cleanHandle(rawHandle);
  if (!clean) return;

  try {
    const { results } = await db.prepare(
      `SELECT * FROM feed_posts
       WHERE LOWER(author_handle) = LOWER(?) OR LOWER(author_handle) = LOWER(?)
       ORDER BY created_at DESC`
    ).bind(clean, `@${clean}`).all();

    const r2Path = R2UserStorageHelper.getD1DataPath(clean, 'feed_posts');
    await writeJsonToR2(r2Path, {
      syncedAt: new Date().toISOString(),
      userHandle: `@${clean}`,
      count: results?.length ?? 0,
      posts: results || [],
    }, c);
  } catch (err) {
    console.error(`[D1UserSync] Feed posts sync error for @${clean}:`, err);
  }
}

export async function syncUserBazarToD1Folder(db: any, rawHandle: string, c?: any): Promise<void> {
  const clean = R2UserStorageHelper.cleanHandle(rawHandle);
  if (!clean) return;

  try {
    const shopsRes = await db.prepare(
      `SELECT * FROM bazar_shops
       WHERE LOWER(owner_handle) = LOWER(?) OR LOWER(owner_handle) = LOWER(?)`
    ).bind(clean, `@${clean}`).all();

    const listingsRes = await db.prepare(
      `SELECT * FROM bazar_listings
       WHERE LOWER(seller_handle) = LOWER(?) OR LOWER(seller_handle) = LOWER(?)
       ORDER BY created_at DESC`
    ).bind(clean, `@${clean}`).all();

    const r2Path = R2UserStorageHelper.getD1DataPath(clean, 'bazar');
    await writeJsonToR2(r2Path, {
      syncedAt: new Date().toISOString(),
      userHandle: `@${clean}`,
      shops: shopsRes?.results || [],
      listings: listingsRes?.results || [],
    }, c);
  } catch (err) {
    console.error(`[D1UserSync] Bazar sync error for @${clean}:`, err);
  }
}

export async function syncUserChatsToD1Folder(db: any, rawHandle: string, c?: any): Promise<void> {
  const clean = R2UserStorageHelper.cleanHandle(rawHandle);
  if (!clean) return;

  try {
    const chatsRes = await db.prepare(
      `SELECT * FROM chats
       WHERE LOWER(user1_handle) = LOWER(?) OR LOWER(user2_handle) = LOWER(?)
          OR LOWER(user1_handle) = LOWER(?) OR LOWER(user2_handle) = LOWER(?)
       ORDER BY updated_at DESC`
    ).bind(clean, clean, `@${clean}`, `@${clean}`).all();

    const r2Path = R2UserStorageHelper.getD1DataPath(clean, 'chats');
    await writeJsonToR2(r2Path, {
      syncedAt: new Date().toISOString(),
      userHandle: `@${clean}`,
      activeChatsCount: chatsRes?.results?.length ?? 0,
      chats: chatsRes?.results || [],
    }, c);
  } catch (err) {
    console.error(`[D1UserSync] Chats sync error for @${clean}:`, err);
  }
}

export async function syncUserPreferencesToD1Folder(db: any, rawHandle: string, c?: any): Promise<void> {
  const clean = R2UserStorageHelper.cleanHandle(rawHandle);
  if (!clean) return;

  try {
    const prefs = await db.prepare(
      `SELECT * FROM user_preferences
       WHERE LOWER(user_handle) = LOWER(?) OR LOWER(user_handle) = LOWER(?)
       LIMIT 1`
    ).bind(clean, `@${clean}`).first();

    const r2Path = R2UserStorageHelper.getD1DataPath(clean, 'preferences');
    await writeJsonToR2(r2Path, {
      syncedAt: new Date().toISOString(),
      userHandle: `@${clean}`,
      preferences: prefs || null,
    }, c);
  } catch (err) {
    console.error(`[D1UserSync] Preferences sync error for @${clean}:`, err);
  }
}

export async function syncAllUserDataToD1Folder(db: any, rawHandle: string, c?: any): Promise<void> {
  await Promise.allSettled([
    syncUserProfileToD1Folder(db, rawHandle, c),
    syncUserFeedPostsToD1Folder(db, rawHandle, c),
    syncUserBazarToD1Folder(db, rawHandle, c),
    syncUserChatsToD1Folder(db, rawHandle, c),
    syncUserPreferencesToD1Folder(db, rawHandle, c),
  ]);
}
