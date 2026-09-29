import { D1Client } from '../src/db/d1_http_client';

try {
  process.loadEnvFile();
} catch (e) {}

async function main() {
  const db = new D1Client();
  console.log('Fixing existing image URLs in D1...');

  const updateSql = `
    UPDATE feed_posts
    SET image_url = REPLACE(image_url, 'https://pub-87ada6dd807f3958d8cb396b5211662c.r2.dev', 'https://backend-v2-cu1p.onrender.com/api/v2/media/file'),
        media_urls_json = REPLACE(media_urls_json, 'https://pub-87ada6dd807f3958d8cb396b5211662c.r2.dev', 'https://backend-v2-cu1p.onrender.com/api/v2/media/file')
    WHERE image_url LIKE '%pub-87ada6dd807f3958d8cb396b5211662c.r2.dev%'
       OR media_urls_json LIKE '%pub-87ada6dd807f3958d8cb396b5211662c.r2.dev%';
  `;

  const res = await db.query(updateSql);
  console.log('Result:', res);

  const posts = await db.query('SELECT id, author_handle, image_url, media_urls_json FROM feed_posts ORDER BY created_at DESC LIMIT 5');
  console.log('Current posts:', JSON.stringify(posts.results, null, 2));
}

main().catch(console.error);
