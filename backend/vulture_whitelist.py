# Vulture whitelist: framework-magic false positives only.
#
# `uv run vulture` (config in pyproject.toml) scans app + scripts for dead code
# at min_confidence 60. FastAPI / SQLAlchemy / Pydantic reach a lot of names by
# mechanisms vulture can't see, so those read as unused. The two blanket classes
# (route + validator handlers, the model_config / cls contract names) are handled
# by ignore_decorators / ignore_names in pyproject.toml. This file covers the
# rest: attributes populated or read purely through framework machinery.
#
# vulture scans this file too, so a bare name here (or `_.attr` for a method)
# counts as a reference and marks the real definition live. The names collapse by
# identifier, so one entry covers every same-named attribute (e.g. a single
# `original_filename` clears both the Media column and the MediaRead field).
#
# This is NOT a place to silence genuine dead code. If vulture flags a helper
# with zero call sites anywhere (app, tests, scripts), remove it instead. Every
# entry below was checked to have a real producer or consumer that vulture can't
# trace by static analysis.

# ── SQLAlchemy Mapped[...] columns ────────────────────────────────────────────
# Populated from the DB row on every ORM load and set at construction; no line
# reads them by name in app/.
# Set positionally in build_source_link_rows and read only through the
# relationship's string order_by ("EventSourceLink.position").
position  # app/models/event.py EventSourceLink
original_filename  # app/models/media.py, and schemas/media.py
processed_at  # app/models/bot_mention.py — audit stamp, written at insert only
# Stamped by services/reports.resolve_report and read on the wire only (the
# column, the ContentReportRead field, and the assignment all collapse here).
resolved_by  # app/models/content_report.py + app/schemas/report.py
# Set at construction in services/revisions.snapshot and read only through the
# `edited_by` relationship the history serializer walks.
edited_by_id  # app/models/event.py EventRevision
email_verified_at  # app/models/user.py, audit stamp written at registration only

# ── ASGI middleware override ──────────────────────────────────────────────────
# Starlette's BaseHTTPMiddleware calls dispatch(); it is never referenced by name.
_.dispatch  # app/middleware/csrf.py CSRFMiddleware

# ── Pydantic response-model fields ────────────────────────────────────────────
# Set by the service layer when constructing the schema and serialized by
# Pydantic; the field name is never read back in app/.
redeemer  # schemas/admin.py AdminInviteCodeRead
archives_imported  # schemas/admin.py AdminInviteRedeemerRead
bot_detection_count  # schemas/admin.py AdminInviteRedeemerRead
last_login_at  # schemas/admin.py AdminInviteRedeemerRead
deleted_events  # schemas/admin.py AdminPurgeDetectedResponse
media_count  # schemas/admin.py
pending_registrations_deleted  # schemas/admin.py
analysts_notified  # schemas/admin.py AdminMaintenanceResponse
detections_pending  # schemas/admin.py AdminMaintenanceResponse
digest_send_failures  # schemas/admin.py AdminMaintenanceResponse
archived_source  # schemas/event.py EventRead
archived_secondary_sources  # schemas/event.py EventRead
archived_detected_from  # schemas/event.py EventRead
machine_total  # schemas/admin.py AdminDetectionStatsRead
machine_rejected  # schemas/admin.py AdminDetectionStatsRead
reject_rate  # schemas/admin.py AdminDetectionStatsRead
pending  # schemas/admin.py AdminDetectionStatsRead
pending_missing_source_media  # schemas/admin.py AdminDetectionStatsRead
pending_missing_proof_image  # schemas/admin.py AdminDetectionStatsRead
pending_missing_source_url  # schemas/admin.py AdminDetectionStatsRead
authors  # schemas/search.py AuthorSuggestions
requests  # schemas/search.py SearchTotals + SearchResponse (reader-vocabulary group)
discord  # schemas/user.py UserRead
website  # schemas/user.py UserRead
github  # schemas/user.py UserRead
start_year  # models/conflict.py + schemas/conflict.py ConflictRead (wire field)
end_year  # models/conflict.py + schemas/conflict.py ConflictRead (wire field)
geolocated_count  # schemas/user.py UserStatsRead (wire field)
detected_count  # schemas/user.py UserStatsRead
closed_count  # schemas/user.py UserStatsRead
total_events  # schemas/user.py UserStatsRead
top_conflicts  # schemas/user.py UserStatsRead
capture_sources  # schemas/user.py UserStatsRead
activity  # schemas/user.py UserStatsRead
source_hosts  # schemas/user.py UserStatsRead
other_hosts_count  # schemas/user.py UserStatsRead
no_source_count  # schemas/user.py UserStatsRead
# ``ActivityBucket(period=...)`` does not clear it: vulture's visit_Call reads
# keyword arguments for getattr / hasattr / %-format only, so a keyword name at
# a call site is never a use. Every wire field above is here for that reason.
period  # schemas/user.py ActivityBucket (wire field)
finished_at  # models/archive_import_job.py + schemas/event.py ArchiveImportJobRead: written by the worker, read on the wire only
progress_done  # models/archive_import_job.py + schemas/event.py: worker-stamped, wire-read only
progress_total  # models/archive_import_job.py + schemas/event.py: worker-stamped, wire-read only

# ── Test-only helper ──────────────────────────────────────────────────────────
# Called from tests/, which the gate does not scan, so it reads as unused here.
_cache_clear  # services/tweet_ingest/syndication.py
_.get_bytes  # services/storage.py, both backends
_.put_bytes_sync  # services/storage.py, both backends

# ── Starlette request-body cache, written by us, read by the framework ────────
# The body-size middleware caches the streamed body onto ``request._body`` so
# Starlette replays it to the route (same slot ``Request.body()`` fills). We
# only write it; the read is inside Starlette, which the gate does not scan.
_body  # main.py enforce_request_body_size
