#!/bin/bash
# Stream pg_dump of $DATABASE_URL to s3://$BACKUP_S3_BUCKET/YYYY/MM/DD/vidit-<ts>.dump.
# Dumps to a temp file first and inspects the TOC with `pg_restore --list` before
# uploading. This catches a corrupt TOC or a dump truncated before the TOC was
# written — but NOT a dump that crashed mid-DATA after the TOC was committed
# (the TOC is at a known position and `--list` returns 0 in that case). The
# inline check is a cheap floor; the real "this dump can be restored" verifier
# is the quarterly drill in ../../docs/backups.md. Don't trust the inline
# verify alone.
#
# Shebang is bash (not sh): debian-bookworm's /bin/sh is dash, which doesn't
# support `set -o pipefail` — the safety net we want against the next maintainer
# adding a pipe. Bash 5.2 ships in the postgres:16-bookworm image at /usr/bin/bash.

set -eu -o pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
DATE_PREFIX=$(date -u +%Y/%m/%d)
KEY="${DATE_PREFIX}/vidit-${TIMESTAMP}.dump"
TMP=/tmp/vidit.dump

log() { echo "[backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

cleanup() { rm -f "${TMP}"; }
trap cleanup EXIT

log "starting pg_dump → ${TMP}"
pg_dump \
    --format=custom \
    --no-owner \
    --no-acl \
    --file="${TMP}" \
    "${DATABASE_URL}"

log "verifying dump (pg_restore --list)"
pg_restore --list "${TMP}" > /dev/null

SIZE=$(stat -c%s "${TMP}")
log "dump verified, size=${SIZE} bytes"

log "uploading to s3://${BACKUP_S3_BUCKET}/${KEY}"
# `aws s3 cp` validates the multipart upload server-side via checksum — exit 0
# means the server confirmed receipt. No separate head-object check, because
# that needs s3:GetObject on the runtime user, breaking the write-only principle
# (PutObject + AbortMultipartUpload + ListMultipartUploadParts only).
aws s3 cp "${TMP}" "s3://${BACKUP_S3_BUCKET}/${KEY}" --no-progress

log "done (size=${SIZE} bytes)"
