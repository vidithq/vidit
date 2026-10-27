#!/bin/sh
# One command per role: a host only chooses which one to run, when and where
# (docs/engineering.md, Backend roles). Any other argument list runs as is,
# so `docker run <image> alembic history` and platform start commands that
# still name a script keep working.
set -eu

role="${1:-api}"
[ "$#" -gt 0 ] && shift

case "$role" in
    api)
        # The proxy-headers flags make uvicorn read the scheme and client
        # host from the forwarded headers, so absolute URLs in emails are
        # https. Without them every request carries the edge proxy's IP and
        # the per-IP rate limits collapse into one shared bucket.
        #
        # The edge proxy appends to X-Forwarded-For, and uvicorn takes the
        # left-most entry, which the client controls. Nothing that needs the
        # real client IP (rate limits, audit log) may read
        # request.client.host: it goes through services.audit._client_ip,
        # which takes the right-most entry the trusted proxy wrote. Set
        # TRUSTED_PROXY_HOPS when a second trusted proxy sits in front.
        exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" \
            --proxy-headers --forwarded-allow-ips='*'
        ;;
    migrate)
        exec alembic upgrade head
        ;;
    worker)
        exec python scripts/run_import_worker.py
        ;;
    sync-conflicts)
        exec python scripts/sync_conflicts.py
        ;;
    update-map)
        exec python scripts/update_map.py
        ;;
    *)
        exec "$role" "$@"
        ;;
esac
