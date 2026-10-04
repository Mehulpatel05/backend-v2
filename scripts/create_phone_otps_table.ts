import { SqliteD1Adapter } from '../src/db/sqlite_engine';

async function main() {
  const db = new SqliteD1Adapter();
  console.log('Creating phone_otps table on Cloudflare D1 / SQLite...');
  
  const query = `
    CREATE TABLE IF NOT EXISTS phone_otps (
        phone TEXT PRIMARY KEY,
        otp_code TEXT NOT NULL,
        request_id TEXT NOT NULL,
        attempts INTEGER DEFAULT 0,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  
  const res = await db.prepare(query).run();
  console.log('Result:', res);
  
  const indexQuery = `CREATE INDEX IF NOT EXISTS idx_phone_otps_req ON phone_otps(request_id);`;
  const indexRes = await db.prepare(indexQuery).run();
  console.log('Index Result:', indexRes);
  
  console.log('✅ phone_otps table successfully ready in database.');
}

main().catch(console.error);
