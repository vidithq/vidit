#!/usr/bin/env bash
#
# Restore the most recent production backup into the local dev database.
#
# Reads the daily dump the `backend-backup` cron writes to S3 (see
# docs/backups.md) and replays it into the local database container with the
# same flags as the restore drill. Never talks to Railway.
#
# This REPLACES the local database. Pass --yes to skip the confirmation.
#
#   BACKUP_S3_BUCKET   required, the private backup bucket
#   AWS_PROFILE        optional, the profile that may read that bucket
#   DATABASE_URL       optional, the local target (else read from backend/.env)
#
# The first two come from the environment only. The backend settings model
# rejects keys it does not declare, so backend/.env cannot carry them.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DIR="${REPO_ROOT}/backend"
ENV_FILE="${BACKEND_DIR}/.env"
# Matches `container_name` in docker-compose.yml.
DB_CONTAINER="vidit-db"

die() {
    echo "Error: $*" >&2
    exit 1
}

# Read DATABASE_URL out of backend/.env without sourcing the file: it holds
# secrets and free-text values that a shell would try to expand.
env_file_value() {
    [ -f "${ENV_FILE}" ] || return 0
    sed -n "s/^$1=//p" "${ENV_FILE}" | tail -1 | tr -d '"'"'"'\r'
}

ASSUME_YES=0
for arg in "$@"; do
    case "${arg}" in
        --yes|-y) ASSUME_YES=1 ;;
        *) die "unknown argument: ${arg}" ;;
    esac
done

command -v aws >/dev/null || die "the AWS CLI is not installed"
command -v docker >/dev/null || die "docker is not installed"

BUCKET="${BACKUP_S3_BUCKET:-}"
[ -n "${BUCKET}" ] || die "BACKUP_S3_BUCKET is unset. Export it, or pass it on the command line."

PROFILE="${AWS_PROFILE:-}"
AWS_ARGS=("s3")
[ -n "${PROFILE}" ] && AWS_ARGS=(--profile "${PROFILE}" "s3")

TARGET_URL="${DATABASE_URL:-$(env_file_value DATABASE_URL)}"
TARGET_URL="${TARGET_URL:-postgresql://vision:vision@localhost:5432/vision}"
# pg_restore runs inside the container, so the host is always the container's
# own loopback whatever the app-side URL says.
IN_CONTAINER_URL="$(printf '%s' "${TARGET_URL}" | sed -E 's#@[^/]+/#@localhost:5432/#')"
TARGET_DB="${TARGET_URL##*/}"

# By name rather than through `compose ps`, which resolves the project from the
# working directory and so misses the container when the repo is checked out in
# a git worktree. docker-compose.yml pins the name.
CONTAINER="$(docker ps -q --filter "name=^/${DB_CONTAINER}$")"
[ -n "${CONTAINER}" ] || die "the '${DB_CONTAINER}' container is not running. Run 'make db-up' first."

echo "Looking for the most recent dump in s3://${BUCKET}/ ..."
KEY="$(aws "${AWS_ARGS[@]}" ls "s3://${BUCKET}/" --recursive | sort | awk 'END {print $4}')"
[ -n "${KEY}" ] || die "no dump found in s3://${BUCKET}/."

cat <<EOF

About to replace the local database.

  Source : s3://${BUCKET}/${KEY}
  Target : ${TARGET_DB} in the ${DB_CONTAINER} container
  Effect : every local row is dropped and replaced by production data

EOF

if [ "${ASSUME_YES}" -eq 0 ]; then
    read -r -p "Continue? [y/N] " reply
    case "${reply}" in
        y|Y|yes|YES) ;;
        *) echo "Aborted."; exit 1 ;;
    esac
fi

DUMP="$(mktemp -t vidit-prod-XXXXXX.dump)"
trap 'rm -f "${DUMP}"' EXIT

echo "Downloading ..."
aws "${AWS_ARGS[@]}" cp "s3://${BUCKET}/${KEY}" "${DUMP}"

# Recreate the database instead of restoring with --clean: --clean only
# drops objects the dump knows about, so a local table the production
# schema does not have yet keeps FK references to users/events alive and
# every DROP fails. A fresh database mirrors the restore drill.
DB_USER="$(printf '%s' "${IN_CONTAINER_URL}" | sed -E 's#^[a-z+]+://([^:@/]+).*#\1#')"
echo "Recreating ${TARGET_DB} ..."
docker exec "${CONTAINER}" psql -U "${DB_USER}" -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS \"${TARGET_DB}\" WITH (FORCE);" \
    -c "CREATE DATABASE \"${TARGET_DB}\";"

echo "Restoring into ${TARGET_DB} ..."
docker cp "${DUMP}" "${CONTAINER}:/tmp/vidit-import.dump"
# Restore through a TOC list that skips the tiger geocoder: the app never
# calls it, and its install script does not run on every local image.
docker exec "${CONTAINER}" sh -c \
    "pg_restore -l /tmp/vidit-import.dump | grep -vi tiger > /tmp/vidit-import.list"
docker exec "${CONTAINER}" pg_restore --no-owner --no-acl \
    --use-list=/tmp/vidit-import.list \
    --dbname="${IN_CONTAINER_URL}" /tmp/vidit-import.dump
docker exec "${CONTAINER}" rm -f /tmp/vidit-import.dump /tmp/vidit-import.list

# The dump lags whatever migrations landed since it was taken.
echo "Applying migrations ..."
cd "${BACKEND_DIR}" && uv run alembic upgrade head

echo "Done. The local database now holds the production catalog."
