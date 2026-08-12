# Backups

The production Postgres DB on Railway is backed up once a day to S3 by a dedicated cron service. Custom-format `pg_dump` to a private, versioned, lifecycle-bounded bucket; cron credentials are write-only; restore reads go through a separate admin profile. Media is not part of this dump; it is protected separately by cross-region replication, see [Media replication](#media-replication).

---

## Automated backups

A dedicated Railway service `backend-backup` (image built from [`docker/backup/`](../docker/backup/)) runs daily at 00:00 UTC (cron expression `0 0 * * *`, config-as-code in [`docker/backup/railway.json`](../docker/backup/railway.json)), takes a `pg_dump --format=custom --no-owner --no-acl`, inspects the dump's TOC with `pg_restore --list`, and uploads to `s3://<backup-bucket>/YYYY/MM/DD/vidit-<UTC-timestamp>.dump`. The TOC check catches corruption of the TOC itself, not mid-DATA truncation; only the quarterly drill verifies restorability.

The bucket has versioning + SSE-S3 + all-public-access blocked; lifecycle clears noncurrent versions after 30 days, aborted multipart uploads after 7, and current objects after 365.

The cron container's `pg_dump` is pinned to PG 16 to match the production server. **Don't bump this without bumping prod first**: `pg_dump` 18 writes archive format 1.16 which PG 16's `pg_restore` refuses to read.

The service writes through a dedicated IAM user `<backup-iam-user>` whose only S3 permissions are `PutObject` / `AbortMultipartUpload` / `ListMultipartUploadParts` on `<backup-bucket>/*`, no `Get`, no `Delete`.

The `backend-backup` service has Root Directory `docker/backup`, so Railway discovers [`docker/backup/railway.json`](../docker/backup/railway.json) on deploy and its `cronSchedule` wins over the dashboard field. The service deploys through the [`deploy` workflow](../.github/workflows/deploy.yml) like every other backend service; redeploying a cron service also runs it once, so every backend deploy takes a fresh dump as a side effect.

### Required env vars on the `backend-backup` service

| Var | Source |
|-----|--------|
| `DATABASE_URL` | Railway reference: `${{backend.DATABASE_URL}}` (internal `*.railway.internal` host). Reference `backend.DATABASE_URL`, not `postgres-db.DATABASE_URL`: Railway injects it on consumers, not the DB service. |
| `BACKUP_S3_BUCKET` | `<backup-bucket>` |
| `AWS_ACCESS_KEY_ID` | from `<backup-iam-user>` IAM user |
| `AWS_SECRET_ACCESS_KEY` | from `<backup-iam-user>` IAM user |
| `AWS_DEFAULT_REGION` | `eu-west-3` |
| `HEALTHCHECK_PING_URL` | The healthchecks.io check's ping URL. Optional: the script skips the ping when unset. |

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

A 403 on `PutObject` exits non-zero; Railway logs it on the `backend-backup` deployment view and does not retry (`restartPolicyType: NEVER`): a failed run shows failed immediately, and the next scheduled run is the retry. No alert on a missed daily dump today (Sentry catches runtime exceptions only). Discovery is manual:

1. **Daily after 00:00 UTC**, eyeball the bucket:
   ```bash
   aws --profile <s3-admin> s3 ls s3://<backup-bucket>/ --recursive | tail -3
   ```
   A fresh `.dump` under today's `YYYY/MM/DD/` prefix means the cron ran. If the latest dump is from a prior day, read the `backend-backup` deployment logs in Railway.
2. **At the quarterly restore drill**, re-list the bucket; gaps in the daily cadence catch any failure mode that the script's own exit code missed (e.g. a successful upload of a corrupt dump).

`backup.sh` pings `HEALTHCHECK_PING_URL` after a successful run when that variable is set (see the env var table above). Once a healthchecks.io check (or equivalent) is created and wired to it, the check alerts on a *missed* ping, covering a failed run, a cron that never fires, and a dump that hangs mid-`pg_dump`, none of which the manual bucket check catches between visits. No check is provisioned yet; the daily eyeball above stays the active discovery path until one is.

---

## Restore drill

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

**1. Snapshot before deploying.** Don't wait for the next scheduled run, and don't count the dump a deploy itself triggers as the pre-migration snapshot (the matrix jobs run in parallel, so nothing orders it before the migration). Trigger the `backend-backup` service on demand first:

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
- **2c. Full restore** (data corruption, or downgrade isn't safe): the [restore drill](#restore-drill) above is the validated `pg_restore` procedure. Live restore: run `pg_restore` from a one-off `postgres:16` container on the Railway network, or temporarily open public DB networking. `pg_restore --clean --if-exists` **wipes anything added since the snapshot**; for partial recovery, restore into a scratch DB and copy specific tables out.

A dedicated restore job is not yet scheduled.

---

## Media replication

Media protection is replication, not backup. The `pg_dump` cron above never touches `<media-bucket>`; that is deliberate, keep it that way. Adding media to the dump script would duplicate protection the replication below already provides, at the cost of a dump too large to run daily.

`<media-bucket>` (region `eu-west-3`) replicates cross-region to `<replica-bucket>` (region `eu-west-1`) via S3 Replication Configuration, through IAM role `<replication-role>` (trusted by `s3.amazonaws.com`, permissions limited to reading the replication config and object versions on the source, and `ReplicateObject` / `ReplicateTags` on the destination). Six rules cover the content prefixes: `uploads/`, `bounty_uploads/`, `proof/`, `demo-pool/`, `landing/`, `detected/` (machine-detection media, written via `services/storage.py::detected_media_key`). `archive-imports/` is deliberately excluded: it holds staged personal X exports on a 7-day TTL, and replicating that prefix into a locked bucket would retain personal data for a year past the point the source copy expires. A feature that introduces a new content prefix must also add a replication rule for it, the same checklist item the runtime IAM user's own policy carries (see the Media row in [`engineering.md`](engineering.md#deployment)); a missed rule fails silently, writes succeed, nothing replicates, and the gap surfaces only at restore time. Delete marker replication is off, so a delete on the source never hides the replica copy; a destructive mistake on `<media-bucket>` leaves the replica intact for a normal restore, not just for the lock period.

`<replica-bucket>` has Object Lock enabled with a default GOVERNANCE retention of 365 days. All public access is blocked, SSE-S3 encrypts at rest, and a lifecycle rule aborts incomplete multipart uploads after 7 days. A bucket policy (`DenyDestroyExceptRoot`) denies `s3:DeleteObject`, `s3:DeleteObjectVersion`, `s3:BypassGovernanceRetention`, `s3:PutBucketPolicy`, `s3:DeleteBucketPolicy`, and `s3:DeleteBucket` to every principal except the account root: a non-root principal cannot delete an existing version, bypass the lock, or change the bucket policy. The policy does not cover `s3:PutObject` or `s3:PutLifecycleConfiguration`: a non-root principal, including a stolen or misused `<s3-admin>` key, can still write new object versions to `<replica-bucket>` and can still schedule a lifecycle change; deletion of an already-locked version stays impossible until its own retention date regardless of what a new lifecycle rule schedules. Closing both gaps (deny `s3:PutObject` to everyone but the replication role, deny lifecycle and Object Lock configuration changes to everyone but root) is tracked in [`planning/next.md`](../planning/next.md).

An object that arrives via replication carries the source object's own retention (mode and retain-until date, computed at original upload). An object written directly to `<replica-bucket>` (the initial seed) gets the bucket default instead, GOVERNANCE for 365 days.

`<media-bucket>` itself has a bucket-wide lifecycle rule aborting incomplete multipart uploads after 7 days, alongside the existing `archive-imports/` rule (7-day expiry on current and noncurrent versions, 7-day multipart abort).

**Threat model.** A stolen or misused `<s3-admin>` key cannot delete an existing version on `<replica-bucket>`, bypass its lock, or change its bucket policy: the deny policy blocks those actions for every principal but the account root, whatever permissions the key's own IAM policy grants. The same holds against a human operator mistake (a wrong `--recursive` flag) or an agent mistake (an automated tool with `<s3-admin>` credentials issuing a destructive call): what already exists on `<replica-bucket>` survives. The same key can still read from `<replica-bucket>`, and, until the policy hardening above lands, can still write new versions and schedule a lifecycle change; a locked version cannot be deleted before its retention date regardless. A regional outage or data-loss event in `eu-west-3` leaves `<replica-bucket>` in `eu-west-1` unaffected, since it is a separate region with its own infrastructure.

**Verifying replication is live.** Write a small canary object under a replicated prefix on `<media-bucket>`, wait a few minutes, then compare `ReplicationStatus` via `head-object`: `COMPLETED` on the source object, `REPLICA` on the object at the same key in `<replica-bucket>`.

**Restore path.** A blanket sync from `<replica-bucket>` back into `<media-bucket>` (or into a rebuilt bucket) covers the source-loss and mass-delete cases:

```bash
aws --profile <s3-admin> s3 sync s3://<replica-bucket>/ s3://<media-bucket>/
```

Two cases need selective handling instead of the blanket sync:

- **Overwrite recovery.** A corrupted current version replicates too, so the replica's current object is corrupt the same way the source is. Restore those keys from the replica's noncurrent versions instead: `aws s3api list-object-versions` to find the version that predates the corruption, then `aws s3api get-object --version-id <id>`.
- **Hard-deleted media.** Media removed through the admin hard-delete paths (moderation takedowns, GDPR erasure) survives on the replica, because delete markers do not replicate. A blanket sync resurrects it. Restore selectively (excluding the hard-deleted keys) or re-run the hard-deletes after a full restore.

No special handling is needed to read from `<replica-bucket>`: it is a normal S3 bucket, just one that no non-root principal can delete an existing version from or strip the lock on.

`<replica-bucket>`'s lifecycle carries only the 7-day abort-incomplete-multipart rule; noncurrent versions are never expired there, deliberately, since they are the recovery copies the overwrite case above restores from. Revisit if replica storage cost becomes visible.
