import { D1Client } from '../src/db/d1_http_client';

try {
  process.loadEnvFile();
} catch (e) {}

async function main() {
  const db = new D1Client();
  const feed = await db.query('SELECT id, author_handle, content, city_id, area_id, status, created_at FROM feed_posts');
  console.log('ALL FEED POSTS:', JSON.stringify(feed.results, null, 2));
}

main().catch(console.error);
