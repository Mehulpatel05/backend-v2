import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { R2UserStorageHelper } from '../../utils/r2_helper';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const mediaApp = new Hono<{ Bindings: Env; Variables: Variables }>();

let s3Client: S3Client | null = null;
function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT_URL || '',
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
      },
    });
  }
  return s3Client;
}

// 1. Direct Multipart/Binary Media Upload into User-Dedicated R2 Folder
mediaApp.post('/upload', authMiddleware, async (c) => {
  const user = c.get('user');
  const query = c.req.query();
  const folder = query.folder || 'profile';
  const subId = query.subId || '';

  const formData = await c.req.parseBody().catch(() => ({}));
  const file = formData['file'];

  if (!file || !(file instanceof File)) {
    return c.json({ success: false, error: 'Valid file is required under "file" field' }, 400);
  }

  let r2Path = '';
  const filename = file.name || 'upload.jpg';

  switch (folder) {
    case 'profile':
      r2Path = R2UserStorageHelper.getProfilePath(user.userHandle, filename);
      break;
    case 'feed':
      r2Path = R2UserStorageHelper.getFeedPostPath(user.userHandle, subId || 'post', filename);
      break;
    case 'bazar_shop':
      r2Path = R2UserStorageHelper.getBazarShopPath(user.userHandle, subId || 'shop', filename);
      break;
    case 'bazar':
    case 'bazar_listing':
      r2Path = R2UserStorageHelper.getBazarListingPath(user.userHandle, subId || 'listing', filename);
      break;
    case 'chat':
      r2Path = R2UserStorageHelper.getChatMediaPath(user.userHandle, subId || 'dm', filename);
      break;
    case 'audio':
      r2Path = R2UserStorageHelper.getAudioPath(user.userHandle, filename);
      break;
    default:
      r2Path = `${R2UserStorageHelper.getUserRoot(user.userHandle)}/misc/${Date.now()}_${filename}`;
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = file.type || 'application/octet-stream';

  if (c.env && c.env.MEDIA_BUCKET) {
    await c.env.MEDIA_BUCKET.put(r2Path, arrayBuffer, {
      httpMetadata: { contentType },
      customMetadata: { uploadedBy: user.userHandle },
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
        Metadata: { uploadedBy: user.userHandle },
      })
    );
  }

  const publicPrefix = process.env.R2_PUBLIC_URL_PREFIX || '';
  const publicUrl = publicPrefix ? `${publicPrefix}/${r2Path}` : `/api/v2/media/file/${r2Path}`;

  return c.json({
    success: true,
    r2Path,
    publicUrl,
    message: `File stored in user folder: ${r2Path}`,
  });
});

// 2. Stream / Serve File from R2
mediaApp.get('/file/*', async (c) => {
  const path = c.req.path.replace('/api/v2/media/file/', '');
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

      const stream = response.Body as any;
      return new Response(stream, { headers });
    } catch {
      return c.json({ success: false, error: 'File not found' }, 404);
    }
  }
});

export { mediaApp };
