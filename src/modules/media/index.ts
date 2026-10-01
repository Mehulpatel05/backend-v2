import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { R2UserStorageHelper } from '../../utils/r2_helper';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfig } from '../../utils/config';

const mediaApp = new Hono<{ Bindings: Env; Variables: Variables }>();

let s3Client: S3Client | null = null;
function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: AppConfig.r2Endpoint,
      credentials: {
        accessKeyId: AppConfig.r2AccessKeyId,
        secretAccessKey: AppConfig.r2SecretAccessKey,
      },
    });
  }
  return s3Client;
}

// Always return backend proxy URL — R2 bucket is private (not public)
// Backend proxies the file from R2 with its own credentials
function getProxyUrl(c: any, r2Path: string): string {
  const rawHost = c.req.header('host') || '3.109.213.23';
  const host = rawHost.replace(/:\d+$/, '');
  const isIp = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
  const protoHeader = c.req.header('x-forwarded-proto');
  const protocol = protoHeader ? protoHeader : (isIp ? 'http' : 'https');
  return `${protocol}://${rawHost}/api/v2/media/file/${r2Path}`;
}


// 1. Direct Multipart/Binary Media Upload into User-Dedicated R2 Folder
// Uses authMiddleware so we always get the real user handle from D1
mediaApp.post('/upload', authMiddleware, async (c) => {
  const user = c.get('user');
  const userHandle = (user?.userHandle || 'anonymous').replace(/^@+/, '').trim().toLowerCase() || 'anonymous';

  const query = c.req.query();
  const folder = query.folder || 'feed';
  const subId = query.subId || '';

  const formData = (await c.req.parseBody().catch(() => ({}))) as Record<string, any>;
  const file = formData['file'] || formData['media'] || formData['image'];

  if (!file || !(file instanceof File)) {
    return c.json({ success: false, error: 'Valid file is required under "file" field' }, 400);
  }

  let r2Path = '';
  const filename = file.name || `upload_${Date.now()}.jpg`;

  switch (folder) {
    case 'profile':
      r2Path = R2UserStorageHelper.getProfilePath(userHandle, filename);
      break;
    case 'feed':
    case 'posts':
      r2Path = R2UserStorageHelper.getFeedPostPath(userHandle, subId || 'post', filename);
      break;
    case 'bazar_shop':
      r2Path = R2UserStorageHelper.getBazarShopPath(userHandle, subId || 'shop', filename);
      break;
    case 'bazar':
    case 'bazar_listing':
      r2Path = R2UserStorageHelper.getBazarListingPath(userHandle, subId || 'listing', filename);
      break;
    case 'chat':
      r2Path = R2UserStorageHelper.getChatMediaPath(userHandle, subId || 'dm', filename);
      break;
    case 'audio':
      r2Path = R2UserStorageHelper.getAudioPath(userHandle, filename);
      break;
    default:
      r2Path = `${R2UserStorageHelper.getUserRoot(userHandle)}/misc/${Date.now()}_${filename}`;
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = file.type || 'image/jpeg';

  if (c.env && c.env.MEDIA_BUCKET) {
    await c.env.MEDIA_BUCKET.put(r2Path, arrayBuffer, {
      httpMetadata: { contentType },
      customMetadata: { uploadedBy: userHandle },
    });
  } else {
    const client = getS3Client();
    const bucket = process.env.R2_BUCKET_NAME || 'nearhood';
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: r2Path,
        Body: buffer,
        ContentType: contentType,
        Metadata: { uploadedBy: userHandle },
      })
    );
  }

  // Always return backend proxy URL (not direct R2 — bucket is private)
  const publicUrl = getProxyUrl(c, r2Path);

  return c.json({
    success: true,
    url: publicUrl,
    imageUrl: publicUrl,
    mediaUrl: publicUrl,
    fileUrl: publicUrl,
    publicUrl: publicUrl,
    r2Path,
    message: `File stored successfully in ${r2Path}`,
  });
});

// 2. Presigned Upload URL Generator
mediaApp.post('/presigned-url', authMiddleware, async (c) => {
  const user = c.get('user');
  const userHandle = (user?.userHandle || 'anonymous').replace(/^@+/, '').trim().toLowerCase() || 'anonymous';

  const body = await c.req.json().catch(() => ({}));
  const filename = body.filename || `file_${Date.now()}.jpg`;
  const contentType = body.contentType || 'image/jpeg';
  const moduleType = body.moduleType || 'posts';
  const listingId = body.listingId || 'generic';

  const r2Path = R2UserStorageHelper.getFeedPostPath(userHandle, listingId, filename);
  const publicUrl = getProxyUrl(c, r2Path);

  try {
    const client = getS3Client();
    const bucket = process.env.R2_BUCKET_NAME || 'nearhood';
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: r2Path,
      ContentType: contentType,
      Metadata: { uploadedBy: userHandle },
    });

    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 3600 });

    return c.json({
      success: true,
      uploadUrl,
      publicUrl,
      r2Path,
    });
  } catch (err: any) {
    const rawHost = c.req.header('host') || 'backend-v2-cu1p.onrender.com';
    const host = rawHost.replace(/:\d+$/, '');
    const protocol = c.req.header('x-forwarded-proto') || 'https';
    const base = `${protocol}://${host}`;
    return c.json({
      success: true,
      uploadUrl: `${base}/api/v2/media/upload?folder=${moduleType}&subId=${listingId}`,
      publicUrl,
      r2Path,
    });
  }
});

// 3. Stream / Serve File from R2 (Proxy — works because backend has R2 credentials)
mediaApp.get('/file/*', async (c) => {
  const path = c.req.path.replace(/^\/api\/v2\/(media|storage)\/file\//, '');
  if (!path) {
    return c.json({ success: false, error: 'Invalid path' }, 400);
  }

  if (c.env && c.env.MEDIA_BUCKET) {
    const object = await c.env.MEDIA_BUCKET.get(path);
    if (!object) {
      return c.json({ success: false, error: 'File not found' }, 404);
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return new Response(object.body, { headers });
  } else {
    try {
      const client = getS3Client();
      const bucket = process.env.R2_BUCKET_NAME || 'nearhood';
      const command = new GetObjectCommand({ Bucket: bucket, Key: path });
      const response = await client.send(command);

      const headers = new Headers();
      if (response.ContentType) headers.set('Content-Type', response.ContentType);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('Access-Control-Allow-Origin', '*');

      const stream = response.Body as any;
      return new Response(stream, { headers });
    } catch {
      return c.json({ success: false, error: 'File not found' }, 404);
    }
  }
});

// 4. CDN Prewarm
mediaApp.post('/cdn-prewarm', async (c) => {
  return c.json({
    success: true,
    message: 'CDN prewarm initiated',
  });
});

export { mediaApp };
