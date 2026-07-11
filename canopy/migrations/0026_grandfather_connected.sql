-- 0026_grandfather_connected.sql — defensive: any repo row that predates the 0024
-- status column default (or was seeded before this) is marked connected so the
-- single-tenant repo keeps its hub after cutover. Idempotent; no-op on fresh installs.
UPDATE repos SET status = 'connected' WHERE status IS NULL OR status = '';
