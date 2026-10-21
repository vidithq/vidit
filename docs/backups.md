# Backups

An instance dumps its database daily to off-host storage, and cross-region replication protects media separately.

```mermaid
flowchart LR
  classDef spec fill:#eef1fb,stroke:#4a5fa5,color:#33417a
  classDef shared fill:#e3f2f1,stroke:#0f7b7a,color:#0b5c5b
  classDef core fill:#0f7b7a,stroke:#083f3e,stroke-width:3px,color:#ffffff
  classDef store fill:#0b5c5b,stroke:#083f3e,color:#ffffff

  subgraph legend [Legend]
    direction LR
    l1["`a recovery path`"]:::spec
    l2["`a scheduled or managed writer`"]:::shared
    l3["`the production data`"]:::core
    l4[("`a protective copy`")]:::store
    l1 ~~~ l2 ~~~ l3 ~~~ l4
  end

  db[("`**database**
  PostgreSQL 16 + PostGIS 3`")]:::core
  media[("`**media bucket**
  versioned, Object-Locked`")]:::core
  cron["`**daily dump job**
  pg_dump, pg_restore --list`"]:::shared
  bak[("`**backup storage**
  write-only credentials, expiring dumps`")]:::store
  repl["`**bucket replication**
  one rule per content prefix, no delete markers`"]:::shared
  replica[("`**replica bucket**
  another region, Object Lock, deny-destroy policy`")]:::store

  r2a["`**2a code rollback**
  redeploy the previous tag`"]:::spec
  r2b["`**2b schema downgrade**
  alembic downgrade -1`"]:::spec
  r2c["`**2c full restore**
  pg_restore from a dump`"]:::spec
  rsync["`**media restore**
  s3 sync or per-version get`"]:::spec

  db --> cron --> bak
  media --> repl --> replica
  bak --> r2c --> db
  r2b --> db
  r2a -. "no database change" .-> db
  replica --> rsync --> media
```

