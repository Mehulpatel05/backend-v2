-- ==========================================================
-- 0006_name_handle_cooldown.sql
-- Tracking Name and Handle Update Cooldowns
-- Full Name: 14 Days Cooldown
-- Username / Handle: 30 Days (1 Month) Cooldown
-- ==========================================================

ALTER TABLE profiles ADD COLUMN name_updated_at TIMESTAMP NULL;
ALTER TABLE profiles ADD COLUMN handle_updated_at TIMESTAMP NULL;
