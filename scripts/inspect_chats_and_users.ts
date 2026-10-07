import { D1Client } from '../src/db/d1_http_client';

try {
  process.loadEnvFile();
} catch (e) {}

async function main() {
  const db = new D1Client();
  const chats = await db.query('SELECT * FROM chats');
  console.log('CHATS:', JSON.stringify(chats.results, null, 2));

  const users = await db.query('SELECT id, phone, handle, created_at FROM users');
  console.log('USERS:', JSON.stringify(users.results, null, 2));

  const profiles = await db.query('SELECT handle, user_id, display_name FROM profiles');
  console.log('PROFILES:', JSON.stringify(profiles.results, null, 2));
}

main().catch(console.error);
