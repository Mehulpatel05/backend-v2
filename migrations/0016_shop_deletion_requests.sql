CREATE TABLE IF NOT EXISTS shop_deletion_requests (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    owner_handle TEXT NOT NULL,
    shop_name TEXT NOT NULL,
    reason TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    admin_notes TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP NULL,
    reviewed_by TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_shop_deletion_owner ON shop_deletion_requests(owner_handle, status);
CREATE INDEX IF NOT EXISTS idx_shop_deletion_status ON shop_deletion_requests(status, created_at DESC);
