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
# reads them by name in app/. `claimed_at` currently has NO explicit Python
# producer or consumer at all (its server_default stamps it and the assembled-
# profile claim flow that inserts an explicit NULL is a deferred v0.4 item); it
# is a live, documented column (migration u7p9r1t3v5x7, data-model.md), so the
# ORM still hydrates it on load. Flagged for the maintainer, not removed.
created_by  # app/models/invite_code.py
original_filename  # app/models/media.py, and schemas/media.py
claimed_at  # app/models/user.py

# ── ASGI middleware override ──────────────────────────────────────────────────
# Starlette's BaseHTTPMiddleware calls dispatch(); it is never referenced by name.
_.dispatch  # app/middleware/csrf.py CSRFMiddleware

# ── Pydantic response-model fields ────────────────────────────────────────────
# Set by the service layer when constructing the schema and serialized by
# Pydantic; the field name is never read back in app/.
used_by_username  # schemas/admin.py InviteCodeRead
media_count  # schemas/admin.py
deleted_geos  # schemas/admin.py
with_claims  # schemas/admin.py
fulfilled  # schemas/admin.py
closed  # schemas/admin.py
deleted_requests  # schemas/admin.py
pending_registrations_deleted  # schemas/admin.py
reject_rate  # schemas/admin.py AdminDetectionStatsRead
pending_missing_source_media  # schemas/admin.py AdminDetectionStatsRead
pending_missing_proof_image  # schemas/admin.py AdminDetectionStatsRead
pending_missing_source_url  # schemas/admin.py AdminDetectionStatsRead
requests  # schemas/search.py SearchTotals + SearchResponse (reader-vocabulary group)
claimer_count  # schemas/search.py SearchRequestHit
investigator_count  # schemas/event.py EventRead + EventList
investigators_sample  # schemas/event.py EventList
discord  # schemas/user.py UserRead
website  # schemas/user.py UserRead
github  # schemas/user.py UserRead

# ── Dataclass fields set at construction, read via attribute access ───────────
owner_handle  # services/tweet_ingest/detect.py DetectedGeoloc
in_reply_to_user_id  # services/tweet_ingest/records.py TweetRecord

# ── Test-only helper ──────────────────────────────────────────────────────────
# Called from tests/, which the gate does not scan, so it reads as unused here.
_cache_clear  # services/tweet_ingest/syndication.py
