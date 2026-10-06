import { D1Client } from '../src/db/d1_http_client';

try {
  process.loadEnvFile();
} catch (e) {}

async function main() {
  const db = new D1Client();
  const query = `
    SELECT p.*, pr.display_name, pr.avatar_r2_path, pr.is_verified, pr.bio, af.seq AS founder_seq
    FROM feed_posts p
    LEFT JOIN profiles pr ON (LOWER(p.author_handle) = LOWER(pr.handle) OR LOWER(p.author_handle) = '@' || LOWER(pr.handle) OR '@' || LOWER(p.author_handle) = LOWER(pr.handle))
    LEFT JOIN area_founders af ON (LOWER(af.user_id) = LOWER(p.author_handle) OR LOWER(af.user_id) = LOWER(REPLACE(p.author_handle, '@', '')))
    WHERE (p.status = 'active' OR p.status IS NULL OR p.status = '')
    ORDER BY p.created_at DESC LIMIT 10
  `;
  const res = await db.query(query);
  console.log('QUERY RESULT:', JSON.stringify(res, null, 2));
}

main().catch(console.error);
