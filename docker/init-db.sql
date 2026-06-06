-- Enable core extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- AI / Similarity
CREATE EXTENSION IF NOT EXISTS vector;

-- Text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Automation (requires shared_preload_libraries in postgresql.conf).
-- pg_cron can only live in the database named by cron.database_name (default: postgres).
\c postgres
CREATE EXTENSION IF NOT EXISTS pg_cron;
\c vision

-- Graph Database (Apache AGE)
-- Note: Must be loaded via shared_preload_libraries
CREATE EXTENSION IF NOT EXISTS age;
SET search_path = public, ag_catalog;
