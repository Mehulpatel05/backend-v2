const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT_URL || 'https://87ada6dd807f3958d8cb396b5211662c.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const bucketName = process.env.R2_BUCKET_NAME || 'nearhood';
const assetsDir = path.join(__dirname, '..', '..', 'assets', 'images');

const mimeTypes = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

async function uploadAssets() {
  if (!fs.existsSync(assetsDir)) {
    console.error('Assets dir not found:', assetsDir);
    return;
  }

  const files = fs.readdirSync(assetsDir);
  console.log(`Found ${files.length} asset files to upload to R2 bucket "${bucketName}"...`);

  const results = {};

  for (const file of files) {
    const filePath = path.join(assetsDir, file);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;

    const ext = path.extname(file).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const fileBuffer = fs.readFileSync(filePath);
    const r2Key = `app/static/${file}`;

    console.log(`Uploading ${file} (${stat.size} bytes) -> ${r2Key}...`);

    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: r2Key,
        Body: fileBuffer,
        ContentType: contentType,
      })
    );

    const publicProxyUrl = `http://3.109.213.23/api/v2/media/file/${r2Key}`;
    results[file] = {
      r2Key,
      publicUrl: publicProxyUrl,
      size: stat.size,
      contentType,
    };
    console.log(`  Uploaded! URL: ${publicProxyUrl}`);
  }

  console.log('\n=== ALL ASSETS UPLOADED TO R2 SUCCESSFULLY ===');
  console.log(JSON.stringify(results, null, 2));
}

uploadAssets().catch((err) => {
  console.error('Upload failed:', err);
  process.exit(1);
});
