CREATE TABLE IF NOT EXISTS civic_places (
    id TEXT PRIMARY KEY,
    city_id TEXT NOT NULL DEFAULT 'GJ-VAD',
    area_id TEXT,
    osm_id TEXT NOT NULL,
    osm_type TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    sub_category TEXT DEFAULT '',
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    address TEXT DEFAULT '',
    pincode TEXT DEFAULT '',
    opening_hours TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    website TEXT DEFAULT '',
    is_verified INTEGER DEFAULT 0,
    claimed_by_handle TEXT,
    source TEXT DEFAULT 'OpenStreetMap',
    license TEXT DEFAULT 'ODbL',
    attribution TEXT DEFAULT '© OpenStreetMap contributors',
    metadata_json TEXT DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(osm_type, osm_id)
);

CREATE INDEX IF NOT EXISTS idx_civic_places_city_cat ON civic_places(city_id, category);
CREATE INDEX IF NOT EXISTS idx_civic_places_coords ON civic_places(lat, lng);

CREATE TABLE IF NOT EXISTS place_claim_requests (
    id TEXT PRIMARY KEY,
    place_id TEXT NOT NULL,
    requester_handle TEXT NOT NULL,
    business_proof_note TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    admin_notes TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE feed_posts ADD COLUMN post_type TEXT DEFAULT 'community';
ALTER TABLE feed_posts ADD COLUMN is_pinned INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_feed_city_pinned ON feed_posts(city_id, is_pinned, created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS civic_places_fts USING fts5(id UNINDEXED, name, category, sub_category, address);
CREATE VIRTUAL TABLE IF NOT EXISTS feed_posts_fts USING fts5(id UNINDEXED, content, category, area_name);
