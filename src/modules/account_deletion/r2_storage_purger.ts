import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { AppConfig } from '../../utils/config';

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

export interface R2PurgeResult {
  success: boolean;
  deletedCount: number;
  prefixesChecked: string[];
  error?: string;
}

export async function purgeUserR2Media(rawHandle: string): Promise<R2PurgeResult> {
  const cleanHandle = (rawHandle || '').replace(/^@+/, '').trim().toLowerCase();
  if (!cleanHandle) {
    return { success: true, deletedCount: 0, prefixesChecked: [] };
  }

  const client = getS3Client();
  const bucket = AppConfig.r2Bucket;
  if (!client || !bucket) {
    console.warn('[R2Purge] S3/R2 client not configured. Skipping object storage wipe.');
    return { success: true, deletedCount: 0, prefixesChecked: [] };
  }

  const prefixesToPurge = [
    `users/@${cleanHandle}/`,
    `users/${cleanHandle}/`,
    `avatars/@${cleanHandle}/`,
    `avatars/${cleanHandle}/`,
    `banners/@${cleanHandle}/`,
    `banners/${cleanHandle}/`,
    `posts/@${cleanHandle}/`,
    `posts/${cleanHandle}/`,
    `chat_media/@${cleanHandle}/`,
    `chat_media/${cleanHandle}/`,
    `audio/@${cleanHandle}/`,
    `audio/${cleanHandle}/`,
  ];

  let totalDeleted = 0;

  try {
    for (const prefix of prefixesToPurge) {
      let continuationToken: string | undefined = undefined;
      do {
        const listCmd: ListObjectsV2Command = new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        });

        const listRes = await client.send(listCmd);
        const objects = listRes.Contents || [];

        if (objects.length > 0) {
          const deleteKeys = objects
            .map((obj) => obj.Key)
            .filter((key): key is string => Boolean(key))
            .map((Key) => ({ Key }));

          if (deleteKeys.length > 0) {
            const deleteCmd = new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: deleteKeys, Quiet: true },
            });
            await client.send(deleteCmd);
            totalDeleted += deleteKeys.length;
          }
        }

        continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : undefined;
      } while (continuationToken);
    }

    return {
      success: true,
      deletedCount: totalDeleted,
      prefixesChecked: prefixesToPurge,
    };
  } catch (err: any) {
    console.error('[R2Purge] Error purging user R2 objects:', err);
    return {
      success: false,
      deletedCount: totalDeleted,
      prefixesChecked: prefixesToPurge,
      error: err?.message || String(err),
    };
  }
}
