CREATE TABLE IF NOT EXISTS cities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    state_id TEXT DEFAULT 'GJ',
    lat REAL DEFAULT 0,
    lng REAL DEFAULT 0,
    pincode TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS city_areas (
    id TEXT PRIMARY KEY,
    city_id TEXT NOT NULL,
    name TEXT NOT NULL,
    pincode TEXT DEFAULT '',
    lat REAL,
    lng REAL,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(city_id) REFERENCES cities(id) ON DELETE CASCADE
);

ALTER TABLE cities ADD COLUMN state TEXT DEFAULT 'GJ';
ALTER TABLE cities ADD COLUMN country TEXT DEFAULT 'IN';
ALTER TABLE cities ADD COLUMN center_lat REAL DEFAULT 22.3072;
ALTER TABLE cities ADD COLUMN center_lng REAL DEFAULT 73.1812;
ALTER TABLE cities ADD COLUMN radius_km REAL DEFAULT 30;
ALTER TABLE cities ADD COLUMN is_enabled INTEGER DEFAULT 1;

UPDATE cities 
SET center_lat = COALESCE(NULLIF(lat, 0), 22.3072),
    center_lng = COALESCE(NULLIF(lng, 0), 73.1812),
    state = COALESCE(NULLIF(state, ''), COALESCE(NULLIF(state_id, ''), 'GJ')),
    country = 'IN',
    radius_km = 30,
    is_enabled = COALESCE(is_active, 1)
WHERE id = 'GJ-VAD';

CREATE INDEX IF NOT EXISTS idx_cities_enabled ON cities(is_enabled);

CREATE TABLE IF NOT EXISTS areas (
    id TEXT PRIMARY KEY,
    city_id TEXT NOT NULL,
    name TEXT NOT NULL,
    place_id TEXT UNIQUE NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(city_id) REFERENCES cities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_areas_place_id ON areas(place_id);
CREATE INDEX IF NOT EXISTS idx_areas_city_id ON areas(city_id);

INSERT OR IGNORE INTO areas (id, city_id, name, place_id, lat, lng, created_at)
SELECT id, city_id, name, 'seed_' || id, COALESCE(lat, 22.3072), COALESCE(lng, 73.1812), created_at
FROM city_areas;

CREATE TABLE IF NOT EXISTS waitlist (
    id TEXT PRIMARY KEY,
    city_text TEXT NOT NULL,
    lat REAL,
    lng REAL,
    contact_or_device_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(contact_or_device_id, city_text)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_city ON waitlist(city_text, status);
CREATE INDEX IF NOT EXISTS idx_waitlist_device ON waitlist(contact_or_device_id);

ALTER TABLE users ADD COLUMN area_id TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN address_note TEXT DEFAULT '';

ALTER TABLE profiles ADD COLUMN home_city_id TEXT DEFAULT 'GJ-VAD';
ALTER TABLE profiles ADD COLUMN home_area_id TEXT DEFAULT '';
ALTER TABLE profiles ADD COLUMN home_area_name TEXT DEFAULT '';
ALTER TABLE profiles ADD COLUMN address_note TEXT DEFAULT '';
