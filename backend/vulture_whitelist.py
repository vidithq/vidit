# Vulture whitelist: framework-magic false positives only.
#
# `uv run vulture` (config in pyproject.toml) scans app + scripts at
# min_confidence 60. Route and validator handlers and the model_config / cls
# names are covered by ignore_decorators / ignore_names in pyproject.toml; this
# file covers attributes populated or read purely through framework machinery.
#
# vulture scans this file too, so a bare name (or `_.attr` for a method) marks
# the real definition live. Names collapse by identifier, so one entry covers
# every same-named attribute.
#
# Not a place to silence genuine dead code: a helper with zero call sites
# (app, tests, scripts) is removed instead. Every entry has a real producer or
# consumer vulture can't trace.
# ── SQLAlchemy Mapped[...] columns ────────────────────────────────────────────
# Populated from the DB row on ORM load; no line in app/ reads them by name.
processed_at  # app/models/bot_mention.py, audit stamp written at insert only
# ``edited_by_id`` is read only through the `edited_by` relationship.
edited_by_id  # app/models/event.py EventVersion
email_verified_at  # app/models/user.py, audit stamp written at registration only

# ── Write-only audit columns ──────────────────────────────────────────────────
# Stamped by app code and queried by an operator over SQL, with no wire field
# or app read. The lifecycle stamps also tie `events.status` to its CHECK
# constraints (docs/data-model.md).
resolved_by_id  # app/models/content_report.py, stamped by services/reports.resolve_report
updated_at  # app/models/event.py, SQLAlchemy ``onupdate`` stamp
requested_at  # app/models/event.py, state-entry stamp
geolocated_at  # app/models/event.py, state-entry stamp
finished_at  # app/models/archive_import_job.py, stamped by services/archive_jobs
added_at  # app/models/collection.py CollectionEvent, stamped when an event joins

# ── ASGI middleware override ──────────────────────────────────────────────────
# Starlette calls dispatch(); never referenced by name.
_.dispatch  # app/middleware/csrf.py CSRFMiddleware

# ── html.parser.HTMLParser callbacks ──────────────────────────────────────────
# ``feed()`` calls them; never referenced by name.
_.handle_starttag  # app/services/sanitize.py
_.handle_endtag  # app/services/sanitize.py
_.handle_data  # app/services/sanitize.py

# ── Pydantic response-model fields ────────────────────────────────────────────
# Set by the service layer and serialized by Pydantic; never read back in app/.
redeemer  # schemas/admin.py AdminInviteCodeRead
username_highlight  # schemas/search.py SearchUserHit
geolocations_cursor  # schemas/search.py SearchResponse
in_collection  # schemas/collection.py CollectionMembershipRead
cover  # schemas/collection.py CollectionRead, the card's mosaic
share_of_existing_zone  # schemas/site.py SiteOverlapRead
duplicate_image_ids  # schemas/site.py SiteImageFiledRead
inside_zone  # schemas/site.py SiteLinkedEventRead
measured_contour_id  # schemas/site.py SiteLinkedEventRead
last_image  # schemas/site.py SiteState
latest_link_effect  # schemas/site.py SiteState
linked_events  # schemas/site.py SiteRead
overlapping_sites  # schemas/site.py SiteCreatedRead
archives_imported  # schemas/admin.py AdminInviteRedeemerRead
bot_detection_count  # schemas/admin.py AdminInviteRedeemerRead
detected_via  # schemas/event.py EventRead, read from event_detections
last_seen_at  # schemas/admin.py AdminInviteRedeemerRead
deleted_events  # schemas/admin.py AdminPurgeDetectedResponse
media_count  # schemas/admin.py
pending_registrations_deleted  # schemas/admin.py
analysts_notified  # schemas/admin.py AdminMaintenanceResponse
detections_pending  # schemas/admin.py AdminMaintenanceResponse
digest_send_failures  # schemas/admin.py AdminMaintenanceResponse
source_urls  # schemas/event.py PossibleDuplicateRead + schemas/search.py SearchRequestHit
event_title  # schemas/source.py SourcePickRead
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
transferred_events  # schemas/admin.py AdminUserDeleteResponse
member_count  # schemas/organization.py OrganizationRead
viewer_role  # schemas/organization.py OrganizationRead
viewer_invited  # schemas/organization.py OrganizationRead
viewer_can_manage  # schemas/organization.py OrganizationRead
viewer_can_approve  # schemas/approval.py ApprovalList
display_defaults  # schemas/preferences.py UserPreferencesRead
display_stored  # schemas/preferences.py UserPreferencesRead
palette  # schemas/preferences.py, read through model_dump
theme  # schemas/preferences.py, read through model_dump
help_tooltips  # schemas/preferences.py, read through model_dump
minting_enabled  # schemas/invite_code.py SponsoredInviteCodeList, filled by keyword
daily_limit  # schemas/invite_code.py SponsoredInviteCodeList, filled by keyword
minted_today  # schemas/invite_code.py SponsoredInviteCodeList, filled by keyword
approval_request_status  # schemas/notification.py NotificationRead
start_year  # models/conflict.py + schemas/conflict.py ConflictRead (wire field)
end_year  # models/conflict.py + schemas/conflict.py ConflictRead (wire field)
geolocated_count  # schemas/user.py UserStatsRead (wire field)
detected_count  # schemas/user.py UserStatsRead
total_events  # schemas/user.py UserStatsRead
top_conflicts  # schemas/user.py UserStatsRead
source_kinds  # schemas/user.py UserStatsRead
activity  # schemas/user.py UserStatsRead
source_hosts  # schemas/user.py UserStatsRead
other_hosts_count  # schemas/user.py UserStatsRead
no_source_count  # schemas/user.py UserStatsRead
# ``ActivityBucket(period=...)`` does not clear it: vulture reads keyword
# arguments for getattr / hasattr / %-format only. Every wire field above is
# here for that reason.
period  # schemas/user.py ActivityBucket (wire field)
processed_detection_count  # models/archive_import_job.py + schemas/event.py: worker-stamped, wire-read only
detection_count  # models/archive_import_job.py + schemas/event.py: worker-stamped, wire-read only
redacted  # schemas/event.py EventVersionRead (wire field, built in routers/events/_common.py)
# Written by ``services/versions.redact_version``, read by nothing in ``app/``;
# the readable trail is the ``audit_log`` row the same write files.
redacted_by_id  # models/event.py EventVersion
analysts  # schemas/approval_request.py ApprovalRequestTargetList (wire field)
approval  # schemas/approval.py OrganizationApprovalRead (wire field)
viewer_invite_pending  # schemas/event.py EventRead: set by GET /events/{id}, read on the wire

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
