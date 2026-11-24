# Vulture whitelist: framework-magic false positives only.
#
# `uv run vulture` (config in pyproject.toml) scans app (without app/schemas)
# and scripts at min_confidence 60. Route and validator handlers and the
# model_config / cls names are covered by ignore_decorators / ignore_names in
# pyproject.toml; this file covers attributes populated or read purely through
# framework machinery.
#
# vulture scans this file too, so a bare name (or `_.attr` for a method) marks
# the real definition live. Names collapse by identifier, so one entry covers
# every same-named attribute.
#
# Not a place to silence genuine dead code: a helper with zero call sites
# (app, tests, scripts) is removed instead. Every entry has a real producer or
# consumer vulture can't trace.

# ── Write-only audit columns ──────────────────────────────────────────────────
# Stamped by app code and queried by an operator over SQL, with no wire field
# or app read.
resolved_by_id  # app/models/content_report.py, stamped by services/reports.resolve_report
finished_at  # app/models/archive_import_job.py, stamped by services/archive_jobs
added_at  # app/models/collection.py CollectionEvent, stamped when an event joins
redacted_by_id  # app/models/event.py EventVersion, stamped by services/versions.redact_version

# ── ASGI middleware override ──────────────────────────────────────────────────
# Starlette calls dispatch(); never referenced by name.
_.dispatch  # app/middleware/csrf.py CSRFMiddleware

# ── html.parser.HTMLParser callbacks ──────────────────────────────────────────
# ``feed()`` calls them; never referenced by name.
_.handle_starttag  # app/services/sanitize.py
_.handle_endtag  # app/services/sanitize.py
_.handle_data  # app/services/sanitize.py

# ── Names only a response schema reads ────────────────────────────────────────
# app/schemas/ is excluded from the scan (pyproject.toml), so a column or
# constant read only by a schema, through from_attributes or by name, has no
# read vulture can see.
processed_detection_count  # models/archive_import_job.py, worker-stamped, read by schemas/event.py
detection_count  # models/archive_import_job.py, worker-stamped, read by schemas/event.py
end_year  # models/conflict.py, read by schemas/conflict.py ConflictRead
reporter_id  # models/content_report.py, read by schemas/report.py ContentReportRead
viewer_invite_pending  # set on EventRead by GET /events/{id}, read on the wire
DOCUMENT_SOURCE_KINDS  # models/source.py, read by schemas/source.py SourceCreate

# ── Test-only helper ──────────────────────────────────────────────────────────
# Called only from tests/, which the gate does not scan.
_cache_clear  # services/tweet_ingest/syndication.py

# ── Starlette request-body cache, written by us, read by the framework ────────
# The body-size middleware caches the body onto ``request._body`` so Starlette
# replays it; the read is inside Starlette, which the gate does not scan.
_body  # main.py enforce_request_body_size

# ── SQLAlchemy hybrid expression ──────────────────────────────────────────────
# The SQL half of ``Event.is_machine_detection``, bound by the
# ``@is_machine_detection.inplace.expression`` decorator.
_is_machine_detection_expression  # models/event.py Event
# The SQL half of ``Event.is_graphic``, bound the same way.
_is_graphic_expression  # models/event.py Event

# ── SQLAlchemy declarative configuration ──────────────────────────────────────
# Read by DeclarativeBase when the subclass is created.
type_annotation_map  # app/database.py Base
