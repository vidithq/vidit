# Backups

The production Postgres DB on Railway is backed up once a day to S3 by a dedicated cron service. Custom-format `pg_dump` to a private, versioned, lifecycle-bounded bucket; cron credentials are write-only; restore reads go through a separate admin profile. Media is not part of this dump; it is protected separately by cross-region replication, see [Media replication](#media-replication).

---

## Automated backups

A dedicated Railway service `backend-backup` (image built from [`docker/backup/`](../docker/backup/)) runs daily at 00:00 UTC (cron expression `0 0 * * *`, config-as-code in [`docker/backup/railway.json`](../docker/backup/railway.json)), takes a `pg_dump --format=custom --no-owner --no-acl`, inspects the dump's TOC with `pg_restore --list`, and uploads to `s3://<backup-bucket>/YYYY/MM/DD/vidit-<UTC-timestamp>.dump`. The TOC check catches corruption of the TOC itself, not mid-DATA truncation; only the quarterly drill verifies restorability.

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

### Restoring from a backup

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

A 403 on `PutObject` exits non-zero; Railway logs it on the `backend-backup` deployment view. No alert on a missed daily dump (Sentry catches runtime exceptions only). Discovery is manual:

1. **Daily after 00:00 UTC**, eyeball the bucket:
   ```bash
   aws --profile <s3-admin> s3 ls s3://<backup-bucket>/ --recursive | tail -3
   ```
   A fresh `.dump` under today's `YYYY/MM/DD/` prefix means the cron ran. If the latest dump is from a prior day, read the `backend-backup` deployment logs in Railway.
2. **At the quarterly restore drill**, re-list the bucket; gaps in the daily cadence catch any failure mode that the script's own exit code missed (e.g. a successful upload of a corrupt dump).

---

## One-time restore drill

Run this once after the first backup lands, then quarterly thereafter. The drill restores into a scratch DB inside the local container (commands resolve the container ID dynamically):

```bash
# 1. Make sure the local dev DB container is up
docker compose ps                                              # should show `db` running

# 2. Pick + download the latest dump from S3
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
    UNION ALL SELECT 'events', COUNT(*) FROM events
    UNION ALL SELECT 'media', COUNT(*) FROM media
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

**1. Snapshot before deploying.** Don't wait for the next scheduled run; trigger the `backend-backup` service on demand:

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

---

## Media replication

Media protection is replication, not backup. The `pg_dump` cron above never touches `<media-bucket>`; that is deliberate, keep it that way. Adding media to the dump script would duplicate protection the replication below already provides, at the cost of a dump too large to run daily.

`<media-bucket>` (region `eu-west-3`) replicates cross-region to `<replica-bucket>` (region `eu-west-1`) via S3 Replication Configuration, through IAM role `<replication-role>` (trusted by `s3.amazonaws.com`, permissions limited to reading the replication config and object versions on the source, and `ReplicateObject` / `ReplicateTags` on the destination). Five rules cover the content prefixes: `uploads/`, `bounty_uploads/`, `proof/`, `demo-pool/`, `landing/`. `archive-imports/` is deliberately excluded: it holds staged personal X exports on a 7-day TTL, and replicating that prefix into a locked bucket would retain personal data for a year past the point the source copy expires. Delete marker replication is off, so a delete on the source never hides the replica copy; a destructive mistake on `<media-bucket>` leaves the replica intact for a normal restore, not just for the lock period.

`<replica-bucket>` has Object Lock enabled with a default GOVERNANCE retention of 365 days, so every replicated object inherits that lock on arrival (replicas also inherit the source object's own retention). All public access is blocked, SSE-S3 encrypts at rest, and a lifecycle rule aborts incomplete multipart uploads after 7 days. A bucket policy (`DenyDestroyExceptRoot`) denies `s3:DeleteObject`, `s3:DeleteObjectVersion`, `s3:BypassGovernanceRetention`, `s3:PutBucketPolicy`, `s3:DeleteBucketPolicy`, and `s3:DeleteBucket` to every principal except the account root. Only root, through the console with MFA, can lift the policy or delete anything on `<replica-bucket>`.

**Threat model.** A stolen or misused `<s3-admin>` key can delete or overwrite objects on `<media-bucket>`, but cannot touch `<replica-bucket>`: the deny-destroy policy blocks every non-root principal regardless of what permissions their IAM policy grants. The same holds for a human operator mistake (a wrong `--recursive` flag) or an agent mistake (an automated tool with `<s3-admin>` credentials issuing a destructive call): the replica sits behind the account root, not behind any credential that routine operations or automation ever hold. A regional outage or data-loss event in `eu-west-3` leaves `<replica-bucket>` in `eu-west-1` unaffected, since it is a separate region with its own infrastructure.

`<media-bucket>` itself also gained a bucket-wide lifecycle rule aborting incomplete multipart uploads after 7 days, alongside the existing `archive-imports/` rule (7-day expiry on current and noncurrent versions, 7-day multipart abort).

**Verification.** Existing objects were seeded into `<replica-bucket>` with a server-side sync on 2026-08-12. Live replication was verified end to end with a canary object: source `ReplicationStatus` reached `COMPLETED`, the replica object shows status `REPLICA` and is locked until 2027-08-12. The only keys that did not carry over from the seed are two zero-byte console folder markers, which hold no data.

**Restore path.** To recover media, sync from `<replica-bucket>` back into `<media-bucket>` (or point the app at a rebuilt bucket) using the `<s3-admin>` profile:

```bash
aws --profile <s3-admin> s3 sync s3://<replica-bucket>/ s3://<media-bucket>/
```

No special handling is needed to read from `<replica-bucket>`: it is a normal S3 bucket, just one that nothing but root can write to or delete from.

**Cost.** Lifecycle expiry on `<backup-bucket>` (the `pg_dump` target) is unchanged at 365 days; the daily cadence above does not change that number, since storage cost at this catalog size is negligible either way.
