import { D1Client } from '../src/db/d1_http_client';

try {
  process.loadEnvFile();
} catch (e) {}

async function main() {
  const db = new D1Client();
  const users = await db.query('SELECT handle, phone_number, created_at FROM users');
  console.log('users in D1:', users.results);

  const profiles = await db.query('SELECT handle, display_name FROM profiles');
  console.log('profiles in D1:', profiles.results);

  const feed = await db.query('SELECT id, author_handle, content FROM feed_posts LIMIT 5');
  console.log('feed_posts in D1:', feed.results);
}

main().catch(console.error);
