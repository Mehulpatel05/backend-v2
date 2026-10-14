CREATE TABLE IF NOT EXISTS area_change_requests (
    id TEXT PRIMARY KEY,
    user_handle TEXT NOT NULL,
    current_city_id TEXT NOT NULL,
    current_area_id TEXT NOT NULL,
    current_area_name TEXT NOT NULL,
    requested_city_id TEXT NOT NULL,
    requested_area_id TEXT NOT NULL,
    requested_area_name TEXT NOT NULL,
    reason TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    admin_notes TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP NULL,
    reviewed_by TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_area_requests_user ON area_change_requests(user_handle, status);
CREATE INDEX IF NOT EXISTS idx_area_requests_status ON area_change_requests(status, created_at DESC);
