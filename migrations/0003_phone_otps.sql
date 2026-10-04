-- ==========================================================
-- 3. PHONE OTP VERIFICATION TABLE
-- Stores server-generated OTP codes with 5-minute expiry and attempt tracking
-- ==========================================================

CREATE TABLE IF NOT EXISTS phone_otps (
    phone TEXT PRIMARY KEY,
    otp_code TEXT NOT NULL,
    request_id TEXT NOT NULL,
    attempts INTEGER DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_phone_otps_req ON phone_otps(request_id);