[Automated backups](#automated-backups) covers the dump job and the backup storage. [Manual snapshot and rollback](#manual-snapshot-and-rollback) covers paths 2a, 2b and 2c. [Media replication](#media-replication) covers the replica bucket and the media restore.

---

## Automated backups

Run a daily job that dumps the database and uploads the dump to storage outside the database host. The job does three things:

1. It takes `pg_dump --format=custom --no-owner --no-acl` of `DATABASE_URL`.
2. It reads the dump's table of contents (TOC) with `pg_restore --list`. This catches corruption in the TOC itself. It does not catch mid-data truncation. Only the [restore drill](#restore-drill) verifies that a dump restores.
3. It uploads the dump under a dated key, for example `YYYY/MM/DD/vidit-<UTC-timestamp>.dump`.

Pin the `pg_dump` client to the major version of the database server, PostgreSQL 16. **Do not upgrade the client without upgrading the server first**: `pg_dump` 18 writes archive format 1.16, which PG 16's `pg_restore` cannot read. The `postgres:16` image carries a matching client. The backend image carries none.

Give the job write-only credentials on the backup storage: put object and multipart upload, with no read and no delete permission. A leaked job key then cannot read or destroy the dumps. Turn on versioning and encryption at rest on the backup storage, block public access, and expire old dumps with a lifecycle rule.

### Restoring from a backup

```bash
# Download a dump from the backup storage
aws s3 cp s3://<backup-bucket>/YYYY/MM/DD/vidit-<ts>.dump ./vidit.dump

# Restore (wipes the target DB)
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$TARGET_DATABASE_URL" ./vidit.dump
```

The target database must have the same extensions installed as the source. The dump references only `postgis`, `postgis_topology`, `postgis_tiger_geocoder`, and `fuzzystrmatch`. The stock `postgis/postgis:16-3.4` image includes all four, and [`docker-compose.yml`](../docker-compose.yml) runs that same image locally. Adding an extension to the database that this image does not carry breaks restores into stock Postgres.

---

## How you find out a backup failed

Sentry catches only runtime exceptions, so a missed daily dump raises no Sentry alert. Make the job exit non-zero on any failure, and watch for the dump itself:

1. **Wire a missed-run alert.** Have the job ping a heartbeat check after each successful upload, such as a healthchecks.io check. The check alerts on a missed ping: a failed run, a schedule that never fires, or a dump that hangs mid-`pg_dump`.
2. **Without a heartbeat check, list the backup storage daily.** A fresh `.dump` under today's `YYYY/MM/DD/` prefix means the job ran.
3. **At the quarterly restore drill**, list the backup storage again. Gaps in the daily cadence reveal failure modes that the exit code misses, for example a successful upload of a corrupt dump.

---

## Restore drill

Run this drill once, after the first backup lands. Repeat it quarterly. The drill restores into a scratch database inside the local container. The commands resolve the container ID dynamically:

```bash
# 1. Make sure the local dev DB container is up
docker compose ps                                              # should show `db` running

# 2. Download the latest dump from the backup storage
aws s3 cp s3://<backup-bucket>/YYYY/MM/DD/vidit-<ts>.dump /tmp/vidit-drill.dump

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

The local container runs PG 16, the major version of the instance database, so the drill exercises the version pair a restore uses.

If steps 4 and 5 return plausible counts and the PostGIS smoke test returns `t`, the dump is restorable. Record the date and the dump filename.

---

## Manual snapshot and rollback

Follow this procedure for a deploy that ships a migration. The `migrate` [role](engineering.md#backend-roles) runs `alembic upgrade head` before the new `api` release takes traffic. A migration that fails partway can leave the schema half-applied. **Take a fresh backup before any deploy that includes a migration.**

**1. Snapshot before deploying.** Do not wait for the next scheduled run. Do not count a dump that runs alongside the deploy as the pre-migration snapshot: nothing orders it before the migration. Run the dump job on demand, and confirm a fresh object appears under today's `YYYY/MM/DD/` prefix before you deploy.

**If a deploy goes wrong, recover in this order:**

- **2a. Code-only rollback** (no schema change involved). Deploy the previous tag to every role ([`engineering.md`](engineering.md#deployment)), without the `migrate` step. This does not touch the database.
- **2b. Schema downgrade** (undo one migration, keep data). Run Alembic through the backend image of the current release, with the instance's `DATABASE_URL`:
  ```bash
  docker run --rm --env-file <instance env> <backend image> alembic history -r-2:current
  docker run --rm --env-file <instance env> <backend image> alembic downgrade -1
  ```
  Stepping back from the baseline migration (see [`engineering.md`](engineering.md#migration-house-style)) drops every table, so this path applies only while the deploy added a revision on top of it. Otherwise go to 2c. Roll the code back with the schema (2a): a scheduler service that starts on code whose head is ahead of the database waits for the head, then exits non-zero after 10 minutes (see [`engineering.md`](engineering.md#scheduler-services)).
- **2c. Full restore** (data corruption, or downgrade is not safe). The [restore drill](#restore-drill) above is the validated `pg_restore` procedure. For a live restore, run `pg_restore` from a one-off `postgres:16` container that reaches the database. `pg_restore --clean --if-exists` **wipes anything added since the snapshot**. For partial recovery, restore into a scratch database and copy out specific tables.

No scheduled job runs a restore; every restore is manual.

---

## Media replication

Media protection relies on replication, not backup. The database dump never touches the media bucket: adding media would duplicate what replication provides, with a dump too large to run daily.

Replicate the media bucket to a replica bucket in another region, with one replication rule per content prefix. The code writes these prefixes: `uploads/`, `bounty_uploads/`, `proof/`, `demo-pool/`, `detected/` (machine-detection media, written through `services/storage.py::detected_media_key`), and `avatars/` (profile pictures, written through `services/storage.py::upload_avatar_image`). Add a rule for any prefix you upload to by hand, such as the one that holds the landing demo video. `avatars/` is personal data, and it is replicated for the same reason `proof/` is: nothing regenerates it, so the copy on the media bucket is the only one.

Exclude `archive-imports/`: it holds staged personal X exports on a 7-day expiry, and replicating it into a locked bucket would retain personal data for a year past the point the source copy expires.

A feature that introduces a new content prefix must also add a replication rule for it, the same checklist item the runtime credentials carry (see the media bucket settings in [`engineering.md`](engineering.md#deployment)). A missed rule fails silently: writes succeed, nothing replicates, and the gap surfaces only at restore time.

Turn delete marker replication off, so a delete on the source never hides the replica copy. A destructive mistake on the media bucket then leaves the replica intact for a normal restore, not only for the lock period.

Protect the replica bucket:

- Turn on Object Lock with a default GOVERNANCE retention, block all public access, and encrypt data at rest.
- Add a lifecycle rule that aborts incomplete multipart uploads after 7 days. Never expire noncurrent versions there, because they are the recovery copies the overwrite case restores from.
- Add a bucket policy that denies `s3:DeleteObject`, `s3:DeleteObjectVersion`, `s3:BypassGovernanceRetention`, `s3:PutBucketPolicy`, `s3:DeleteBucketPolicy`, and `s3:DeleteBucket` to every principal except the account root.

A non-root principal then cannot delete an existing version, bypass the lock, or change the bucket policy. The policy does not cover `s3:PutObject` or `s3:PutLifecycleConfiguration`, so a non-root principal with admin credentials can still write new object versions and schedule a lifecycle change. Deletion of an already-locked version stays impossible until its own retention date, regardless of what a new lifecycle rule schedules.

An object that arrives through replication carries the source object's own retention: mode and retain-until date, computed at original upload. An object written directly to the replica bucket (the initial seed) gets the bucket default instead.

**Threat model.** The deny policy holds against an operator mistake, such as a wrong `--recursive` flag, and against an automated tool holding admin credentials: what already exists on the replica bucket survives. A regional outage or data loss in the media bucket's region leaves the replica unaffected.

### Media lifecycle

The media bucket carries two lifecycle rules:

- A bucket-wide rule aborts incomplete multipart uploads after 7 days.
- The `archive-imports/` rule expires current objects after 7 days, expires noncurrent versions after 7 days (`NoncurrentVersionExpiration`), and aborts incomplete multipart uploads after 7 days. The noncurrent half is required: with versioning on, the import worker's delete writes only a delete marker, so without it every raw personal X export would persist as a noncurrent version. The bucket's Object Lock default retention still sets the earliest date a version can disappear.

**Verifying replication is live.** Write a small canary object under a replicated prefix on the media bucket. Wait a few minutes, then compare `ReplicationStatus` through `head-object`: `COMPLETED` on the source object, `REPLICA` on the object at the same key in the replica bucket.

**Restore path.** A blanket sync from the replica bucket back into the media bucket (or into a rebuilt bucket) covers the source-loss and mass-delete cases:

```bash
aws s3 sync s3://<replica-bucket>/ s3://<media-bucket>/
```

Two cases need selective handling instead of the blanket sync:

- **Overwrite recovery.** A corrupted current version replicates too, so the replica's current object is corrupt the same way the source is. Restore those keys from the replica's noncurrent versions instead: `aws s3api list-object-versions` to find the version that predates the corruption, then `aws s3api get-object --version-id <id>`.
- **Hard-deleted media.** Media removed through the admin hard-delete paths (moderation takedowns, GDPR erasure) survives on the replica, because delete markers do not replicate. A blanket sync resurrects it. Restore selectively (excluding the hard-deleted keys) or re-run the hard-deletes after a full restore.

Reading from the replica bucket needs no special handling. It is a normal S3 bucket, except that no non-root principal can delete an existing version from it or strip its lock.
