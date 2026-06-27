# Backups

The production Postgres DB on Railway is backed up once a week to S3 by a dedicated cron service. Custom-format `pg_dump` to a private, versioned, lifecycle-bounded bucket; cron credentials are write-only; restore reads go through a separate admin profile.

---

## Weekly automated backups

A dedicated Railway service `backend-backup` (image built from [`docker/backup/`](../docker/backup/)) runs every Monday at 00:00 UTC (cron expression `0 0 * * MON`), takes a `pg_dump --format=custom --no-owner --no-acl`, inspects the dump's TOC with `pg_restore --list`, and uploads to `s3://<backup-bucket>/YYYY/MM/DD/vidit-<UTC-timestamp>.dump`. The TOC check catches corruption of the TOC itself, not mid-DATA truncation; only the quarterly drill verifies restorability.

The bucket has versioning + SSE-S3 + all-public-access blocked; lifecycle clears noncurrent versions after 30 days, aborted multipart uploads after 7, and current objects after 365.

The cron container's `pg_dump` is pinned to PG 16 to match the production server. **Don't bump this without bumping prod first**: `pg_dump` 18 writes archive format 1.16 which PG 16's `pg_restore` refuses to read.

The service writes through a dedicated IAM user `<backup-iam-user>` whose only S3 permissions are `PutObject` / `AbortMultipartUpload` / `ListMultipartUploadParts` on `<backup-bucket>/*`, no `Get`, no `Delete`.

### Required env vars on the `backend-backup` service

| Var | Source |
|-----|--------|
| `DATABASE_URL` | Railway reference: `${{backend.DATABASE_URL}}` (internal `*.railway.internal` host). Reference `backend.DATABASE_URL`, not `postgres-db.DATABASE_URL`: Railway injects it on consumers, not the DB service. |
| `BACKUP_S3_BUCKET` | `<backup-bucket>` |
| `AWS_ACCESS_KEY_ID` | from `<backup-iam-user>` IAM user |
| `AWS_SECRET_ACCESS_KEY` | from `<backup-iam-user>` IAM user |
| `AWS_DEFAULT_REGION` | `eu-west-3` |

### Restoring from a weekly backup

Use the `<s3-admin>` profile locally. Configure it under `~/.aws/config`, pointing at IAM principal `<s3-admin>` in account `<aws-account-id>`. Ask the maintainer for the credentials.

```bash
# Pick the most recent dump from S3
aws --profile <s3-admin> s3 ls s3://<backup-bucket>/ --recursive | tail -5

# Download
aws --profile <s3-admin> s3 cp s3://<backup-bucket>/YYYY/MM/DD/vidit-<ts>.dump ./vidit.dump

# Restore (wipes the target DB)
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$TARGET_DATABASE_URL" ./vidit.dump
```

The target DB must have the same extensions installed as production. Today the dump only references `postgis`, `postgis_topology`, `postgis_tiger_geocoder`, `fuzzystrmatch`, all present in both the stock `postgis/postgis:16-3.4` image and the custom one in [`docker/Dockerfile`](../docker/Dockerfile). Adding `vector` / `pg_cron` / `age` to prod would break restores into stock Postgres.

---

## How you find out the cron failed

A 403 on `PutObject` exits non-zero; Railway logs it on the `backend-backup` deployment view. No alert on a missed Monday dump (Sentry catches runtime exceptions only). Discovery is manual:

1. **Mondays after 00:00 UTC**, eyeball the bucket:
   ```bash
   aws --profile <s3-admin> s3 ls s3://<backup-bucket>/ --recursive | tail -3
   ```
   A fresh `.dump` under today's `YYYY/MM/DD/` prefix means the cron ran. If the latest dump is from the prior week, read the `backend-backup` deployment logs in Railway.
2. **At the quarterly restore drill**, re-list the bucket; gaps in the weekly cadence catch any failure mode that the script's own exit code missed (e.g. a successful upload of a corrupt dump).

---

## One-time restore drill

Run this once after the first weekly backup lands, then quarterly thereafter. The drill restores into a scratch DB inside the local container (commands resolve the container ID dynamically):

