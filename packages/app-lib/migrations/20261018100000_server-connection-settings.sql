-- Global server connection settings, editable from the launcher's settings
-- page instead of being frozen into the binary at build time.
--
-- Both columns store an empty string for "not configured". The frontend then
-- resolves the effective value in this order:
--
--   1. the stored setting (only when it is non-empty and valid),
--   2. the build-time environment value (VITE_AXO_SERVER_ADDRESS /
--      VITE_AXO_WEB_MAP_URL), so a pre-configured binary keeps working,
--   3. the placeholder in `apps/app-frontend/src/server-config.ts`
--      (`example.invalid` for the address, empty for the map).
--
-- Purely additive: an existing install gets '' in both columns, which means
-- "no stored value", so it keeps behaving exactly as it did before this
-- migration — the build-time value still applies. No existing data is touched.
ALTER TABLE settings ADD COLUMN server_address TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN server_map_url TEXT NOT NULL DEFAULT '';
