import fs from 'fs';
import path from 'path';
import { D1Client } from '../src/db/d1_http_client';

// Load .env manually if process.loadEnvFile isn't available
try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile();
  } else {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const idx = trimmed.indexOf('=');
          if (idx > 0) {
            const key = trimmed.slice(0, idx).trim();
            const val = trimmed.slice(idx + 1).trim();
            process.env[key] = val.replace(/^["']|["']$/g, '');
          }
        }
      }
    }
  }
} catch (e) {}

async function main() {
  const db = new D1Client();
  console.log('Connecting to D1 and checking feed_posts schema...');

  const info = await db.query('PRAGMA table_info(feed_posts)');
  console.log('Current feed_posts columns:', info.results);

  // Add all post attributes needed for rich posts
  const columnsToAdd = [
    { name: 'category', def: "TEXT DEFAULT 'general'" },
    { name: 'city_id', def: "TEXT DEFAULT ''" },
    { name: 'area_id', def: "TEXT DEFAULT ''" },
    { name: 'area_name', def: "TEXT DEFAULT ''" },
    { name: 'image_url', def: "TEXT DEFAULT ''" },
    { name: 'upvotes', def: 'INTEGER DEFAULT 0' },
    { name: 'downvotes', def: 'INTEGER DEFAULT 0' },
    { name: 'report_count', def: 'INTEGER DEFAULT 0' },
    { name: 'reporters_json', def: "TEXT DEFAULT '[]'" },
    { name: 'lat', def: 'REAL' },
    { name: 'lng', def: 'REAL' },
    { name: 'room_title', def: "TEXT DEFAULT ''" },
    { name: 'room_area', def: "TEXT DEFAULT ''" },
    { name: 'room_rent', def: "TEXT DEFAULT ''" },
    { name: 'shop_title', def: "TEXT DEFAULT ''" },
    { name: 'shop_price', def: "TEXT DEFAULT ''" },
    { name: 'shop_category', def: "TEXT DEFAULT ''" },
    { name: 'food_title', def: "TEXT DEFAULT ''" },
    { name: 'food_rating', def: 'REAL' },
    { name: 'food_price', def: "TEXT DEFAULT ''" },
    { name: 'event_title', def: "TEXT DEFAULT ''" },
    { name: 'event_date', def: "TEXT DEFAULT ''" },
    { name: 'event_location_text', def: "TEXT DEFAULT ''" },
    { name: 'event_price', def: "TEXT DEFAULT ''" },
    { name: 'job_title', def: "TEXT DEFAULT ''" },
    { name: 'job_company', def: "TEXT DEFAULT ''" },
    { name: 'job_location', def: "TEXT DEFAULT ''" },
    { name: 'job_type', def: "TEXT DEFAULT ''" },
    { name: 'service_title', def: "TEXT DEFAULT ''" },
    { name: 'service_category_text', def: "TEXT DEFAULT ''" },
    { name: 'service_price', def: "TEXT DEFAULT ''" },
    { name: 'extra_json', def: "TEXT DEFAULT '{}'" },
  ];

  const existingColNames = new Set((info.results || []).map((col: any) => col.name));

  for (const col of columnsToAdd) {
    if (!existingColNames.has(col.name)) {
      console.log(`Adding column ${col.name}...`);
      try {
        await db.query(`ALTER TABLE feed_posts ADD COLUMN ${col.name} ${col.def}`);
        console.log(`✓ Added column ${col.name}`);
      } catch (e: any) {
        console.error(`Failed to add column ${col.name}:`, e.message);
      }
    } else {
      console.log(`Column ${col.name} already exists.`);
    }
  }

  // Create post votes table for tracking upvotes/downvotes per user
  await db.query(`
    CREATE TABLE IF NOT EXISTS post_votes (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_handle TEXT NOT NULL,
      vote_type INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id, user_handle),
      FOREIGN KEY(post_id) REFERENCES feed_posts(id) ON DELETE CASCADE,
      FOREIGN KEY(user_handle) REFERENCES users(handle) ON DELETE CASCADE
    );
  `);

  console.log('Done upgrading schema!');
}

main().catch(console.error);