```bash
# 1. Make sure the local dev DB container is up
docker compose ps                                              # should show `db` running

# 2. Pick + download the latest weekly dump from S3
aws --profile <s3-admin> s3 ls s3://<backup-bucket>/ --recursive | tail -1
aws --profile <s3-admin> s3 cp s3://<backup-bucket>/YYYY/MM/DD/vidit-<ts>.dump /tmp/vidit-drill.dump

# 3. Copy the dump into the running container and create an empty scratch DB
DB=$(docker compose ps -q db)
docker cp /tmp/vidit-drill.dump "${DB}:/tmp/vidit.dump"
docker compose exec db psql -U vision -d postgres -c "CREATE DATABASE vidit_restore_drill;"

# 4. Restore into the scratch DB (--no-owner --no-acl mirrors the dump flags)
docker compose exec db pg_restore --no-owner --no-acl \
    --dbname=postgresql://vision:vision@localhost:5432/vidit_restore_drill \
    /tmp/vidit.dump

# 5. Sanity check: row counts on the tables that matter, alembic head, PostGIS smoke test
docker compose exec db psql -U vision -d vidit_restore_drill -c "
    SELECT 'users' AS t, COUNT(*) FROM users
    UNION ALL SELECT 'geolocations', COUNT(*) FROM geolocations
    UNION ALL SELECT 'media', COUNT(*) FROM media
    UNION ALL SELECT 'bounties', COUNT(*) FROM bounties
    UNION ALL SELECT 'follows', COUNT(*) FROM follows
    UNION ALL SELECT 'tags', COUNT(*) FROM tags
    UNION ALL SELECT 'invite_codes', COUNT(*) FROM invite_codes
    ORDER BY 1;
    SELECT version_num FROM alembic_version;
    SELECT ST_GeomFromText('POINT(2.349 48.864)', 4326) IS NOT NULL AS postgis_works;
"

# 6. Tear down: drop the scratch DB and clean the dump artifacts
docker compose exec db psql -U vision -d postgres -c "DROP DATABASE vidit_restore_drill;"
docker compose exec db rm -f /tmp/vidit.dump
rm -f /tmp/vidit-drill.dump
```

The drill works against either PG version locally: `pg_restore` is forward-compatible, so a PG-16 dump from the cron restores cleanly into a local PG 16 *or* PG 18 server.

If steps 4-5 return plausible counts and the PostGIS smoke test returns `t`, the dump is restorable. Record the date and dump filename in `CHANGELOG.md` (under `### Operations`, e.g. "Restore drill verified YYYY-MM-DD against `vidit-<ts>.dump`").

---

## Manual snapshot and rollback

The release ritual around a deploy that ships a migration. Migrations run as a Railway pre-deploy step (`uv run alembic upgrade head`); a failed one retries 3× then leaves the service failed with the schema half-applied. **Get a fresh backup before any deploy that includes a migration.**

Two constraints shape how this works (see [`engineering.md`](engineering.md) → *Deployment* and *Particularities*): prod DB **public networking is off**; and the backend container ships only `libpq5`, **not** the `pg_dump` / `pg_restore` client binaries (those live in the `backend-backup` cron image, `postgres:16`).

**1. Snapshot before deploying.** Don't wait for the Monday run; trigger the `backend-backup` service on demand:

```
Railway dashboard → project `vidit` → service `backend-backup` → Deployments → Redeploy
```

Confirm a fresh object lands under today's `YYYY/MM/DD/` prefix before deploying.

**If a deploy goes wrong, recover in this order:**

- **2a. Code-only rollback** (no schema change involved): re-run the [`deploy` workflow](../.github/workflows/deploy.yml) with the previous tag, or hit "Redeploy previous" on the Railway `backend` service. No DB touch.
- **2b. Schema downgrade** (undo one migration, keep data): run Alembic inside the app container, where the internal `DATABASE_URL` already points at the live DB and `alembic` is installed (it's the pre-deploy hook):
  ```bash
  railway ssh --service backend -- 'uv run alembic downgrade -1'
  ```
- **2c. Full restore** (data corruption, or downgrade isn't safe): the [restore drill](#one-time-restore-drill) below is the validated `pg_restore` procedure. Live restore: run `pg_restore` from a one-off `postgres:16` container on the Railway network, or temporarily open public DB networking. `pg_restore --clean --if-exists` **wipes anything added since the snapshot**; for partial recovery, restore into a scratch DB and copy specific tables out.

A dedicated restore job is not yet scheduled.
