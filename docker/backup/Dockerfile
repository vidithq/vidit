# Weekly pg_dump → S3 backup cron, deployed as a separate Railway service.
# See ../../README.md → "Weekly automated backups" for the runbook.
#
# Image version MUST match the production server's major version (currently PG 16).
# pg_dump 18 produces archive format 1.16 which PG 16's pg_restore cannot read,
# rendering the backup unrestorable on the very server it came from — found the
# hard way during the first restore drill (see CHANGELOG `Unreleased`). When prod
# migrates to PG 17/18, bump this to match.

FROM postgres:16-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
        awscli \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

# Cron schedule is set on the Railway service, not in the image. The container
# wakes up on schedule, runs backup.sh, and exits — no daemon, no init system.
ENTRYPOINT ["/usr/local/bin/backup.sh"]
