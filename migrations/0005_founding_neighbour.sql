CREATE TABLE IF NOT EXISTS founding_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    area_id TEXT NOT NULL,
    city_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP NULL,
    reviewed_by TEXT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_founding_requests_active_user ON founding_requests(user_id) WHERE status IN ('pending', 'approved');
CREATE INDEX IF NOT EXISTS idx_founding_requests_area_status ON founding_requests(area_id, status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_founding_requests_city ON founding_requests(city_id, status);

CREATE TABLE IF NOT EXISTS area_founders (
    area_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    seq INTEGER NOT NULL CHECK(seq >= 1 AND seq <= 100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(area_id, user_id),
    UNIQUE(area_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_area_founders_area ON area_founders(area_id, seq ASC);
CREATE INDEX IF NOT EXISTS idx_area_founders_user ON area_founders(user_id);
