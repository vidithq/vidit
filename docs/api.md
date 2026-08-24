# API reference

Base URL: `/api/v1`

All responses are JSON.

**Auth.** For endpoints marked 🔒, log in first. Send the `vidit_session` cookie (set by `POST /auth/login`, `HttpOnly; Secure; SameSite=Lax`), and for state-changing requests (`POST`/`PUT`/`PATCH`/`DELETE`), also send the `X-CSRF-Token` header with the value of the JS-readable `vidit_csrf` cookie. There is no `Authorization: Bearer` flow. The cookie and CSRF pair is the only authenticated channel into the backend. Endpoints marked 🛡️ also require `is_admin=true` on your account; without it, the backend returns 403.

**Transport security.** Every response carries `Strict-Transport-Security: max-age=15768000`. The header carries no `includeSubDomains` or `preload` directives.

**Auth audit log.** The `/auth/*` endpoints write to the `auth_events` table as a side effect: `login` on success, `failed_login` on any rejected login (with `user_id` set only when the address matched a live user), `logout`, `register_pending` (on `POST /auth/register`), `register_resent` (on `POST /auth/resend-confirmation`, on both the matched-pending and no-matching-pending branches, so the rate-of-requests signal survives the always-204 discipline; `user_id` is always NULL because no user row exists yet), `register_confirmed` (on `POST /auth/confirm-registration`), `password_reset_requested` (on `POST /auth/forgot-password`, on both the known-email and unknown-email branches, so the audit trail carries a rate-of-requests signal), `password_reset_completed`, and `password_changed` (on `POST /auth/change-password`). Writes are best effort inside a SAVEPOINT. An audit failure never breaks the auth flow.

**Error envelope.** Three shapes appear on the `detail` field of non-2xx responses. The frontend `apiFetch` helper ([`frontend/src/lib/api.ts`](../frontend/src/lib/api.ts)) normalizes all three. (1) **Plain string**: `{"detail": "Invite code not found"}`, for direct `HTTPException` raises in routers (for example, `DELETE /admin/invite-codes/{id}` returning 404). (2) **Pydantic validation array**: `{"detail": [{"loc": [...], "msg": "...", "type": "..."}, ...]}`, for request-body or query-string validation failures (the FastAPI default). (3) **Typed envelope**: `{"detail": {"code": "<stable_id>", "message": "<human prose>"}}`, for business-rule errors raised from the service layer and translated by the router. This envelope covers every `/auth/register`, `/auth/confirm-registration`, and `/auth/resend-confirmation` error branch (codes: `invalid_invite`, `email_already_registered`, `username_already_taken`, `email_pending_confirmation`, `username_pending_confirmation`, `invalid_or_expired_token`); every `/admin/*` business-rule error branch (codes: `user_not_found`, `geolocation_not_found`, `version_not_found`, `x_handle_conflict`); every `POST /events/{id}/report`, `POST /admin/reports/{id}/resolve`, and `PATCH /admin/events/{id}/moderation` business-rule branch (codes: `event_not_found`, `report_not_found`, `report_already_resolved`, `report_event_gone`); and every `POST /events`, `POST /events/requests`, and `POST /events/{id}/geolocate` business-rule branch (codes: `invalid_coordinates`, `too_many_files`, `media_required`, `invalid_proof`, `proof_image_required`, `tag_requirements_not_met`, `invalid_file`, `evidence_processing_failed`, `proof_files_mismatch`, `source_media_conflict`; the create, request, and geolocate paths share the file and media codes through `services/evidence_intake`). `PUT /users/me/avatar` adds `invalid_avatar` when the uploaded file is not an accepted image type, is over the image size ceiling, or cannot be decoded. `POST /events/{id}/geolocate` and `POST /events/{id}/close` add `invalid_state` when the row is not `requested` or `detected`; `POST /events/{id}/versions` adds it when the row is not `geolocated`, plus `nothing_changed` (the edit moves no versioned field) and `version_limit` (the event already carries 100 versions). `POST /events/import-from-tweet` adds `invalid_tweet_url`, `not_your_post`, `post_unreadable`, `upstream_unreadable` and `upstream_busy`. Every write path carrying an archived-copy field (`source_snapshot_url`, `secondary_snapshot_urls`, `detected_from_snapshot_url`) adds `original_url_not_on_event`, `snapshot_url_invalid`, `snapshot_url_too_long`, `snapshot_url_not_https`, `snapshot_provider_not_allowed`, `snapshot_not_a_replay_url`, `snapshot_original_mismatch` and `snapshot_not_a_snapshot_code`; they run the same checks, so one paste is answered the same way wherever it arrives. The `429` responses from the [rate limiter](#rate-limits) use the same envelope (codes `rate_limited`, `read_quota_exceeded`). Branch on `code`, not on `message`: `code` is the stable contract surface. Status codes follow the per-endpoint contracts below.
---

## Endpoints at a glance

Auth column: 🌐 anonymous, 🔒 logged-in, 🛡️ admin-only.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| **Auth** | | | |
| POST | `/auth/register` | 🌐 | Stage a pending registration; sends confirmation email |
| POST | `/auth/confirm-registration` | 🌐 | Confirm a pending registration (creates user, signs in) |
| POST | `/auth/resend-confirmation` | 🌐 | Resend the confirmation email and invalidate the previous token |
| POST | `/auth/login` | 🌐 | Email + password → session + CSRF cookies |
| POST | `/auth/logout` | 🌐 | Clear session cookies (idempotent) |
| GET | `/auth/me` | 🔒 | Current user |
| POST | `/auth/forgot-password` | 🌐 | Email a single-use reset token (always 204) |
| POST | `/auth/reset-password` | 🌐 | Consume reset token, set new password |
| POST | `/auth/change-password` | 🔒 | Rotate your password (requires your current password) |
| **Events** | | | |
| GET | `/events` | 🌐 | List one lifecycle view, `located` (default) or `requested` (ex `/requests`) |
| GET | `/events/points` | 🌐 | Compact map-points tuples for one viewport (`bbox` required, cached) |
| GET | `/events/possible-duplicates` | 🔒 | Soft-warning probe for the submit form |
| POST | `/events/import-from-tweet` | 🔒 | Import your own X post as detections |
| POST | `/events/import-archive/presign` | 🔒 | Mint a presigned direct-to-storage upload for your X data archive |
| POST | `/events/import-archive` | 🔒 | Enqueue your staged archive (by `upload_key`) for the backfill worker |
| GET | `/events/import-archive/{job_id}` | 🔒 | Poll your import job (status + import counts) |
| GET | `/events/{id}` | 🌐 | Full event detail, any lifecycle state |
| POST | `/events/{id}/report` | 🌐 | Report an event for moderation (anonymous allowed) |
| POST | `/events` | 🔒 | Create an event born `geolocated` (multipart, uploads media) |
| POST | `/events/requests` | 🔒 | Open a request (multipart); creates a `requested` event (ex `POST /requests`) |
| POST | `/events/{id}/geolocate` | 🔒 | Give an event a vouched location: `requested` \| `detected` → `geolocated` |
| POST | `/events/batch-complete` | 🔒 | Publish a selection of your detections in one call (per-row verdicts) |
| POST | `/events/{id}/versions` | 🔒 | Correct a published event, owner only; files the version it supersedes |
| GET | `/events/{id}/versions` | 🌐 | The event's superseded versions, newest first |
| GET | `/events/{id}/versions/{version_no}` | 🌐 | One superseded version, by its number |
| POST | `/events/{id}/close` | 🔒 | Withdraw, reject or retract an event, owner only (→ `closed`) |
| GET | `/events/detections` | 🔒 | Your `detected` events awaiting a geolocate (paginated, filterable on readiness) |
| **Search** | | | |
| GET | `/search` | 🌐 | Free-text search across geolocations / requests / users |
| GET | `/search/authors` | 🌐 | Username typeahead for the author filter |
| **Tags** | | | |
| GET | `/tags` | 🌐 | List tags (defaults to ones referenced by live geos) |
| POST | `/tags` | 🔒 | Create a free tag (curated categories rejected) |
| **Conflicts** | | | |
| GET | `/conflicts` | 🌐 | List the conflict referential (`?used=true` narrows to conflicts on live events) |
| **Users** | | | |
| GET | `/users/{username}` | 🌐 | Public analyst profile |
| GET | `/users/{username}/stats` | 🌐 | Aggregated shape of an analyst's work (status split, tags, source hosts, activity) |
| PATCH | `/users/me` | 🔒 | Edit your bio and external links |
| PUT | `/users/me/avatar` | 🔒 | Upload your profile picture (multipart) |
| DELETE | `/users/me/avatar` | 🔒 | Remove your profile picture |
| GET | `/users/{username}/events` | 🌐 | List an analyst's published geolocations |
| POST | `/users/{username}/follow` | 🔒 | Follow (idempotent; self-follow → 400) |
| DELETE | `/users/{username}/follow` | 🔒 | Unfollow (idempotent; unknown user → 404) |
| **Timeline** | | | |
| GET | `/timeline` | 🔒 | Activity feed from followed analysts |
| **Webhooks** | | | |
| GET | `/webhooks/x` | 🌐 | X webhook CRC challenge (HMAC answer, no DB) |
| POST | `/webhooks/x` | 🌐 | Receive an X Account Activity delivery (signature-verified) and queue bot mentions |
| **Admin** (collapsed below) | | | |
| GET | `/admin/me` | 🛡️ | `is_admin` probe |
| GET | `/admin/detection-stats` | 🛡️ | Machine-extraction quality: reject-rate + pending missing-piece counts |
| POST/GET/DELETE | `/admin/invite-codes[/{id}]` | 🛡️ | Mint / list / revoke invite codes |
| GET | `/admin/users` | 🛡️ | Substring search on username/email |
| DELETE | `/admin/users/{id}` | 🛡️ | Soft delete (default) or `?hard=true` GDPR erasure |
| DELETE | `/admin/users/{id}/detected-events` | 🛡️ | Purge every detection the user owns, account untouched |
| DELETE | `/admin/events/{id}` | 🛡️ | Soft delete or `?hard=true` GDPR erasure |
| PATCH | `/admin/users/{id}/x-handle` | 🛡️ | Link / clear the bot-attribution X handle |
| GET | `/admin/reports` | 🛡️ | The moderation queue: open reports first, then newest first |
| POST | `/admin/reports/{id}/resolve` | 🛡️ | Close one report with a verdict, applying it to the event |
| PATCH | `/admin/events/{id}/moderation` | 🛡️ | Set an event's graphic flag / takedown directly, no report behind it |
| POST | `/admin/events/{id}/versions/{version_no}/redact` | 🛡️ | Blank one filed version, keeping its number |
| POST | `/admin/maintenance/reap-*` | 🛡️ | Cron-style reapers (auth tokens, pending regs) |
| POST | `/admin/maintenance/send-completion-digests` | 🛡️ | Email each analyst the count of detections awaiting completion |

---

## Rate limits

A single shared **slowapi** limiter ([`app/ratelimit.py`](../backend/app/ratelimit.py)) enforces two layers: the per-endpoint limits in the table below, and the per-user read quota that follows it. Table limits are keyed per client IP (the rightmost `X-Forwarded-For` entry; see [`engineering.md`](engineering.md) → *Particularities*) unless a row says otherwise. There is **no global floor**, so any endpoint absent from the table has no limit. Buckets live in process (one replica today). Set `RATE_LIMIT_ENABLED=false` to disable every limit at once, for local development.

A rejected request returns `429` with the typed envelope: `{"detail": {"code": "rate_limited", "message": "…"}}` for a table limit, or `{"detail": {"code": "read_quota_exceeded", "message": "…"}}` for the read quota. Both carry a `Retry-After` header in whole seconds, counted to the exact bucket reset. Branch on `code`: the two waits differ by orders of magnitude. A per-minute throttle clears in seconds; the quota window is a fixed hour.

CI pins every limit on this page behaviorally: N requests succeed, and request N+1 returns `429` (see [`test_rate_limits.py`](../backend/tests/test_rate_limits.py)). Dropping a limit fails CI. One tier is not pinned this way: `POST /auth/login`'s 30/hour limit. Reaching it requires exhausting the 5/min tier six times over, and the minute tier returns `429` starting at request 6, so no test can drive the hourly bucket to its own wall.

| Endpoint | Limit |
|---|---|
| **Auth** | |
| `POST /auth/login` | 5/min + 30/hour |
| `POST /auth/register` | 10/hour |
| `POST /auth/confirm-registration` | 30/hour |
| `POST /auth/resend-confirmation` | 5/hour |
| `POST /auth/forgot-password` | 5/hour |
| `POST /auth/reset-password` | 10/hour |
| `POST /auth/change-password` | 10/hour (keyed per session) |
| **Events** | |
| `GET /events`, `GET /events/{id}`, `GET /events/{id}/versions`, `GET /events/{id}/versions/{version_no}`, `GET /events/detections` | 120/min |
| `GET /events/points` | 60/min |
| `GET /events/possible-duplicates` | 60/min |
| `POST /events/import-from-tweet` | 30/min |
| `POST /events/import-archive/presign` | 10/hour |
| `POST /events/import-archive` | 10/hour |
| `GET /events/import-archive/{job_id}` | 60/min |
| `POST /events`, `POST /events/requests` | 30/min |
| `POST /events/{id}/geolocate`, `POST /events/{id}/versions` | 30/min |
| `POST /events/batch-complete` | 10/min |
| `POST /events/{id}/close` | 60/min |
| `POST /events/{id}/report` | 10/hour (anonymous allowed; reporting has no per-account tier, only the per-IP one) |
| **Search / Tags** | |
| `GET /search`, `GET /search/authors` | 60/min |
| `GET /tags` | 60/min |
| `POST /tags` | 30/min |
| `GET /conflicts` | 60/min |
| **Users / Timeline** | |
| `GET /users/{username}`, `GET /users/{username}/stats`, `GET /users/{username}/events`, `GET /timeline` | 120/min |
| `PATCH /users/me` | 30/min |
| `PUT`/`DELETE /users/me/avatar` | 20/min |
| `POST`/`DELETE /users/{username}/follow` | 60/min |
| **Admin** 🛡️ | |
| `POST /admin/invite-codes` · `DELETE /admin/users/{id}` · `DELETE /admin/users/{id}/detected-events` | 30/hour |
| `DELETE /admin/invite-codes/{id}` · `PATCH /admin/users/{id}/x-handle` · `DELETE /admin/events/{id}` | 60/hour |
| `POST /admin/reports/{id}/resolve` · `PATCH /admin/events/{id}/moderation` · `POST /admin/events/{id}/versions/{version_no}/redact` | 60/hour |
| `POST /admin/maintenance/reap-*` · `POST /admin/maintenance/send-completion-digests` | 30/hour |

The read-only admin probes (`GET /admin/me`, `/admin/detection-stats`, `/admin/users`, `/admin/invite-codes` list, `/admin/reports` list) carry no limit. The [`/webhooks/x`](#webhooks) pair carries none either: the POST verifies the HMAC signature over the raw body (one HMAC, cheaper than any limiter bookkeeping), and the GET only ever signs tokens matching X's URL-safe CRC shape, the charset gate that keeps the responder from being a signing oracle for forged webhook bodies.

### Per-user read quota

**1000/hour per account.** One bucket is shared across the whole read surface, not one bucket per endpoint:

`GET /events` · `/events/{id}` · `/events/points` · `/events/detections` · `/events/possible-duplicates` · `/search` · `/search/authors` · `/tags` · `/conflicts` · `/users/{username}` · `/users/{username}/stats` · `/users/{username}/events` · `/timeline`

The key is `User.id`, read from the signature-verified session cookie. A forged `sub` cannot mint a bucket, so the cap travels with the account rather than with its source address: the per-IP table caps one client, and this quota caps one account's read throughput wherever it reads from. The two layers stack, and the backend evaluates the table limit first, so a request the table limit rejects costs the account nothing.

This quota is defense in depth, not a wall on its own. Ten of the thirteen paths answer anonymously, so if you drop the session cookie, you leave the quota behind and fall back to the per-IP limits alone. The quota adds a ceiling the per-IP table cannot express: a bound on how much one account pulls, however many addresses it pulls from. Governing the anonymous catalog surface is the per-IP table's job.

Anonymous callers are exempt from the quota and keep the per-IP limits alone. So is every authenticated read absent from the list above, including `GET /auth/me` and the read-only admin probes. One endpoint is absent by decision rather than by nature: `GET /events/import-archive/{job_id}`. A single import polls it hard enough to drain a shared budget on its own. Exempting it cannot widen the catalog surface, because it returns no catalog rows: one job's own progress counters, with no listing, search, or enumeration to walk.

---

## Auth

### `POST /auth/register`

Stage a registration. Anonymous. **This call creates no `users` row.** The submission lives in `pending_registrations` until the user proves they own the email address by clicking the link in the confirmation message. The pending row references the invite code but does not consume it, so an abandoned signup does not burn the invite.

**Request body:**
```json
{
  "username": "kalush",
  "email": "kalush@example.com",
  "password": "••••••••",
  "invite_code": "abc123"
}
```

**Response 202:**
```json
{
  "status": "pending_confirmation",
  "email": "kalush@example.com"
}
```

The response sets no session cookie. A background task sends the confirmation email, so the success and error branches return at the same wire timing.

**Errors:**
| Code | Case |
|------|------|
| 400 | Invite code invalid, expired, revoked, or exhausted |
| 409 | Email or username already registered (live or soft-deleted user) |
| 409 | Email or username already has a live pending confirmation (distinct message) |
| 429 | Rate-limited (10/hour/IP) |

---

### `POST /auth/confirm-registration`

Anonymous. Consumes the token that `POST /auth/register` emailed, creates the `users` row, marks the invite consumed, and signs the user in (sets the `vidit_session` and `vidit_csrf` cookies in the same response).

**Request body:**
```json
{ "token": "Pv3oZc..." }
```

**Response 200:** `UserRead` (same shape as `GET /auth/me`).

| Status | Meaning |
|--------|---------|
| 200 | Account created; cookies set; redirect to / |
| 400 | Token unknown, expired, or already consumed |
| 409 | Email or username was taken in the gap between register and confirm |

Rate-limited to 30/hour per IP.

---

### `POST /auth/resend-confirmation`

Anonymous. Remints the token for an outstanding pending registration and resends the confirmation email. Always returns 204, so the response never leaks which addresses are in flight. Reminting invalidates the previous token, so a shoulder-surfed link from the first email can't be redeemed after the resend.

**Request body:**
```json
{ "email": "kalush@example.com" }
```

**Response 204** (always).

Rate-limited to 5/hour per IP.

---

### `POST /auth/login`

**Request body:**
```json
{
  "email": "kalush@example.com",
  "password": "••••••••"
}
```

**Response 200:** `UserRead` (same shape as `GET /auth/me`). Sets the `vidit_session` HttpOnly cookie and the JS-readable `vidit_csrf` cookie.

**Errors:**
| Code | Case |
|------|------|
| 401 | Wrong email or password |
| 429 | Rate-limited (5/min/IP, 30/hour/IP) |

---

### `POST /auth/logout`

Clears your session and CSRF cookies. Not session-gated, so it's idempotent. Like any mutating request, it still requires the `X-CSRF-Token` header when a `vidit_csrf` cookie is present. **Response 204:** no body.

---

### `GET /auth/me` 🔒

Returns your user account.

**Response 200:**
```json
{
  "id": "uuid",
  "username": "kalush",
  "email": "kalush@example.com",
  "bio": null,
  "avatar_url": null,
  "external_links": {},
  "created_at": "2026-03-28T10:00:00Z"
}
```

The profile fields (`bio`, `avatar_url`, `external_links`) ship with this payload, so the sidebar avatar and the edit-profile form can render without a second fetch. **This shape carries no `is_admin` field.** The admin role surfaces only through `GET /admin/me`. `email_verified_at` is not exposed, because the pre-creation flow means there's no unverified-user state.

---

### `POST /auth/forgot-password`

Anonymous. Emails a single-use reset token if the address matches an account. Always returns 204, to avoid user enumeration. The backend logs and swallows email-send failures, for the same reason.

**Body:**
```json
{ "email": "kalush@example.com" }
```

**Response 204** (always, on success or unknown email).

Rate-limited to 5/hour per IP.

---

### `POST /auth/reset-password`

Anonymous. Consumes a reset token and sets a new password. Tokens are single-use. They expire `PASSWORD_RESET_TOKEN_MINUTES` after minting (default 15; the reset email quotes the same value), and become invalid the moment a fresh `forgot-password` request is issued for the same user.

**Body:**
```json
{
  "token": "Pv3oZc...",
  "new_password": "atleasteightchars"
}
```

**Response 204** on success.

| Status | Meaning |
|--------|---------|
| 204 | Password updated; client should redirect to /login |
| 400 | Token unknown, expired, already consumed, or wrong purpose, same opaque error to avoid leaking which |

Rate-limited to 10/hour per IP.

### `POST /auth/change-password` 🔒

Rotates your password from the settings page. Requires you to reassert your current password, so a stolen cookie can't lock you out. Audited as `password_changed` on success. After commit, the backend sends a best-effort heads-up email to your address (no IP or user agent; it links to `/forgot-password` for you to use if you didn't trigger the change). The backend swallows an email-send failure (logging it with `user_id`, never the address); the rotation still succeeds.

**Body:**
```json
{
  "current_password": "••••••••",
  "new_password": "atleasteightchars"
}
```

**Response 204** on success.

| Status | Meaning |
|--------|---------|
| 204 | Password updated; session cookie stays valid |
| 400 | Current password incorrect |
| 401 | Not authenticated |
| 422 | `new_password` shorter than 8 characters |

Rate-limited to 10/hour per session.

---

## Events

### `GET /events`

List one lifecycle view, newest first. Returns a lightweight card shape (no full proof).

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `view` | string | `located` (default, the catalog: `geolocated` + `detected` rows, plus a `closed` row whose `before_closed_status` was `detected`) or `requested` (the open-call queue, ex `/requests`: `requested` rows, plus a `closed` row whose `before_closed_status` was `requested`). Each view keeps the closed rows that left its own cohort; a retraction (`closed` off `geolocated`) is in neither and is reachable by its own URL. Anything else → 422. |
| `status` | string (repeatable) | Narrows within the view, e.g. `?view=requested&status=closed`. Repeat the param to OR within the bucket (`?status=geolocated&status=detected`). Values outside `requested` / `detected` / `geolocated` / `closed` return 422; a value the view can't contain returns an empty list. |
| `conflict` | string (repeatable) | Filter by conflict name, matched against the [`conflicts`](#conflicts) referential (`conflicts.name`), not tags. Repeat the param to OR within the conflict bucket (`?conflict=Russian invasion of Ukraine&conflict=Gaza war`). Combining with other buckets ANDs across them. |
| `capture_source` | string (repeatable) | Filter by capture-source tag name (`?capture_source=Satellite&capture_source=Drone`). Same semantics as `conflict`: OR within the bucket, AND across buckets, and the matched tag must carry `category == "capture_source"`. |
| `tag` | string (repeatable) | Filter by tag name (any category). Repeat the param to OR within the tag bucket (`?tag=drone&tag=tank`). Combining buckets ANDs across them, the event must satisfy each bucket independently. |
| `bbox` | string | `south,west,north,east` (four comma-separated floats). 422 on malformed input, latitudes in [-90, 90], longitudes in [-180, 180], south ≤ north, west ≤ east. |
| `event_date_from` / `event_date_to` | date (YYYY-MM-DD) | Inclusive event-date range. Malformed values return 422 (used to silently 500 from Postgres `InvalidDatetimeFormat`). |
| `submitted_from` / `submitted_to` | date (YYYY-MM-DD) | Inclusive submission-date range. Same 422-on-malformed shape as the event-date filters. |
| `author` | string | Exact, case-insensitive match on owner username ("this analyst's work"; pick real handles via [`GET /search/authors`](#get-searchauthors)). Whitelisted to `[A-Za-z0-9_-]{1,50}`, any other character returns 422. |
| `limit` | int | Rows per page, default 100. Clamped to the 100-row [cap](#pagination); below 1 or non-numeric returns 422. |
| `cursor` | string | Opaque cursor from the previous page's `Link: rel="next"` header. A malformed value returns 422. See [Pagination](#pagination). |

**Response 200:**
```json
[
  {
    "id": "uuid",
    "title": "Strike on depot, Donetsk",
    "event_coords": { "lat": 48.123, "lng": 37.456 },
    "event_date": "2026-03-15",
    "is_graphic": false,
    "status": "geolocated",
    "before_closed_status": null,
    "owner": {
      "id": "uuid",
      "username": "kalush"
    },
    "media": {
      "id": "uuid",
      "role": "source",
      "storage_url": "https://…/uploads/.../photo.jpg",
      "media_type": "image"
    },
    "tags": [
      { "name": "Drone", "category": "capture_source" },
      { "name": "airstrike", "category": "free" }
    ],
    "conflicts": [
      { "id": "uuid", "name": "Russian invasion of Ukraine", "wikidata_id": "Q110999040", "start_year": 2022, "end_year": null, "ongoing": true, "tier": "major" }
    ],
  }
]
```

**Response headers:** `Link: <…&cursor=…>; rel="next"` when a further page exists. Ordering is `created_at DESC, id DESC`; see [Pagination](#pagination).

`status` is one of `requested` / `detected` / `geolocated` / `closed`; `event_coords` is `null` on a coordinate-less `requested` row. `is_graphic` is `true` when the author (or an admin, overriding the author) flagged the footage as showing death, injury or human remains; the frontend covers the card's `media` thumbnail behind [`GraphicContentGate`](design.md#components) when it is. A withheld event (`hidden_at` set, see [`GET /events/{id}`](#get-eventsid)) never appears in this list. `media` is the card thumbnail: the event's `source` attachment, else its first `proof` image (`null` when it has neither; a proof video is never picked). The pick lives in `backend/app/services/thumbnails.py`, the one home every card surface uses. `conflicts` is the event's rows from the [conflict referential](#conflicts) (`ConflictRead` shape). The same card shape flows through the profile feed, the timeline, and search hits. The admin console reads this list too: its catalogue-feed panel reads the first rows of the `located` view, so an admin sees what the catalog serves a visitor.

---

### `GET /events/points`

Compact `[id, lat, lng, event_date, added_date, detected]` tuples for client-side clustering, no joins, no pagination. `event_date` / `added_date` are ISO `YYYY-MM-DD` (the `created_at` calendar day); `event_date` is `null` when unknown (the column is optional), and the map's event-date scrubber skips null-dated points instead of hiding them. The map buckets the dates for its timeline scrubbers and filters client-side. `detected` is `1` for a machine-detected row, `0` for a `geolocated` one: a flag, not a status string. Located rows only, so `requested` events never appear here.

`bbox` is **required**. The payload tracks the area you request, and the map's own
calls are viewport-sized. Nothing caps that area: the map legitimately requests
the world box at low zoom. Unlike on `GET /events`, an empty `?bbox=` is a
rejection here, not an omitted filter.

Results are cached in-memory for 60s per unique `bbox` + filter combination; the
response echoes `X-Cache: HIT|MISS` and `Cache-Control: public, max-age=30`.
Rate-limited to 60/min/IP.

The `bbox` is snapped outward onto a fixed 0.05° server-side grid before it is
keyed and queried. Two viewports inside one cell therefore share a cache entry
and get a payload covering the snapped (slightly larger) box, which always
contains the box requested.

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| `bbox` | string, **required** | `south,west,north,east` (four comma-separated floats), same shape and validation as on `GET /events`: latitudes in [-90, 90], longitudes in [-180, 180], south ≤ north, west ≤ east. Missing, empty, or malformed → 422. Boxes crossing the antimeridian are not modeled: the map widens such a viewport to the full longitude range rather than splitting it into two calls. |
| `media` | string (repeatable) | `?media=image&media=video`, matches an event carrying any attachment of a listed type. Values outside `image` / `video` → 422. |
| `conflict`, `capture_source`, `tag`, `event_date_from`, `event_date_to`, `submitted_from`, `submitted_to`, `author` | | See `GET /events` for semantics. The date params are accepted, and the map filters dates client-side off the payload instead of sending them. |

| Status | Meaning |
|--------|---------|
| 200 | Points inside `bbox` |
| 422 | `bbox` missing or malformed, a malformed `event_date_from` / `event_date_to` / `submitted_from` / `submitted_to` (ISO `YYYY-MM-DD`), or a `media` / `author` value outside its domain |

**Response 200:**
```json
[
  ["6c1f…uuid", 48.123, 37.456, "2024-03-11", "2024-03-12", 0, 0],
  ["a0b2…uuid", 50.450, 30.523, "2024-05-02", "2024-05-04", 1, 0]
]
```

---

### `GET /events/possible-duplicates` 🔒

Soft-warning probe for the submit form: geolocations that might describe the same event. **Never blocks submission** (advisory only).

Match rule: within ~500 m geodesic of the proposed `(lat, lng)` **AND** (same source-URL host *or* same `event_date`). The host leg also matches against an existing event's secondary source links, not only its primary `source_url`, so pasting a mirror of an already-catalogued event still surfaces it. Requires auth. Rate-limited to 60/min/IP.

Inputs are tolerated gracefully:

- Partial / scheme-stripped source URLs (`t.me/channel/12345`) parse via a
  best-effort host extractor (prepends `http://` and re-parses). Hosts that
  don't match `^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$` after normalisation
  (lowercase, leading `www.` stripped) disable the host leg rather than
  422-ing.
- Malformed `event_date` values disable the date leg.
- If neither leg ends up usable, the response is `[]` (not an error) so
  the frontend can call this eagerly while fields are still being typed.

**Query params:**
| Field | Type | Required | Description |
|---|---|---|---|
| `lat` | float | yes | Latitude (-90 to 90) of the prospective submission. |
| `lng` | float | yes | Longitude (-180 to 180). |
| `source_url` | string | no | Best-effort host extracted for the host-match leg. |
| `event_date` | string (YYYY-MM-DD) | no | Compared exactly for the date-match leg. |

**Response 200:** array of up to 10 candidates ordered by distance ascending.
```json
[
  {
    "id": "uuid",
    "title": "Strike on depot, Donetsk",
    "event_coords": { "lat": 48.123, "lng": 37.456 },
    "event_date": "2026-05-01",
    "source_url": "https://t.me/somechannel/12345",
    "distance_m": 55.4,
    "owner": {
      "id": "uuid",
      "username": "kalush"
    }
  }
]
```

---

### `POST /events/import-from-tweet` 🔒

Import one of your own X posts. The route runs the shared detection engine over the post and writes what it reads as detections owned by you, one per coordinate the post carries. It is the same engine and the same write path the bot and the archive backfill run, so a post produces the same detections whichever entry read it (see [`ingestion.md`](ingestion.md#the-contract)). Rate-limited to 30/min/IP.

**Own posts only.** The post's author must equal the X handle linked to your account (`users.x_handle`, compared case-insensitively). A post by anyone else, or a caller with no linked handle, returns `400 not_your_post`. Third-party footage goes through [`POST /events`](#post-events) with a `source_url` instead.

Acquisition reads one hop for a post carrying content of its own: the pasted post plus, when it replies to one of its own author's posts, that parent. A pasted post whose text is nothing but mentions is a pointer at the thread above it, so acquisition climbs the same author's parents to the post carrying the coordinate, three fetches at most (see [`ingestion.md`](ingestion.md#what-acquisition-reads)). A reply posted under the pasted post is not read, so paste the reply itself to include it. Data source is X's public *syndication* endpoint (the same backend the embeddable `<blockquote class="twitter-tweet">` widget uses). It is unauthenticated and undocumented; responses are cached in-memory for 1h per post ID to bound repeat fetches.

**Request body:**
```json
{ "url": "https://x.com/handle/status/1234567890" }
```

Accepts both `x.com` and `twitter.com` (with or without `www.`), tolerates query string + fragment, and reduces the path to `/<handle>/status/<id>`. Anything else (profile, list, search, non-X host) returns 400.

**Response 200:**
```json
{
  "created": ["9a2b…"],
  "updated": [],
  "skipped": [],
  "warnings": [{ "code": "several_coordinates", "message": "Several coordinates, one detection each" }],
  "reason": null,
  "failed": 0
}
```

`created`, `updated` and `skipped` carry event ids in the order the engine produced them: new detections, open detections a re-import overwrote, and rows the import left alone. Open the first id you get. Re-importing is safe and idempotent: the match key is `(the thread's post ids OR source_url, coordinate)` scoped to you, so a post already imported through the bot or an archive backfill lands on the detection it already produced, and what happens to a matched row follows the [re-import matrix](ingestion.md#re-import), so a published or closed row is skipped rather than overwritten.

`warnings` carries what review still has to answer on these detections, each entry a `{code, message}` pair. Three codes say what the engine could not settle from the post: `several_coordinates` (one thread, one detection per coordinate), `source_ambiguous` (several candidate links, so the source is left empty) and `source_missing` (no candidate link and no quote). Four say what the detections ended up with: `source_footage_missing` (no footage stored from the source), `source_fetch_failed` (the source could not be read this time, so importing the post again later may fill it), `source_date_unknown` (the source's post date came back unknown) and `duplicate_media` (the media already exists on another event). See [`ingestion.md`](ingestion.md#warnings). They are warnings, not refusals: the detections landed.

`reason` names the refusal when the post produced no detection at all, in the same `{code, message}` shape, and is null whenever detections were produced: `coords_missing` (no coordinate in the author's own text, which also covers a retweet, since a retweet produces nothing) or `coords_invalid` (a coordinate-shaped string outside the world). `failed` counts detections that raised mid-persist; the detections that did land are unaffected.

Branch on `code`, which is the stable half. `message` is the one sentence the platform says for that code everywhere it is surfaced, so the page can render it as it arrives; it is prose and may be reworded.

Media travels with the detections: the engine fetches the post's own attachments from the X CDN, stores the footage in the source slot and the analyst's images as proof, and inlines the proof images into the detection's proof document. A detection whose media could not be fetched lands media-incomplete and is completed at review.

**Errors:** all four carry the typed `{"code", "message"}` envelope.

| Code | Case |
|------|------|
| 400 | `invalid_tweet_url`: not a post URL (wrong host, profile / list / search path, malformed). `not_your_post`: the post's author is not the X handle linked to your account, or your account has none. `message` names both handles |
| 404 | `post_unreadable`: deleted, protected, never existed, or readable only behind an X login (age-restricted, withheld in a jurisdiction). The code and the sentence the bot's failure reply names for the same case |
| 502 | `upstream_unreadable`: syndication timeout or schema drift (an unknown payload shape, or the empty body X returns when it rejects the request token) |
| 503 | `upstream_busy`: X declined to serve for now, either rate-limiting us (429) or answering with its own 5xx. Retry in a minute |

---

### `POST /events/import-archive/presign` 🔒

Step one of the archive import: mint a staging key and a presigned direct-to-storage upload for your (browser-stripped) zip. The archive never transits the API. The target is an S3 POST policy (or the dev upload endpoint against local storage, same shape): POST a `multipart/form-data` form to `upload.url` carrying every `upload.fields` entry ahead of the file part, no credentials. The policy pins the exact key, `application/zip`, and the size guard (4 GB), and expires after 15 minutes. No content validation here.

**Request:** empty body.

**Response 200:**
```json
{
  "upload_key": "archive-imports/<user-id>/<uuid>.zip",
  "upload": {
    "url": "https://<bucket>.s3.<region>.amazonaws.com/",
    "fields": { "key": "…", "Content-Type": "application/zip", "policy": "…", "…": "…" }
  }
}
```

**Errors:** 401 not authenticated.

---

### `POST /events/import-archive` 🔒

Step two: enqueue the staged archive for the backfill worker. The upload **is the consent**: every geolocation lands `detected`, attributed to you. The job runs under the X handle linked to your account, which is what every provenance permalink is written from; a job whose owner carries no linked handle lands `failed`. The request verifies the staged object (your own `upload_key`, present, under the size guard; a storage HEAD, the zip is never opened here) and returns a **`queued` job (202)**: the worker service (see [`ingestion.md`](ingestion.md#archive-import-worker)) runs the import off the request path and emails you the outcome. Poll the job (below) for the counts. A malformed zip therefore surfaces as a `failed` job plus a failure email, not a synchronous 4xx. The browser strip catches the common shapes before upload.

**Tweets-only intake guard.** The backend extracts only the allowlisted entries (`tweets.js`, `tweets_media/`); everything else (DMs, email, account data, `deleted-*`) is never read. The allowlist is anchored on the export root the `tweets.js` sits in, so a sibling directory whose name contains `tweets_media/` (`deleted_tweets_media/`, the media of deleted posts) and the media of a second export nested in the same zip stay outside it. The browser strip anchors the same way before upload. Extraction is hardened against zip-slip and zip-bombs; the per-media caps applied when a detection is persisted are the product limits (see [`ingestion.md`](ingestion.md#archive-import-worker)).

Idempotent on the thread's post ids plus the coordinate (see [re-import](ingestion.md#re-import)), so a re-upload is a free catch-up and so is an export of posts the bot or the paste already imported. A detection with no recoverable media persists media-incomplete; you add media before submitting.

A thread whose sole source candidate is an X status has that footage chased via syndication. An unreachable status still lands the tweet, without a source. A sole `t.me/<channel>/<id>` candidate has that post's public embed chased for its date and, when the embed serves it, its media; a sensitive post degrades to link and date. Several candidates leave the source empty and chase nothing (see [`ingestion.md`](ingestion.md#the-contract)).

**Request:** JSON. `upload_key` from the presign; `post_estimate` (optional, ≥ 1) is the browser strip's cosmetic volume hint for the queued display (the worker stamps the exact totals).
```json
{ "upload_key": "archive-imports/<user-id>/<uuid>.zip", "post_estimate": 1240 }
```

**Response 202:**
```json
{
  "id": "uuid",
  "status": "queued",
  "post_estimate": 1240,
  "progress_done": 0,
  "progress_total": null,
  "created": 0, "updated": 0, "skipped": 0, "failed": 0,
  "error": null,
  "created_at": "2026-07-17T12:00:00Z"
}
```

**Errors:**
| Code | Case |
|------|------|
| 400 | `archive_upload_invalid` (not a staging key you minted: wrong shape, or another user's) |
| 401 | Not authenticated |
| 404 | `archive_upload_missing` (nothing uploaded at `upload_key`) |
| 413 | `archive_too_large` (the staged object is over the size guard) |

---

### `GET /events/import-archive/{job_id}` 🔒

One archive-import job. Owner only: someone else's job ID reads as 404, indistinguishable from unknown. The upload page polls this endpoint until `status` is terminal. The completion email is the durable signal for an analyst who has since left.

`status` walks `queued` → `running` → `done` | `failed`. `post_estimate` is a free zip-metadata volume hint stamped at enqueue (declared `tweets.js` size over a per-record average; a display hint, not a promise); once the worker's parse has the exact detection count it stamps `progress_total` and batches `progress_done` as rows land, the upload page's live "137 / 412". The counts are final once `done`, and every detection lands in exactly one of them: `created` is new `detected` rows; `updated` an open detection the import overwrote with a newer parse; `skipped` a detection whose matched row the import leaves alone (published, rejected, withheld, removed, or already up to date); `failed` a detection that raised mid-persist (the rest still land). The [re-import rule](ingestion.md#re-import) states which row gets which. A `failed` **job** keeps whatever landed before the failure (re-uploading skips it and continues); `error` is a terse operator-facing reason. Rate-limited to 60/min/IP.

**Response 200:** the job payload above, counts filled per status.

---

### `GET /events/{id}`

Full detail for a single event, in any lifecycle state.

A withheld event (`hidden_at` set by an admin, directly or by resolving a [content report](#post-eventsidreport) as `hidden`) answers 404 for everyone but an admin. An admin still reads it, since judging the report that took it down means seeing what was taken down; the payload carries no `hidden_at` field, so a withheld event reads exactly like a live one on the wire. Soft-deleted events answer 404 for every caller, admins included.

**Response 200:**
```json
{
  "id": "uuid",
  "title": "Strike on depot, Donetsk",
  "event_coords": { "lat": 48.123, "lng": 37.456 },
  "capture_source_coords": null,
  "source_url": "https://t.me/channel/12345",
  "archived_source": {
    "url": "https://web.archive.org/web/20260316094500/https://t.me/channel/12345",
    "provider": "wayback"
  },
  "secondary_source_urls": ["https://x.com/mirror_handle/status/1234567890"],
  "archived_secondary_sources": [
    { "url": "https://archive.ph/aBcDe", "provider": "archive_today" }
  ],
  "proof": { "type": "doc", "content": [] },
  "event_date": "2026-03-15",
  "event_time": "14:30:00",
  "source_posted_at": "2026-03-14T18:05:00Z",
  "created_at": "2026-03-16T09:42:00Z",
  "geolocated_at": "2026-03-16T09:42:00Z",
  "closed_at": null,
  "is_graphic": false,
  "status": "geolocated",
  "version_no": 1,
  "close_reason": null,
  "before_closed_status": null,
  "detected_from_url": null,
  "detected_via": null,
  "archived_detected_from": null,
  "owner": {
    "id": "uuid",
    "username": "kalush"
  },
  "requested_by": null,
  "geolocators": [
    { "id": "uuid", "username": "kalush" }
  ],
  "media": [
    {
      "id": "uuid",
      "role": "source",
      "storage_url": "https://d10w3bld05vsky.cloudfront.net/uploads/.../video.mp4",
      "media_type": "video",
      "sha256": "f7c3bcd13f00e8a4b2d4e9b3f1a2c5d6e7f8901234567890abcdef1234567890",
      "original_filename": "IMG_2034.MOV"
    }
  ],
  "thumbnail": {
    "id": "uuid",
    "role": "source",
    "storage_url": "https://d10w3bld05vsky.cloudfront.net/uploads/.../video.mp4",
    "media_type": "video",
    "sha256": "f7c3bcd13f00e8a4b2d4e9b3f1a2c5d6e7f8901234567890abcdef1234567890",
    "original_filename": "IMG_2034.MOV"
  },
  "tags": [
    { "name": "Drone", "category": "capture_source" }
  ],
  "conflicts": [
    { "id": "uuid", "name": "Russian invasion of Ukraine", "wikidata_id": "Q110999040", "start_year": 2022, "end_year": null, "ongoing": true, "tier": "major" }
  ]
}
```

`event_coords` is the subject point, `null` on a coordinate-less `requested` event; every `geolocated` row carries it. `capture_source_coords` is the optional camera position, `null` unless the submitter set it. `source_url` / `source_posted_at` are `null` on a `detected` row with no declared source (see [`ingestion.md`](ingestion.md)); a `requested` or `geolocated` row always carries a `source_url`. `archived_source` is the archived copy of that `source_url`: `url` is the snapshot and `provider` (`wayback` or `archive_today`) is the service holding it. One copy per link, whichever service produced it. The field is `null` when no copy has been recorded, which is every link's starting state, since archival is an act the event's owner performs (see [`archival.md`](archival.md)). `secondary_source_urls` is the ordered list of optional mirrors (same footage on another network, or another post of it from the same point of view), always present and empty when the event declares none; unlike `source_url` it carries no requester protection, a fulfiller's `geolocate` call replaces the whole list. `archived_secondary_sources` is the same list's archived copies, same length and same order: entry `i` covers mirror `i`, with the same shape and the same `null` conditions as `archived_source`, and the detail surface renders each beside its mirror. `archived_detected_from` is the archived copy of `detected_from_url`, on the same terms again, and `null` for a human submit, which carries no provenance link. `detected_via` names the ingest entry that produced a machine detection, `bot`, `paste` or `archive` (see [`ingestion.md`](ingestion.md)); it is read-only, stamped once at creation, and `null` for a human submit and for machine rows that predate it. `requested_by` is the analyst who opened the request, `null` on a directly-created event (no request preceded it). `geolocators` is the durable credit list (who vouched the location, oldest first; empty until the first `geolocate`). `version_no` is which version of the event this payload is: `1` until its owner corrects it, and one higher per correction (see [`POST /events/{id}/versions`](#post-eventsidversions)). `geolocated_at` is when the row became `geolocated`, `null` before publication; the version history credits version 1 to that instant, every later version to the edit that produced it. `close_reason` / `before_closed_status` are `null` while the event is open. `media` carries only the event's `source` attachment(s); a `proof` image never appears here, it lives inline in the `proof` document as a URL. `thumbnail` is the picked card thumbnail (the `source` attachment, else the first `proof` image, else `null`; same rule as [`GET /events`](#get-events)), so previews built on this payload (the map pin hover) render it without re-deriving the pick. `is_graphic` is `true` when the footage is flagged as showing death, injury or human remains; every media surface that renders this event's images or video covers them behind [`GraphicContentGate`](design.md#components) while it is.

**Errors:**
| Code | Case |
|------|------|
| 404 | Event not found, soft-deleted, or withheld (`hidden_at` set) and you are not an admin |

---

### `POST /events/{id}/report` 🌐

Report an event for moderation. Open to anonymous viewers: the people a piece of footage harms rarely hold an account here, so requiring one would block the reports this endpoint exists to collect. A signed-in reporter is recorded on the row (`reporter_user_id`); an anonymous one leaves it `null`. The per-IP rate limit is the only abuse floor on this write.

**Request body:**
```json
{
  "reason": "graphic_not_flagged",
  "details": "Shows a body at 0:14, no graphic-content warning on the card."
}
```

`reason` is one of `illegal_content`, `graphic_not_flagged`, `copyright`, `privacy`, `other`. `details` is optional free text, capped at 2000 characters.

**Response 201:**
```json
{
  "id": "uuid",
  "event_id": "uuid",
  "reason": "graphic_not_flagged",
  "details": "Shows a body at 0:14, no graphic-content warning on the card.",
  "reporter_user_id": null,
  "created_at": "2026-08-12T09:14:00Z",
  "resolved_at": null,
  "resolution": null
}
```

**Errors:**
| Code | Case |
|------|------|
| 404 | `event_not_found`: unknown id, soft-deleted, or already withheld. All three answer the same way, so the response can't be used to probe which |
| 429 | Rate-limited (10/hour/IP) |

---

### `POST /events` 🔒

Create an event directly, born `geolocated`. To open a request without coordinates, use [`POST /events/requests`](#post-eventsrequests); to give an existing `requested` / `detected` event a location, use [`POST /events/{id}/geolocate`](#post-eventsidgeolocate).

**Request body (`multipart/form-data`):**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Title, 1-255 chars. |
| `lat` | float | yes | Latitude (-90 to 90) of the subject: what the footage shows. |
| `lng` | float | yes | Longitude (-180 to 180) of the subject. |
| `capture_source_lat` | float | no | Latitude of the camera position (where the footage was shot from). Both-or-neither with `capture_source_lng`. |
| `capture_source_lng` | float | no | Longitude of the camera position. |
| `source_url` | string | yes | Original source URL, ≤2000 chars. |
| `source_snapshot_url` | string | no | The archived copy of `source_url`, ≤2000 chars, if you archived it while filling the form. Checked and stored in the same transaction as the event, on the terms [`archival.md`](archival.md) states: a paste that is not a snapshot of `source_url` is a 400 and no event is created. |
| `secondary_source_urls` | string[] (repeated field) | no | Optional mirrors of the same media (another network, or another post from the same point of view), one form field per link, each ≤2000 chars. Normalized server-side (stripped, blanks dropped, duplicates dropped, an entry equal to `source_url` dropped, order preserved); more than 10 after normalization is `too_many_source_links`. |
| `secondary_snapshot_urls` | string[] (repeated field) | no | The archived copy of each mirror, one form field per entry of `secondary_source_urls` and aligned with it by position; send an empty value for a mirror you did not archive. Each is checked against the mirror it sits beside and stored under origin `secondary_source`, on the contract `source_snapshot_url` follows. The pairing happens before normalization, so a copy stays on the link it was posted under; a copy whose mirror normalization drops is dropped with it. |
| `event_date` | string (YYYY-MM-DD) | no | When the depicted event happened. Omitted / empty → stored NULL (the footage doesn't always establish the date; renders as *Unknown*). |
| `event_time` | string (HH:MM) | no | Optional time-of-day for the event (UTC). Omitted / empty → stored NULL. |
| `source_posted_at` | string (`YYYY-MM-DDTHH:MM`) | yes | When the source posted the media, a full instant, read as UTC. Required on this path; you supply it, since an off-platform source doesn't always carry a machine-readable date. Distinct from `event_date` and the submission time. |
| `proof` | string (JSON) | no | Serialized Tiptap document. Its inline images reference not-yet-uploaded files as `placeholder://<filename>`, resolved against `proof_files`. |
| `tag_ids` | string (JSON array) | yes | `["uuid1", "uuid2"]`. **Must include at least one `capture_source` tag** (see *Required categories* below). |
| `conflict_ids` | string (JSON array) | yes | `["uuid1"]`. Ids from the [conflict referential](#conflicts). **At least one is required** (see *Required categories* below). |
| `is_graphic` | boolean | no | The author's declaration that the footage shows death, injury or human remains. Defaults to `false`. Viewers see flagged media behind an age confirmation. Once set, only [`PATCH /admin/events/{id}/moderation`](#patch-admineventsidmoderation) clears it. |
| `file` | File | yes | Exactly one source file (image or video): the footage. |
| `proof_files` | File[] | no | The proof body's inline images, matched to its `placeholder://` srcs by filename. At least one is required (see *Required categories*). |

**Response 201:** same shape as `GET /events/{id}`, born `"status": "geolocated"` with `requested_by: null` and you in `geolocators`.

**Required categories.** Three legs of the evidence floor, checked before any upload so a rejection doesn't pay an S3 round-trip: (1) exactly one source `file`; (2) at least one image in the `proof` body (an already-uploaded URL or a `placeholder://` resolved from `proof_files`); (3) `conflict_ids` must resolve to at least one [conflict](#conflicts) (error message "A conflict is required") and `tag_ids` to at least one tag of category `capture_source`, the curated, server-managed taxonomy (see [`Tags`](#tags)). Both domains ship an escape value (conflict → `"Other"`, `capture_source → "Unknown"`) so the requirement is always satisfiable; either miss rejects with `tag_requirements_not_met`.

**Errors:**
| Code | Case |
|------|------|
| 400 | Typed `{code, message}` branch: `invalid_coordinates`, `media_required` (no source file), `invalid_proof` (sanitizer rejection), `proof_image_required` (no proof image), `tag_requirements_not_met` (missing conflict or `capture_source` tag), `too_many_source_links` (more than 10 `secondary_source_urls` after normalization), `invalid_file` (disallowed MIME / size), `evidence_processing_failed`, or `proof_files_mismatch` (a `placeholder://` src with no matching `proof_files` upload, or vice versa), or a rejected `source_snapshot_url` / `secondary_snapshot_urls` entry (the `snapshot_*` codes listed under [*Error envelope*](#api-reference)) |
| 409 | `source_media_conflict`, a concurrent request raced past the one-source-per-event index |
| 413 | Request body exceeds the platform body-size cap (`max_video_size + max_proof_images_per_event × max_image_size + 10 MB` headroom). Pre-checked by the HTTP-layer middleware before any bytes touch the worker; 413 responses traverse CORS so cross-origin callers see a clean status instead of a CORS error. |
| 422 | Malformed input: `event_date` (not a YYYY-MM-DD date), `event_time` (not HH:MM), `source_posted_at` (not an ISO datetime), **more than `max_proof_images_per_event` files** in `proof_files` (`too_many_files`), `title` over 255 chars, `source_url` or a single `secondary_source_urls` item over 2000 chars. All match the same-shape rejection on `GET /events` filter params and `_parse_bbox`. |

---

### `GET /events/detections` 🔒

Your "Detections" queue: your machine-`detected` events awaiting a geolocate, newest first (`created_at` desc). **Scoped to `current_user`**: it ignores any URL username and never exposes another analyst's rows. Powers `/profile/{username}/detections`, where you review and geolocate each detection. Returns the **full detail** shape (media + tags), not the lightweight list card, so the queue shows the evidence and names what each row is missing without a per-row fetch.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | int | Page number (default 1). Below 1 or non-numeric returns 422. |
| `per_page` | int | Rows per page (default 20). Clamped to the 100-row [cap](#pagination); below 1 or non-numeric returns 422. |
| `readiness` | string | Which detections to page through: `all` (default), `ready`, or `incomplete`. Any other value returns 422. |

**Readiness.** A detection is `ready` when it carries every piece of evidence a publish needs and waits only on the two judgments a review supplies (a conflict and a `capture_source` tag): a `source` media row, a non-blank `source_url`, coordinates, and a proof body embedding at least one image. `incomplete` is the exact complement, so the two sets partition the queue and no detection falls out of both. The filter runs in SQL over the whole queue, not over the page you loaded, so `readiness=ready` on page 1 answers about every detection you hold.

**Response 200:** each item is the same shape as `GET /events/{id}`.
```json
{
  "items": [ { "id": "uuid", "status": "detected", "media": [], "tags": [] } ],
  "total": 248,
  "page": 1,
  "per_page": 20,
  "ready_total": 248,
  "incomplete_total": 213
}
```

`total` counts the set `readiness` selected, so the page count you compute from it describes what you are paging through. `ready_total` and `incomplete_total` count the whole queue under every `readiness` value, so one call states the split; they sum to `total` when `readiness=all`.

A detection carries no location it was promoted from; `requested_by` is always `null` here (a detection is machine-born, not opened as a request).

**Errors:**
| Code | Case |
|------|------|
| 401 | Not authenticated |
| 422 | `readiness` outside `all` / `ready` / `incomplete`, or out-of-range paging |

---

### `POST /events/requests` 🔒

Opens a request: creates a `requested` event with no coordinates yet (ex `POST /requests`). One source file is required, since the platform treats a request as an "unfinished geolocation." Coordinates, the camera point, tags, and the event date are all optional (an approximate guess is allowed, both-or-neither on each coordinate pair). You are recorded as both `owner` and `requested_by`. `requested_by` survives the later `geolocate`.

**Request body (`multipart/form-data`):**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Title; empty / whitespace-only rejected. Max 255 chars. |
| `source_url` | string | yes | URL where the media was found. Max 2000 chars. |
| `source_snapshot_url` | string | no | The archived copy of `source_url`, same contract as [`POST /events`](#post-events). One form posts either shape, so a snapshot taken while filling it is kept whichever you publish. |
| `secondary_source_urls` | string[] (repeated field) | no | Optional mirrors, same normalization and cap as [`POST /events`](#post-events). |
| `secondary_snapshot_urls` | string[] (repeated field) | no | The archived copy of each mirror, same contract as [`POST /events`](#post-events). |
| `proof` | string (JSON) | no | In-progress proof (Tiptap document); sanitized server-side and image-free (no `proof_files` on this path, inline images are dropped by the sanitizer) |
| `lat` | float | no | Latitude of an approximate guess. Both-or-neither with `lng`. |
| `lng` | float | no | Longitude of an approximate guess. |
| `capture_source_lat` | float | no | Latitude of the camera position, if known. Both-or-neither with `capture_source_lng`. |
| `capture_source_lng` | float | no | Longitude of the camera position. |
| `event_date` | string (YYYY-MM-DD) | no | When the depicted event happened. Often unknown for a request. |
| `event_time` | string (HH:MM) | no | Optional time-of-day for the event (UTC); requires `event_date`. |
| `source_posted_at` | string (`YYYY-MM-DDTHH:MM`) | yes | When the source posted the media, a full instant (UTC). |
| `tag_ids` | string (JSON array) | no | `["uuid1", "uuid2"]`. Not required to open a request; the curated floor is enforced at `geolocate`. |
| `conflict_ids` | string (JSON array) | no | Ids from the [conflict referential](#conflicts). Optional here, like `tag_ids`. |
| `file` | File | yes | Exactly one source file (image or video). |

**Response 201:** same shape as `GET /events/{id}`, with `"status": "requested"` and `event_coords` / `capture_source_coords` `null` unless a guess was supplied.

**Errors:**
| Code | Case |
|------|------|
| 400 | Plain-string validation (empty / whitespace-only `title` or `source_url`) **or** a typed `{code, message}` branch: `invalid_coordinates` (a half-typed guess pair), `media_required` (no file), `invalid_proof`, `too_many_source_links` (more than 10 `secondary_source_urls` after normalization), `invalid_file`, `evidence_processing_failed`, or a rejected `source_snapshot_url` / `secondary_snapshot_urls` entry (the `snapshot_*` codes listed under [*Error envelope*](#api-reference)) |
| 413 | Request body exceeds the platform body-size cap, same middleware as `POST /events` |
| 422 | `title` over 255 chars / `source_url` or a single `secondary_source_urls` item over 2000 chars, malformed `event_date` / `event_time` / `source_posted_at`, missing required `source_posted_at`, or `event_time` without `event_date` |

---

### `POST /events/{id}/geolocate` 🔒

Gives an event a vouched location: transitions `requested` | `detected` → `geolocated` in one atomic request, writing your whole edited form. This is the **single** fulfil / geolocate path. A `detected` row is immutable machine output, so this is the **only** write to it, and it stays owner-only. A `requested` event is answerable by anyone, and you become its `owner` (`requested_by` keeps the original poster). **Multipart**, mirroring `POST /events`: the form posts the whole row state, and the server applies the field updates, media removals, and new-media uploads, then publishes the row as `geolocated`, in one transaction under a row lock (a concurrent geolocate on the same row serializes, and the loser gets 409). Allowed **only while `requested` / `detected`**: past publication a row is corrected through [`POST /events/{id}/versions`](#post-eventsidversions), which files the version it supersedes.

**Request body (`multipart/form-data`):**
| Field | Type | Description |
|-------|------|-------------|
| `title` | string | 1-255 chars |
| `lat` | float | Latitude (-90 to 90) of the subject |
| `lng` | float | Longitude (-180 to 180) of the subject |
| `capture_source_lat` | float | Latitude of the camera position. Both-or-neither with `capture_source_lng`. |
| `capture_source_lng` | float | Longitude of the camera position. |
| `source_url` | string | ≤2000 chars, the footage origin. A detection may start with no declared source (`null`, see [`ingestion.md`](ingestion.md)): a blank value here 400s as `source_url_required`, since a `geolocated` row always carries one. Fulfilling a `requested` event ignores this field and keeps the request's `source_url`, so you can't rewrite the requester's evidence anchor. Past publication the same correction goes through [`POST /events/{id}/versions`](#post-eventsidversions), which files the version it supersedes |
| `source_snapshot_url` | string | The archived copy of the source URL this write stores, ≤2000 chars, same contract as [`POST /events`](#post-events). On a `requested` fulfilment it is checked against the request's own `source_url`, the one that is kept. Whether or not you send it, a write that changes `source_url` never keeps a copy of the old one filed as the archived source: see [`archival.md`](archival.md). |
| `secondary_source_urls` | string[] (repeated field) | Optional mirrors, same normalization and cap as [`POST /events`](#post-events). Unlike `source_url`, this field is **not** ignored on a `requested` fulfilment: the submitted list replaces whatever the row held, the mirrors carrying none of the requester's evidence anchor protection. |
| `secondary_snapshot_urls` | string[] (repeated field) | The archived copy of each mirror, same contract as [`POST /events`](#post-events). Filed against the links this write stores, so a copy posted beside a mirror the write drops is dropped with it. |
| `event_date` | string (YYYY-MM-DD) | When the depicted event happened. Optional, mirroring create: empty / omitted stores NULL (renders as *Unknown*) |
| `event_time` | string (HH:MM) | Optional time-of-day for the event (UTC); empty / omitted clears it |
| `source_posted_at` | string (`YYYY-MM-DDTHH:MM`) | When the source posted the media, a full instant (UTC). Required on this path; you supply it, since an off-platform source doesn't always carry a machine-readable date |
| `proof` | JSON string | Tiptap document (sanitized); its `placeholder://` srcs resolve against `proof_files`, already-uploaded URLs pass through untouched |
| `tag_ids` | JSON string (UUID[]) | Replaces the tag set wholesale |
| `conflict_ids` | JSON string (UUID[]) | Replaces the event's [conflict](#conflicts) set wholesale |
| `is_graphic` | boolean | The graphic-content declaration. Unlike every other field here it ratchets: `true` sets the flag, and `false` leaves an already-flagged event flagged. To clear the flag, use [`PATCH /admin/events/{id}/moderation`](#patch-admineventsidmoderation), which audits the unmark |
| `remove_media_ids` | JSON string (UUID[]) | Existing source media to drop (S3 swept: nothing is versioned before publication) |
| `files` | file[] | New source media to add (0 or 1; kept + new must total exactly one, same allowlist + size limits as create) |
| `proof_files` | file[] | New proof images referenced by `placeholder://` srcs in `proof` |

`detected_from_url` (the provenance anchor: the post the detection was imported from) and `status` accept no field, so the backend ignores them if you send them. Blocked until the evidence floor a direct create meets is satisfied by the post-geolocate state: **exactly one source media** (kept + new), **at least one proof image** in the final proof body, and **one conflict + one `capture_source` tag**. A `requested` event and a machine detection are both born without the curated floor, so it is enforced here: you add the conflict and tags as part of the geolocate.

**Response 200:** same shape as `GET /events/{id}` (now `"status": "geolocated"`, you added to `geolocators`).

**Errors:**
| Code | Case |
|------|------|
| 400 | `invalid_coordinates`, `invalid_proof`, `proof_image_required` (no proof image in the final body), `tag_requirements_not_met`, `too_many_source_links` (more than 10 `secondary_source_urls` after normalization), a rejected file or a proof src naming another event's image (`invalid_file` / `evidence_processing_failed`), no surviving source media (`media_required`), `proof_files_mismatch`, `source_url_required` (a detection with no declared source, geolocated with a blank `source_url` field), or a rejected `source_snapshot_url` / `secondary_snapshot_urls` entry (the `snapshot_*` codes listed under [*Error envelope*](#api-reference)) |
| 403 | You are not the owner of a detection (a `requested` event is answerable by anyone) |
| 404 | Event not found (incl. soft-deleted) |
| 409 | Row is not `requested` / `detected` (`invalid_state`; a published row is corrected through [`POST /events/{id}/versions`](#post-eventsidversions)), or `source_media_conflict` (a concurrent edit raced past the one-source cap) |
| 422 | Kept + new source media over one (`too_many_files`), a proof body that would display more than `max_proof_images_per_event` images (its already-uploaded images plus the new files), or a single `secondary_source_urls` item over 2000 chars |

---

### `POST /events/batch-complete` 🔒

Publish a selection of your own detections in one call: the bulk door onto the same `detected` → `geolocated` transition [`POST /events/{id}/geolocate`](#post-eventsidgeolocate) performs one row at a time. **JSON, not multipart**: nothing uploads here and no field is written. A machine detection already carries its title, coordinates, source and (when the imported thread had annotation media) its proof images, so the call supplies only what the machine can't judge: the **conflict**, once for the whole selection, and one **`capture_source` tag per row**.

Each row runs in its **own transaction** against the **same evidence floor** as the single-row transition: one source media, at least one proof image in the stored proof body, a conflict, a `capture_source` tag, plus the coordinates and `source_url` a `geolocated` row always carries. A row that fails rolls back alone and stays a detection. The rest of the selection still publishes. Publishing a row credits you in `event_geolocators`, exactly as a single geolocate does.

Owner only: every targeted detection must belong to you. There is no fulfil-someone-else's-row path here, unlike `requested` events.

**Request body:**
```json
{
  "conflict_ids": ["3f1c…"],
  "rows": [
    { "event_id": "9a2b…", "capture_source_tag_id": "77de…" },
    { "event_id": "5c04…", "capture_source_tag_id": "9b31…" }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `conflict_ids` | UUID[] | 1-10 [conflicts](#conflicts), applied to every row. Replaces whatever conflicts the detections held |
| `rows` | object[] | 1-100 detections, one row per `event_id` (a repeated id is a 422). `event_id` is a `detected` row you own; `capture_source_tag_id` is one curated `capture_source` tag, replacing an imported one rather than adding to it. Other tags on the detection survive |

**Response 200:** verdicts in the order the rows were submitted.
```json
{
  "published": 1,
  "failed": 1,
  "rows": [
    { "event_id": "9a2b…", "published": true, "code": null, "message": null },
    { "event_id": "5c04…", "published": false, "code": "proof_image_required",
      "message": "At least one proof image is required" }
  ]
}
```

A `200` does **not** mean everything published; read `published` / `failed`. A failed row's `code`:

| `code` | Case |
|--------|------|
| `source_url_required` | The detection carries no source URL |
| `coordinates_required` | The import found no location in the thread, so the detection carries no point |
| `media_required` | The detection carries no `source` media row |
| `proof_image_required` | The stored proof body holds no image (the imported thread carried no annotation media) |
| `tag_requirements_not_met` | The row's `capture_source_tag_id` is unknown or is not a `capture_source` tag |
| `invalid_state` | The row is no longer `detected` |
| `event_not_found` | Hard-deleted, or soft-deleted by an admin |
| `internal_error` | A database failure on that row alone. Every other row's verdict still stands, and the detection is untouched, so the row is retriable as-is |

The first six are the same stable codes the single-row geolocate answers with, and they are checked in the order above.

**Errors** (whole-call, evaluated before any row publishes):
| Code | Case |
|------|------|
| 400 | `tag_requirements_not_met`: no `conflict_ids` entry resolves to a live conflict, so no row could clear the floor |
| 403 | A targeted detection belongs to another analyst; nothing is published |
| 422 | Empty `conflict_ids` / `rows`, over 10 conflicts, over 100 rows, the same `event_id` in two rows, or a malformed UUID |

---

### `POST /events/{id}/versions` 🔒

Correct a published event. Owner-only, and only while `geolocated`: the state a correction applies to is the vouched record, so before publication a row is edited through its own path ([`POST /events/{id}/geolocate`](#post-eventsidgeolocate) for a detection or a request). The write files the pre-edit state as a version, applies your form, and moves the event to the next `version_no`, all in one transaction under a row lock. Two concurrent edits therefore take their numbers in order rather than racing. **Multipart**, mirroring geolocate.

**Editability contract.** Everything the publish form wrote is editable and versioned, the **evidence anchor** included: the title, both coordinate sets, the event date and hour, the source post time, the graphic-content flag, the tags, the conflicts, the proof body with its inline images, the secondary source links, `source_url`, and the source media. The anchor moves on the fields [`POST /events/{id}/geolocate`](#post-eventsidgeolocate) takes, under the same one-source cap: `remove_media_ids` drops the stored media and `files` carries its replacement. The version this call files records the source URL and the source media it supersedes, so the record still shows what the claim rested on. `detected_from_url` (the provenance link) is the one field no write moves, at any point in the lifecycle.

**This is also where a published record's archived copies are recorded.** `source_snapshot_url`, `detected_from_snapshot_url` and `secondary_snapshot_urls` archive a link without changing it, which is why the two immutable links carry the field at all. Each lands in the version this call produces, so one call files one version carrying the edit and the copies. Which of a record's links are archived is part of what the record says, so a save whose only change is a copy is a version like any other, and the changed-field list names it *Archived copies*. See [`archival.md`](archival.md).

**Request body (`multipart/form-data`):**
| Field | Type | Description |
|-------|------|-------------|
| `title` | string | 1-255 chars |
| `lat` | float | Latitude (-90 to 90) of the subject |
| `lng` | float | Longitude (-180 to 180) of the subject |
| `capture_source_lat` | float | Latitude of the camera position. Both-or-neither with `capture_source_lng`. |
| `capture_source_lng` | float | Longitude of the camera position. |
| `source_url` | string | ≤2000 chars, the footage origin. Optional here, unlike on geolocate: omitted or empty keeps the URL the row holds, a whitespace-only value 400s as `source_url_required` (a `geolocated` row always carries one), and any other value replaces it, the version this call files keeping the old one readable |
| `source_snapshot_url` | string | The archived copy of the source URL this write stores, ≤2000 chars, checked as every archived-copy field is (see [`archival.md`](archival.md)). It lands in the version this edit produces, so one call files one version carrying both. A copy of a source URL this edit replaced is re-filed against the link it still covers or dropped, exactly as on geolocate |
| `detected_from_snapshot_url` | string | The archived copy of `detected_from_url`, the post a machine detection came from, ≤2000 chars and on the same terms. Accepted for the same reason: the provenance link is immutable, and archiving it is not a change to it. A 400 (`original_url_not_on_event`) on a row carrying no provenance link |
| `secondary_source_urls` | string[] (repeated field) | Optional mirrors, same normalization and cap as [`POST /events`](#post-events). The submitted list replaces whatever the row held |
| `secondary_snapshot_urls` | string[] (repeated field) | The archived copy of each mirror, same contract as [`POST /events`](#post-events). Lands in the version this edit produces, so one call files one version carrying the edit and the copies |
| `event_date` | string (YYYY-MM-DD) | When the depicted event happened. Empty / omitted stores NULL (renders as *Unknown*) |
| `event_time` | string (HH:MM) | Optional time-of-day for the event (UTC); empty / omitted clears it |
| `source_posted_at` | string (`YYYY-MM-DDTHH:MM`) | When the source posted the media, a full instant (UTC). Optional: empty / omitted keeps the instant the row holds, NULL included (a detection whose source post time was never resolved publishes with it NULL through [`POST /events/batch-complete`](#post-eventsbatch-complete)). Only a value replaces it, so an edit that leaves the field blank never clears a stored instant |
| `proof` | JSON string | Tiptap document (sanitized); its `placeholder://` srcs resolve against `proof_files`, already-uploaded URLs pass through untouched |
| `tag_ids` | JSON string (UUID[]) | Replaces the tag set wholesale |
| `conflict_ids` | JSON string (UUID[]) | Replaces the event's [conflict](#conflicts) set wholesale |
| `is_graphic` | boolean | The graphic-content declaration. Ratchets exactly as on geolocate: `true` sets the flag, `false` leaves an already-flagged event flagged. To clear it, use [`PATCH /admin/events/{id}/moderation`](#patch-admineventsidmoderation) |
| `note` | string | Optional, ≤280 chars. Your own words about this edit, stored on the version it supersedes and read back by [`GET /events/{id}/versions`](#get-eventsidversions) |
| `remove_media_ids` | JSON string (UUID[]) | The source media to drop. Its S3 object is **not** swept: the version this call files renders it |
| `files` | file[] | The replacement source media (0 or 1; kept + new must total exactly one, same allowlist + size limits as create) |
| `proof_files` | file[] | New proof images referenced by `placeholder://` srcs in `proof` |

The published evidence floor is re-checked against the post-edit state, so a correction cannot drop the row below what publishing it required: a source media on the row, at least one proof image in the final proof body, one conflict, and one `capture_source` tag.

**A version has to change something.** The form posts the whole editable state, so an edit that moves none of the versioned fields (the ones listed under *Editability contract*, plus the archived copies) is refused with `nothing_changed` rather than filed: a version spends a number in a public address space and prints a row in the history, and one identical to the row it supersedes would claim a correction that never happened. The `note` is not a versioned field, so a note on its own does not make a version. The check runs before any file is uploaded.

**An event carries at most 100 versions.** An edit that would produce version 101 is refused with `version_limit`: past that count the history has stopped recording corrections and started recording a loop, and every version costs a snapshot row plus the proof images it pins alive. **A save whose only change is archived copies is exempt** and files its version regardless. Preserving evidence is what the catalog is for, and an original that dies while the row sits at the ceiling would be unarchivable for good, which is a worse record than one more version. A save that also moves a field is an edit, and meets the ceiling.

**Media and history.** A proof image the new body no longer references is normally deleted, row and object. It is kept instead when a readable past version displays it, so that version stays renderable after the image left the current body. A version records the images its own proof body referenced, so an image no version ever displayed is not held alive by the history, and a [redacted](#post-admineventsidversionsversion_noredact) version holds nothing alive at all.

The source media takes the other route, because its row cannot stay: an event carries at most one, so a swap deletes the row it replaces. The version records that media whole (`source_media` in the snapshot, the shape `GET /events/{id}` serves its `media` in) and the S3 object is left in place, so `/events/{id}/vN` renders the footage that version rested on. The object is swept when the event is deleted, or when the last readable version naming it is redacted.

**Proof-image ceiling.** `max_proof_images_per_event` bounds what the new proof body displays, not what one request sends: the already-uploaded images the body still references plus the files it adds. An image kept only because a past version displays it does not count, so swapping images across corrections never exhausts the ceiling. The check runs before anything reaches S3.

**Image ownership.** An already-uploaded src in `proof` must be one of this event's own images: a proof image, its live source media, or a source media a past version still names. A URL naming another event's stored image is rejected (`invalid_file`): the owning event's next correction or [redaction](#post-admineventsidversionsversion_noredact) deletes that file, so a body pointing at it would render a hole.

**Response 200:** same shape as `GET /events/{id}`, with `version_no` one higher.

**Errors:**
| Code | Case |
|------|------|
| 400 | `invalid_coordinates`, `invalid_proof`, `proof_image_required`, `tag_requirements_not_met`, `too_many_source_links`, `media_required` (the edit would leave the row with no source media), `source_url_required` (a blank `source_url` field), a rejected file or a proof src naming another event's image (`invalid_file` / `evidence_processing_failed`), `proof_files_mismatch`, or a rejected `source_snapshot_url` / `secondary_snapshot_urls` entry (the `snapshot_*` codes listed under [*Error envelope*](#api-reference)) |
| 403 | You are not the owner |
| 404 | Event not found (incl. soft-deleted) |
| 409 | Row is not `geolocated` (`invalid_state`), the save moves no versioned field and no archived copy (`nothing_changed`), the event already carries 100 versions and the save is an edit rather than an archive-only one (`version_limit`), or `source_media_conflict` (a concurrent edit raced past the one-source cap) |
| 422 | `note` over 280 chars, kept + new source media over one (`too_many_files`), a proof body that would display more than `max_proof_images_per_event` images (its already-uploaded images plus the new files), or a single `secondary_source_urls` item over 2000 chars |

---

### `GET /events/{id}/versions` 🌐

The event's superseded versions, newest first. Public, like the event itself: a corrected record is auditable only when its corrections are readable. The live row is the current version and is not listed here, so an event nobody has corrected answers with an empty list.

Paged like every list endpoint: 50 rows a page by default, capped at 100 however large `limit` is, and a caller reading past the first page follows the `cursor` in the `Link: rel="next"` header. `total` is the whole history, not the page. Rows come back in `version_no` order, which is also what the cursor keys on: the number is unique per event and taken under the event's row lock, so it orders the history without a tiebreaker.

**Query parameters:**
| Name | Type | Description |
|------|------|-------------|
| `limit` | int | Rows per page, clamped to 100. Default 50 |
| `cursor` | string | Opaque cursor from a previous response's `Link: rel="next"` header |

**Response 200:**
```json
{
  "items": [
    {
      "id": "uuid",
      "version_no": 1,
      "edited_by": { "id": "uuid", "username": "kalush" },
      "note": "Coordinates were off by a block.",
      "created_at": "2026-03-18T11:20:00Z",
      "redacted": false,
      "snapshot": {
        "title": "Strike on depot, Donetsk",
        "source_url": "https://t.me/channel/12345",
        "source_media": [
          {
            "id": "uuid",
            "role": "source",
            "storage_url": "https://d10w3bld05vsky.cloudfront.net/uploads/.../clip.mp4",
            "media_type": "video",
            "sha256": "9f2c…",
            "original_filename": "clip.mp4"
          }
        ],
        "event_coords": { "lat": 48.123, "lng": 37.456 },
        "capture_source_coords": null,
        "event_date": "2026-03-15",
        "event_time": "14:30:00",
        "source_posted_at": "2026-03-14T18:05:00+00:00",
        "is_graphic": false,
        "secondary_source_urls": [],
        "tags": [{ "id": "uuid", "name": "Drone", "category": "capture_source" }],
        "conflicts": [{ "id": "uuid", "name": "Russian invasion of Ukraine" }],
        "proof": { "type": "doc", "content": [] },
        "proof_media": [
          {
            "id": "uuid",
            "role": "proof",
            "storage_url": "https://d10w3bld05vsky.cloudfront.net/proof/.../overlay.jpg",
            "media_type": "image",
            "sha256": "3b71…",
            "original_filename": "overlay.jpg"
          }
        ],
        "archives": [
          {
            "original_url": "https://t.me/channel/12345",
            "origin": "source_url",
            "snapshot_url": "https://web.archive.org/web/20260316094500/https://t.me/channel/12345",
            "provider": "wayback",
            "created_at": "2026-03-16T09:45:00+00:00"
          }
        ]
      }
    }
  ],
  "total": 1
}
```

`version_no` is the version the row **holds**, not the one that replaced it: an event whose `version_no` is 3 answers with snapshots 2 and 1, and the live row is version 3. `edited_by` is the analyst whose edit superseded that version, `null` once their account is erased. `note` is their optional line about the edit, `null` when they left none. `created_at` is when the edit happened. `redacted` is `true` on a version an admin blanked (see [`POST /admin/events/{id}/versions/{version_no}/redact`](#post-admineventsidversionsversion_noredact)); such a row keeps its number, its `created_at` and its `edited_by`, and serves `{}` as its `snapshot` with `note` `null`.

`snapshot` carries the editable fields as they stood, the evidence anchor included: `source_url` and `source_media` are what the record rested on at that version. Tags and conflicts carry their names alongside their ids, so a version stays readable after a referential row is renamed. `proof_media` and `source_media` carry each media whole, in the shape [`GET /events/{id}`](#get-eventsid) serves `media` in, because the row itself may be gone: an event holds one source media, so a correction that swaps it deletes the row it replaces and the snapshot is what still describes it. `archives` carries the archived copies the record held at that version, one entry per link, sorted by `original_url`; recording a copy on a published event files a version of its own (see [`POST /events/{id}/versions`](#post-eventsidversions)). Every snapshot names the evidence anchor, so a client renders `source_url` and `source_media` from the snapshot alone; a snapshot filed before another field was versioned omits that field, and a client reads the live row for it.

**Errors:**
| Code | Case |
|------|------|
| 404 | Event not found, soft-deleted, or withheld (an admin still reads a withheld row's history, as they do the row itself) |
| 422 | Malformed `cursor`, or `limit` below 1 |

---

### `GET /events/{id}/versions/{version_no}` 🌐

One superseded version by its number, the direct read behind a `/events/{id}/vN` address: a reader opening one version reads that version instead of walking the history until the page holding it comes back. Public and visibility-gated exactly like the list above.

The live row is the current version and is not filed, so its own number answers 404: [`GET /events/{id}`](#get-eventsid) is where the current version is read. A redacted version answers 200 with its blanked shape rather than 404, since the version exists and the record still shows that it does.

**Response 200:** one version, the same shape as an item of [`GET /events/{id}/versions`](#get-eventsidversions).

**Errors:**
| Code | Case |
|------|------|
| 404 | Event not found, soft-deleted, or withheld (an admin still reads a withheld row's history); or the event carries no version under that number, the current version's own number included |

---

### `POST /events/{id}/close` 🔒

Close an event, owner-only, in one verb. The row stays publicly visible with the reason attached, and `before_closed_status` records which state it left, which is what the close means:

| Left | Reads as | What happens to it |
|------|----------|--------------------|
| `requested` | Withdrawn ask | Stays in the `requested` queue view as a closed row |
| `detected` | Rejected machine reading | Stays in the `located` catalog view, and a re-import leaves it closed, so a rejection is not made twice |
| `geolocated` | Public retraction | Leaves the published set, both read views and the map; the page, its `id`, its version history, its credits and its archives stay |

Closing is terminal: there is no un-close, which is why the reason is required. It is the owner's only way to take a row back, destruction being `DELETE /admin/events/{id}`.

A retraction keeps the record because readers act on published claims: someone who cited the coordinate needs the page they cited to say the claim was taken back, and the version history to say what it used to state.

**Request body:**
```json
{ "close_reason": "AI-generated image, not a real event" }
```
`close_reason` is required (1-2000 chars) and stays publicly visible on the closed row.

**Response 200:** same shape as `GET /events/{id}` (now `"status": "closed"`).

**Errors:**
| Code | Case |
|------|------|
| 403 | You are not the owner |
| 404 | Event not found (incl. soft-deleted) |
| 409 | Row is already `closed` (`invalid_state`, the terminal state) |
| 422 | `close_reason` missing or over 2000 chars |

---

## Requests, geolocations, and detections are `/events` views

There is no `/requests` router. A **request** is a `requested` event, a **geolocation** is a `geolocated` event, and a **detection** is a `detected` event, all rows on the one `events` table, distinguished only by `status`. Every read and write above already covers all three:

- **List / detail**: [`GET /events`](#get-events) (`view=requested` is the request queue, `view=located` the geolocation catalog, both carry `detected` rows too) and [`GET /events/{id}`](#get-eventsid) (any status).
- **Open a request**: [`POST /events/requests`](#post-eventsrequests) (no coordinates required).
- **Fulfil a request, or vouch a detection**: [`POST /events/{id}/geolocate`](#post-eventsidgeolocate) (`requested` | `detected` → `geolocated`, one verb for both).
- **Withdraw a request, reject a detection, or retract a geolocation**: [`POST /events/{id}/close`](#post-eventsidclose) (one verb for all three, `before_closed_status` tells them apart).
- **Remove**: `DELETE /admin/events/{id}` (admin soft/hard delete). An owner takes a row back with `close`, which keeps it readable; nothing an owner does destroys a row.

`GET /events/{id}` always carries the `geolocators` list. `Search` groups a hit under `requests` when its `status` is `requested`, see below.

---

## Search

Slice-1 full-text discovery surface across the three first-class entity types. Backed by two Postgres GIN indexes on `to_tsvector('simple', …)` expressions: one over `events.title` and one over `users.username || ' ' || users.bio` (migration `o1j3k5l7m9n1`). One FTS query path serves the single `events` table. The located (`geolocations`) and requested (`requests`) groups run the same `title` index with different `WHERE` clauses (`status IN ('geolocated', 'detected') AND event_coords IS NOT NULL` vs `status = 'requested'`). The `simple` dictionary keeps matching predictable. The response is still grouped by entity type.

**Out of scope for slice 1:** searching `source_url`, JSONB-content search (`events.proof`), per-group infinite scroll, and the filter chips beyond the entity-type pick.

### `GET /search` 🌐

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Free-text query. Empty / whitespace-only short-circuits to empty groups (unless a filter is active). |
| `type` | enum | `all` (default), `event` (the two event groups: what the search page's unified "Events" chip sends), `geolocation`, `request`, or `user`. Anything else → 422. |
| `limit` | int | Per-group cap. 1 ≤ `limit` ≤ 50, default 20. |
| *filter set* | | The standard event filter set, same names and semantics as [`GET /events`](#get-events): `status`, `conflict`, `capture_source`, `tag`, `media` (repeatable), `event_date_from` / `event_date_to`, `submitted_from` / `submitted_to`, `author`. Scopes the two event groups (a `status` value a group's view can't contain empties that group). |

Any active filter empties the users group: the filters are event predicates, and an unfiltered analyst list next to a filtered event view would read as if the filter applied. With an empty `q` and at least one active filter, the API enters **browse mode**: the filtered view, newest first, with plain titles as their own highlight (the profile's "Show more" entry point). Typing then narrows within it.

**Ranking:** `ts_rank` descending then `created_at` descending as a stable tie-breaker.

**Soft-delete:** every group filters `deleted_at IS NULL` at query time.

**Highlight markers:** each hit carries one or more `*_highlight` fields with STX (`U+0002`) / ETX (`U+0003`) control bytes around matched fragments. JSON encodes them as `` / ``. The frontend (`lib/search.ts::splitHighlights`) splits on those bytes and wraps the inner segments in `<mark>`. No raw HTML crosses the wire, so the result is XSS-safe by construction.

**Response 200:**
```json
{
  "geolocations": [
    {
      "id": "uuid",
      "title": "Strike on warehouse complex, Donetsk Oblast",
      "title_highlight": "Strike on warehouse complex, Donetsk Oblast",
      "lat": 48.01, "lng": 37.80,
      "event_date": "2026-04-15",
      "status": "geolocated",
      "owner": { "id": "uuid", "username": "osint_analyst" },
      "media": [{ "id": "uuid", "role": "source", "storage_url": "…", "media_type": "image" }],
      "tags": [{ "id": "uuid", "name": "airstrike", "category": "free" }]
    }
  ],
  "requests": [
    {
      "id": "uuid",
      "title": "Footage from Kharkiv area, can someone place it?",
      "title_highlight": "Footage from Kharkiv area, can someone place it?",
      "source_url": "https://twitter.com/…",
      "status": "requested",
      "created_at": "2026-04-12T08:00:00Z",
      "owner": { "…": "…" },
      "media": [{ "id": "uuid", "storage_url": "…", "media_type": "image" }],
      "tags": []
    }
  ],
  "users": [
    {
      "id": "uuid",
      "username": "kharkiv_osint",
      "username_highlight": "kharkiv_osint",
      "bio": "Tracking armoured movement in Eastern Ukraine.",
      "bio_highlight": null,
      "avatar_url": null
    }
  ],
  "total": { "geolocations": 1, "requests": 1, "users": 1 },
  "query": "kharkiv",
  "type": "all"
}
```

`media` on both event groups carries the picked card thumbnail (at most one row: the `source` attachment, else the first `proof` image), the same rule as the [`GET /events`](#get-events) card.

`bio_highlight` is `null` when only the username matched. The UI uses this to hide the snippet block instead of rendering an unhighlighted bio. Groups you didn't request via `type=` come back as empty arrays.

`total` is a fixed-key object (`geolocations`, `requests`, `users`), each the pre-LIMIT match count for its group (so the UI renders "3 of 142", not "3 of 3"). `type` echoes the request and is one of `all`, `geolocation`, `request`, `user`.

**Errors:**
| Code | Case |
|------|------|
| 422 | `type` outside the allowed set, or `limit` outside [1, 50] |

---

### `GET /search/authors`

Username typeahead for the author filter (the map's and the search page's Author section). The `author` filter is an **exact** match, so this picker is how a partial name becomes a real handle: case-insensitive substring over live users, prefix matches first then alphabetical, capped at 8. `q` takes the same `[A-Za-z0-9_-]{1,50}` gate as `?author=` (empty returns an empty list; anything else 422). Rate-limited to 60/min/IP.

**Response 200:**
```json
{ "authors": ["ana-demo", "analyst2"] }
```

---

## Tags

### `GET /tags`

List tags. By default returns only tags referenced by at least one **live** geolocation.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `category` | string | `capture_source` or `free` |
| `curated` | bool | When `true`, return the full curated `capture_source` taxonomy **regardless of live usage**, ignoring the default usage filter. Conflicts are no longer tags; the full conflict list lives on [`GET /conflicts`](#get-conflicts). |

Returned whole, not paged: the pickers and the filter panel hydrate this vocabulary and filter it client-side. Bounded by the referential ceiling rather than the 100-row list cap (see [Pagination](#pagination)).

**Response 200:**
```json
[
  { "id": "uuid", "name": "Drone", "category": "capture_source" },
  { "id": "uuid", "name": "airstrike", "category": "free" }
]
```

---

### `POST /tags` 🔒

Create a tag. Only `free` tags are creatable; `capture_source` is server-managed and rejected with 403.

**Request body:**
```json
{
  "name": "drone strike",
  "category": "free"
}
```

**Validation.** `name` is stripped of leading / trailing whitespace before any check or DB write, then bounded `1 <= len(name) <= 100` (the `String(100)` column cap on `tags.name`). Empty or whitespace-only names return 422. Duplicate-name detection is **case-sensitive** to match the DB unique constraint: `Drone` and `drone` are distinct rows, so two analysts using different casing will create two tags.

**Response 201:**
```json
{ "id": "uuid", "name": "drone strike", "category": "free" }
```

**Response 403:** category is not `free`.

**Response 409:** a tag with the same name already exists.

**Errors:**
| Code | Case |
|------|------|
| 409 | A tag with this name already exists |

---

## Conflicts

### `GET /conflicts`

List the conflict referential, ordered `ongoing` first then by name. Server-managed (the daily Wikipedia sync, the one-shot Wikidata seed, operator rows; see [`conflicts.md`](conflicts.md)): there is no create endpoint. The default returns **every** row, ongoing and ended alike, so the submit picker can offer ended conflicts for archival footage. Returned whole rather than paged, and bounded by the referential ceiling rather than the 100-row list cap (see [Pagination](#pagination)). Rate-limited to 60/min/IP.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `used` | bool | When `true`, return only conflicts carried by at least one live event, so a filter UI never surfaces a chip that matches zero results. Mirrors the default orphan filtering on [`GET /tags`](#get-tags). |

**Response 200:**
```json
[
  { "id": "uuid", "name": "Russian invasion of Ukraine", "wikidata_id": "Q110999040", "start_year": 2022, "end_year": null, "ongoing": true, "tier": "major" },
  { "id": "uuid", "name": "Western Sahara conflict", "wikidata_id": "Q1152920", "start_year": 1970, "end_year": null, "ongoing": false, "tier": null }
]
```

`start_year` / `end_year` disambiguate same-named historical entries. `tier` is the Wikipedia death-toll tier (`major`, `minor`, `conflict`; see [`data-model.md`](data-model.md#conflicts)), NULL for rows the sync has never classified; clients use it to rank the default picker list. `last_seen_at` and `source` are sync internals and stay off the wire.

Ongoing-conflict names and dates derive from Wikipedia's "List of ongoing armed conflicts," available under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Any surface that lists them must carry that attribution.

---

## Users

### `GET /users/{username}`

Public profile of an analyst.

**Response 200:**
```json
{
  "id": "uuid",
  "username": "kalush",
  "bio": "OSINT analyst tracking armoured movement in Eastern Ukraine.",
  "avatar_url": "https://<cloudfront-domain>/avatars/<user_id>/<uuid>.jpg",
  "external_links": {
    "x": "kalush",
    "discord": null,
    "website": "https://kalush.example.com",
    "github": null
  },
  "created_at": "2026-03-28T10:00:00Z",
  "geolocations_count": 42,
  "followers_count": 17,
  "following_count": 5,
  "is_following": false
}
```

`bio` and `external_links` are self-set via `PATCH /users/me`, which is also where the per-platform rules for each link value live; `avatar_url` is written by `PUT` / `DELETE /users/me/avatar`. Defaults are `null` / `null` / `{}`. `is_following` is `true` only when you are authenticated and follow this user; anonymous viewers and self-views always get `false`. Email is never on this shape.

`geolocations_count` counts the analyst's published geolocations: live rows with `status = "geolocated"`. It equals the `total` on [`GET /users/{username}/events`](#get-usersusernameevents), which serves the same set. For the analyst's whole body of live work, machine detections included, read `total_events` on [`GET /users/{username}/stats`](#get-usersusernamestats).

**Errors:**
| Code | Case |
|------|------|
| 404 | User not found |

---

### `GET /users/{username}/stats`

Aggregated shape of an analyst's work. Pure aggregation over existing columns; drives the profile's insights section (see [`design.md`](design.md#public-profile)), which tiles `geolocated_count`, `detected_count` and the head of `top_conflicts` and `capture_sources`, then draws `source_hosts` and `activity`. `closed_count` reads in the tiles' population line, and `media_count` is read by the profile share card.

**Response 200:**
```json
{
  "geolocated_count": 2,
  "detected_count": 1,
  "closed_count": 1,
  "total_events": 4,
  "media_count": 2,
  "top_conflicts": [{ "name": "Russo-Ukrainian War", "count": 2 }],
  "capture_sources": [{ "name": "dashcam", "count": 1 }],
  "source_hosts": [{ "name": "x.com", "count": 2 }, { "name": "t.me", "count": 1 }],
  "other_hosts_count": 0,
  "no_source_count": 1,
  "activity": [{ "period": "2025-11", "count": 0 }, { "period": "2025-12", "count": 3 }]
}
```

Every field describes one population: the analyst's visible events (`deleted_at IS NULL`, `hidden_at IS NULL`) in the three worked statuses, `geolocated` + `detected` + `closed`. That set is `total_events`, and it includes detections. A `requested` row is an open call for help rather than documented work, so it takes part in no aggregate here, and neither does its withdrawn form (`closed` off `requested`). A rejected detection and a retracted geolocation both count under `closed_count`: each is a judgement the analyst made and part of the record they built.

`top_conflicts` and `capture_sources` are capped at 5, ordered by count desc then name, so the first entry is the leader a client can name without reading the rest. Both are empty for an analyst whose events carry no conflict or no `capture_source` tag.

`source_hosts` breaks the same set down by the host of `source_url`, folded to lower case with a leading `www.` removed, so `www.tiktok.com` and `tiktok.com` are one entry. Capped at 5 and ordered by count desc then host; `other_hosts_count` carries every event on a host past the fifth, and `no_source_count` the events whose `source_url` is null or names no readable host (a machine detection whose post declared no source). The five counts plus those two totals add up to `total_events`.

`activity` buckets `event_date`, the date the documented event happened, one bucket per calendar month across the span this analyst's own events cover: from their earliest dated event to their latest, oldest bucket first, zero-filled in between. `period` is `YYYY-MM`. Events with no `event_date` count in the status split and take no bucket. The list is empty when no event carries a date.

The span is cut to the 10 most recent calendar years, the number of rows the profile's month grid holds at 375 px, and it then starts at January of the oldest year it shows. The dropped events still count in every other aggregate.

**Errors:**
| Code | Case |
|------|------|
| 404 | User not found |

---

### `PATCH /users/me` 🔒

Edit your own bio and Linktree-style external account handles.

**Body** (all fields optional; absent = leave column alone, explicit `null` or empty string = clear):
```json
{
  "bio": "OSINT analyst, Eastern Ukraine armoured movement.",
  "external_links": {
    "x": "@me",
    "discord": "me",
    "website": "https://me.example.com",
    "github": "@me"
  }
}
```

`bio` is capped at 500 characters. `external_links` is **wholesale-replaced**, not deep-merged: send the full panel each time. Each platform validates its own shape and stores one form:

| Field | Accepted | Stored |
|-------|----------|--------|
| `x` | a handle (`ana` or `@ana`: 1 to 15 characters of `A-Za-z0-9_`), or a profile URL on `x.com` or `twitter.com` with exactly one path segment (`https://x.com/ana`, optional `www.`, optional trailing slash, no query and no fragment) | the handle alone, without the `@` |
| `github` | a user or organization name (`vidithq` or `@vidithq`: 1 to 39 characters of `A-Za-z0-9-`), or a profile URL on `github.com` with exactly one path segment | the name alone, without the `@` |
| `discord` | a username, never a link: 2 to 32 characters of `A-Za-z0-9_.`, optionally followed by the legacy `#0000` discriminator | the username, without a leading `@` |
| `website` | an http or https URL | the URL as sent, whitespace trimmed |

The three handle fields cap at 200 characters and `website` at 500. A value that fits none of the accepted forms is a 422: a status URL (`https://x.com/ana/status/1`), a product path (`https://x.com/i/flow`), a URL on another host, a scheme-less `x.com/ana`, and an `x` or `github` handle carrying a space or a dot are all rejected. A stored value can also be a full URL on the platform, so a client that reads a profile handles both forms.

The body rejects unknown fields, `avatar_url` among them. The profile picture is server-minted, so it changes only through the two endpoints below.

**Response 200:** the updated `UserRead` (same shape as `GET /auth/me`).

**Errors:**
| Code | Case |
|------|------|
| 401 | Not authenticated |
| 422 | Validation failure (bio too long, non-http(s) website, a link value that is neither a handle nor a profile URL on the platform, unknown field) |

---

### `PUT /users/me/avatar` 🔒

Upload your profile picture. The backend strips the image's metadata, resizes it so its longer edge fits 400 px, re-encodes it as JPEG, and stores one object under `avatars/{user_id}/`. It then points `users.avatar_url` at that object and deletes the picture it replaced, the same delete every other media path performs: the bucket is versioned with Object Lock, so the delete writes a delete marker and the noncurrent version stays for the retention period (see the Media row in [`engineering.md`](engineering.md#deployment)).

The picture every viewer's browser loads therefore comes from the media host, not from an address the profile owner chose. A typed URL would fetch from a host the owner controls on every page that renders the avatar, handing that host the IP address and User-Agent of everyone who reads the profile, an event page, the map, or a search result.

**Body:** `multipart/form-data` with a single `file` field. Accepts `image/jpeg`, `image/png`, and `image/webp`, up to `MAX_IMAGE_SIZE`. Video types are rejected.

**Response 200:** the updated `UserRead`, carrying the new `avatar_url`.

**Errors:**
| Code | Case |
|------|------|
| 401 | Not authenticated |
| 422 | `{"code": "invalid_avatar", "message": …}`: not an accepted image type, over the size ceiling, or undecodable |

---

### `DELETE /users/me/avatar` 🔒

Remove your profile picture. Clears `users.avatar_url` and deletes the stored object, under the same versioning and retention as every other media delete (see the Media row in [`engineering.md`](engineering.md#deployment)). Surfaces fall back to the handle's initial or a neutral icon. Idempotent: removing a picture you do not have returns 200.

**Response 200:** the updated `UserRead`, with `avatar_url` null.

**Errors:**
| Code | Case |
|------|------|
| 401 | Not authenticated |

---

### `GET /users/{username}/events`

An analyst's published geolocations, newest event date first, ties broken by `created_at DESC, id DESC`.

Serves `status = "geolocated"` only, the rows the analyst vouched for and still stands behind. A detection is machine output they have not stood behind, a `closed` row off `detected` is one they rejected, a `closed` row off `geolocated` is one they retracted, and a `requested` row is an open call for help rather than an answer, so none of the four appear here. The filter applies to `total` as well as to the rows, so the pager never counts a row the feed will not serve. `geolocations_count` on [`GET /users/{username}`](#get-usersusername) counts the same set, so `total` and the profile's count agree. The detections stay reachable: [`GET /users/{username}/stats`](#get-usersusernamestats) tallies them alongside the published work, and the owner works their own detections from [`GET /events/detections`](#get-eventsdetections).

Offset-paged, not cursor-paged: the ordering this feed reads by is `event_date`, a nullable and editable column, so it cannot key a cursor (see [Pagination](#pagination)). The tiebreaker makes the ordering total, so a page cannot repeat a row the previous page served.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | int | Page number (default 1). Below 1 or non-numeric returns 422. |
| `per_page` | int | Rows per page (default 20). Clamped to the 100-row [cap](#pagination); below 1 or non-numeric returns 422. |

**Response 200:**
```json
{
  "items": [
    {
      "id": "uuid",
      "title": "Strike on depot, Donetsk",
      "lat": 48.123,
      "lng": 37.456,
      "event_date": "2026-03-15",
      "media": { "id": "uuid", "storage_url": "https://…/abc.jpg", "media_type": "image" },
      "tags": [{ "name": "Drone", "category": "capture_source" }],
      "conflicts": [{ "id": "uuid", "name": "Russian invasion of Ukraine", "wikidata_id": "Q110999040", "start_year": 2022, "end_year": null, "ongoing": true, "tier": "major" }]
    }
  ],
  "total": 42,
  "page": 1,
  "per_page": 20
}
```

`media` is the picked card thumbnail (same rule as [`GET /events`](#get-events)), `null` when the event has neither a source attachment nor a proof image; the full media list is on the detail payload only.

---

### `POST /users/{username}/follow` 🔒

Follow another analyst. Idempotent, re-following a user you already follow returns 204 without error. Self-follow is rejected with 400.

**Response 204:** no body.

**Errors:**
| Code | Case |
|------|------|
| 400 | Cannot follow yourself |
| 401 | Not authenticated |
| 404 | Target user not found or soft-deleted |

---

### `DELETE /users/{username}/follow` 🔒

Unfollow another analyst. Idempotent. Unknown username returns 404 rather than no-op'ing.

**Response 204:** no body.

**Errors:**
| Code | Case |
|------|------|
| 401 | Not authenticated |
| 404 | Target user not found or soft-deleted |

---

## Timeline

### `GET /timeline` 🔒

Activity feed of geolocations submitted by analysts you follow, newest submission first (`created_at DESC, id DESC`). Published work only, the same set [`GET /users/{username}/events`](#get-usersusernameevents) serves: a detection nobody has vouched for and a geolocation its author retracted are both out.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | int | Page number (default 1). Below 1 or non-numeric returns 422. |
| `per_page` | int | Rows per page (default 20). Clamped to the 100-row [cap](#pagination); below 1 or non-numeric returns 422. |

**Response 200:** same `PaginatedEvents` shape as `GET /users/{username}/events`.

**Errors:**
| Code | Case |
|------|------|
| 401 | Not authenticated |

---

## Admin

All routes below are mounted under `/admin` and gated by the `require_admin` FastAPI dependency. `require_admin` layers on top of `get_current_user`, so a deactivated admin (`is_active=false`) loses access immediately.

<details>
<summary>17 admin endpoints, rarely-touched ops surface (invites, detection-quality metrics, soft/hard delete, X handle link, content reports, maintenance sweeps). Expand for full contracts.</summary>

### `GET /admin/me` 🛡️

**Response 200:**
```json
{ "is_admin": true }
```

Returns 403 for non-admins, 401 for anonymous callers.

### `GET /admin/detection-stats` 🛡️

Quality signal on the machine-extraction pipeline. A **machine detection** is an event imported from X (the archive backfill or the bot), identified by `detected_from_url` being set; a human submit always carries `detected_from_url = null`. Read-only, no audit row (a metric read is not an administrative act).

**Reject-rate** is the share of machine detections dismissed before publication, whichever door they left through. A machine detection counts as a reject if either an owner closed it straight out of `detected` (`status = "closed"` with `before_closed_status = "detected"`) or an admin soft-deleted it while it was still `detected` (`deleted_at` set with `status = "detected"`). A detection the owner vouched (promoted to `geolocated`) is **not** a reject, even once soft-deleted or retracted (it was vouched before either); one still awaiting review is **not** a reject yet. `reject_rate` is `machine_rejected / machine_total` as a 0..1 ratio (`0` when there are no machine detections). Counted over every machine row, soft-deleted or not: the metric measures what the pipeline produced.

One counting edge the metric accepts, favouring over-counting dismissals over under-counting them: an **account-departure cascade** soft-delete counts that account's pending detections as rejects.

The `pending_*` counts profile the **live** `detected` queue (`deleted_at IS NULL`, machine rows only): detections missing a piece the geolocate floor will demand (a source media, a proof-role image, or a `source_url`), so a low-quality extraction run is visible before an analyst opens the queue.

**Response 200:**
```json
{
  "machine_total": 420,
  "machine_rejected": 37,
  "reject_rate": 0.088,
  "pending": 61,
  "pending_missing_source_media": 4,
  "pending_missing_proof_image": 9,
  "pending_missing_source_url": 12
}
```

### `POST /admin/invite-codes` 🛡️

Mint a new invite code. Audited via `admin_events` (`action = "invite_created"`).

**Request body:**
```json
{
  "expires_in_days": 14,
  "x_handle": "@osint_hawk"
}
```

Every code is single-use. `expires_in_days` is optional (omit / `null` for "never expires"), max `365`. `x_handle` is optional: it binds the code to an X handle, normalized like `PATCH /admin/users/{id}/x-handle` (single leading `@` stripped, lowercased, `^[a-z0-9_]{1,15}$`); redemption copies it onto the new account as its bot-attribution link (fail-soft: if the handle got linked elsewhere meanwhile, the account is still created without it).

**Response 201:**
```json
{
  "id": "8e67f0…",
  "code": "abc123xyz",
  "expires_at": "2026-05-23T10:00:00Z",
  "created_at": "2026-05-09T10:00:00Z",
  "status": "active",
  "redeemer": null,
  "used_at": null,
  "x_handle": "osint_hawk"
}
```

`status` is one of `active | exhausted | revoked | expired`, computed at read time. `redeemer` is the account that redeemed the code, with its onboarding stats (see the list endpoint); `null` until the code is used.

**Response 409:** `x_handle` already linked to a user (`{"code": "x_handle_conflict", …}`).

**Response 422:** `x_handle` outside the handle alphabet.

### `GET /admin/invite-codes` 🛡️

List invite codes (newest first), including exhausted / revoked / expired ones. Feeds the admin onboarding table: each used code nests its `redeemer`, the redeeming account with acting fields plus read-side onboarding counters, batched in one grouped aggregate per source table (no per-row queries).

Capped and cursor-paged like the catalog lists (the table is append-only, one row per invite ever issued).

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `limit` | int | Rows per page, default 100. Clamped to the 100-row [cap](#pagination); below 1 or non-numeric returns 422. |
| `cursor` | string | Opaque cursor from the previous page's `Link: rel="next"` header. |

**Response headers:** `Link: <…&cursor=…>; rel="next"` when a further page exists.

**Response 200:**
```json
[
  {
    "id": "…", "code": "…", "status": "exhausted",
    "expires_at": null, "created_at": "…", "used_at": "…", "x_handle": "osint_hawk",
    "redeemer": {
      "user_id": "…",
      "username": "osint_hawk",
      "email": "hawk@example.com",
      "is_admin": false,
      "x_handle": "osint_hawk",
      "archives_imported": 1,
      "bot_detection_count": 3,
      "detected_count": 12,
      "geolocated_count": 4,
      "last_login_at": "…"
    }
  }
]
```

`archives_imported` counts `done` archive-import jobs. `bot_detection_count` sums `bot_mentions.events_created` for the account's X handle (case-insensitive), a historical total that survives later deletes. `detected_count` / `geolocated_count` are the live events they own in that status; the purge endpoint below also sweeps soft-deleted detections, so its `deleted_events` can exceed `detected_count`. `last_login_at` is the newest `login` auth event, `null` for an account that has never logged in since the audit log existed.

### `DELETE /admin/invite-codes/{id}` 🛡️

Revoke an invite code (sets `revoked_at = now()`). Idempotent on already-revoked codes. Audited via `admin_events` (`action = "invite_revoked"`).

**Response 200:** the updated `AdminInviteCodeRead` payload (same shape as the list endpoint).

**Response 404:** unknown id.

### `GET /admin/users?q=<query>` 🛡️

Case-insensitive substring match on username or email. Empty `q` returns `[]`. Capped at 20 rows.

**Response 200:**
```json
[
  {
    "id": "…",
    "username": "tester2",
    "email": "tester2@example.com",
    "is_admin": false,
    "x_handle": "tester2",
    "created_at": "…"
  }
]
```

### `DELETE /admin/users/{id}` 🛡️

Remove a user. Default is soft delete (sets `users.deleted_at` *and* cascade-soft-deletes every live event they authored, requests and geolocations alike, one table since the merge); pass `?hard=true` for GDPR-grade erasure (drops the user + cascade-drops their events + sweeps S3). Both modes invalidate the points cache. Audited via `admin_events` (`action = "user_soft_deleted"` / `"user_hard_deleted"`).

**Soft delete**: the user can no longer log in (opaque 401 like wrong credentials); their public profile 404s; their author handle still renders on events preserved in the audit trail. Idempotent: re-soft-deleting preserves the original timestamp.

**Hard delete**: drops the user row, cascade-drops every event they owned (which cascade to media of every role + tag links + contributor rows), then sweeps the S3 objects (event media, source and proof roles alike). `invite_codes.created_by` and `invite_codes.used_by` flip to NULL via `ON DELETE SET NULL` so the codes survive as audit rows even after the issuer or consumer is gone. DB transaction commits before the S3 attempt so a flaky storage backend can't strand DB rows pointing at live keys.

**Response 200:**
```json
{
  "user_id": "…",
  "username": "throwaway",
  "mode": "soft",
  "deleted_at": "2026-05-09T16:45:00Z",
  "cascaded_geolocations": 5,
  "media_count": 0
}
```

`cascaded_geolocations` counts every event owned (requests + geolocations, one table since the merge). For `mode = "hard"`, `deleted_at` is `null` and `media_count` (every file, source and proof roles) reflects what was swept from S3.

**Response 404:** unknown id.

### `DELETE /admin/users/{id}/detected-events` 🛡️

Hard-delete every detection the user owns (rows + media rows + S3 objects with hero/thumb derivatives, soft-deleted detections included), keeping the account, its geolocations and its requests. The broken-archive repair: a bad import can mint hundreds of junk detections; this sweeps them without a full account delete. `closed` rows that were once detected stay (the owner explicitly acted on those). Invalidates the points cache. Audited via `admin_events` (`action = "detected_events_purged"`). Same commit-then-sweep ordering as the user hard delete. `media_count` counts swept storage objects, derivatives included.

**Response 200:**
```json
{
  "user_id": "…",
  "username": "osint_hawk",
  "deleted_events": 137,
  "media_count": 12
}
```

**Response 404:** unknown id.

### `DELETE /admin/events/{id}` 🛡️

Remove an event. Default is soft delete (sets `deleted_at`); pass `?hard=true` for GDPR-grade erasure. Both modes invalidate the `/events/points` cache. Audited via `admin_events` (`action = "geolocation_soft_deleted"` / `"geolocation_hard_deleted"`).

**Soft delete** (`?hard=false` or omitted): the row, its media rows, and its S3 objects stay put. Only `deleted_at` flips, and every public read filters it out. Idempotent: re-soft-deleting preserves the original timestamp and skips the audit append.

**Hard delete** (`?hard=true`): drops the row (cascade kills every `media` row, source and proof roles alike) and best-effort-deletes the corresponding S3 objects, the superseded source objects the event's versions name included. A source media a correction replaced has no row left, so the snapshots are the only thing resolving those keys, and deleting the event is what frees them. The DB transaction commits *before* the S3 delete attempt so a flaky storage backend can't strand DB rows pointing at live keys; per-key S3 failures are logged and swallowed (the accepted residual orphan risk).

**Response 200:**
```json
{
  "geolocation_id": "…",
  "title": "Strike on depot, Donetsk",
  "mode": "soft",
  "deleted_at": "2026-05-09T16:30:00Z",
  "media_count": 0
}
```

For `mode = "hard"`, `deleted_at` is `null` and `media_count` (every file swept) reflects what was removed.

**Response 404:** unknown id.

### `PATCH /admin/users/{id}/x-handle` 🛡️

Link or clear the X handle the bot attributes mentions to; the interactive write path for `users.x_handle` (registration also copies an invite-bound handle, and self-serve linking waits on verify-by-post), and the repair path when an invite-bound handle failed to link at redemption. A non-null value is normalized (single leading `@` stripped, lowercased) and must match `^[a-z0-9_]{1,15}$`; `null` clears the link. Audited via `admin_events` (`action = "x_handle_linked"` / `"x_handle_cleared"`).

**Request body:**
```json
{ "x_handle": "@osint_hawk" }
```

**Response 200:** the updated `AdminUserRead`.

**Response 409:** the handle is already linked to another account (`{"code": "x_handle_conflict", …}`).

**Response 422:** value outside the handle alphabet.

**Response 404:** unknown or soft-deleted user id.

### `GET /admin/reports` 🛡️

The moderation queue: open reports first, then newest first within each group. Resolved reports stay in the list rather than dropping out of it: a report is never deleted, so the queue doubles as the record of what was reported and what was decided. Offset-paged, capped at 100 rows per page. No rate limit.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | int | Page number (default 1). Below 1 or non-numeric returns 422. |
| `per_page` | int | Rows per page (default 20). Clamped to the 100-row [cap](#pagination). |

**Response 200:**
```json
{
  "items": [
    {
      "id": "uuid",
      "event_id": "uuid",
      "reason": "graphic_not_flagged",
      "details": "Shows a body at 0:14, no graphic-content warning on the card.",
      "reporter_user_id": null,
      "created_at": "2026-08-12T09:14:00Z",
      "resolved_at": null,
      "resolution": null
    }
  ],
  "total": 1,
  "page": 1,
  "per_page": 20
}
```

`resolved_at` and `resolution` are both `null` while a report is open and both set once it is resolved, so `resolved_at is null` is the open test on the wire too. The admin who resolved it is recorded on the row and in `admin_events`, not on the wire. `event_id` is `null` when the reported event was hard-deleted after the report was filed: the report outlives it, and the admin panel renders those rows as *Event deleted* with `dismissed` as the only verdict on offer.

### `POST /admin/reports/{id}/resolve` 🛡️

Close one report with a verdict, applying it to the reported event. Reports are resolved once and never reopened: a second resolve is a conflict, not an overwrite. Audited via `admin_events` (`action = "report_resolved"`, `target` carrying `report_id` / `event_id` / `resolution`); a verdict that also changes the event appends the matching event action too (`event_marked_graphic` for `marked_graphic`, `event_hidden` for `hidden`), so the trail reads the same whether the change came from the queue or from the direct moderation endpoint below. Invalidates the `/events/points` cache when the verdict actually hides the event.

**Request body:**
```json
{ "resolution": "hidden" }
```

`resolution` is one of `marked_graphic` (sets the event's `is_graphic` over the author's declaration), `hidden` (withholds the event from every public read, stamping `hidden_at`), or `dismissed` (closes the report, event untouched).

**Response 200:** the resolved `ContentReportRead` (same shape as the queue item above, now carrying `resolved_at` / `resolution`).

**Errors:**
| Code | Case |
|------|------|
| 404 | `report_not_found`: unknown report id |
| 409 | `report_already_resolved`: the report already carries a verdict |
| 409 | `report_event_gone`: the reported event was hard-deleted, so `marked_graphic` and `hidden` have nothing to act on. Resolve the report as `dismissed` instead |

Rate-limited to 60/hour.

### `PATCH /admin/events/{id}/moderation` 🛡️

Set an event's moderation state directly, with no report behind it. The one verb that can also **undo** a takedown (resolving a report cannot). Both fields are optional and independent: `null` or omitted leaves that axis exactly as it is, and a value equal to what the row already holds writes nothing and appends no audit row, so re-sending the current state is not an administrative act. Audited via `admin_events` (`action = "event_marked_graphic"` / `"event_unmarked_graphic"` / `"event_hidden"` / `"event_unhidden"`, one row per axis that actually changed). Invalidates the `/events/points` cache when `hidden` actually changes.

**Request body:**
```json
{ "is_graphic": null, "hidden": true }
```

**Response 200:**
```json
{
  "id": "uuid",
  "is_graphic": false,
  "hidden_at": "2026-08-12T09:20:00Z"
}
```

`hidden_at` is `null` when the event is live, a timestamp when it is withheld, so the response also says when the takedown landed, or confirms `hidden: false` lifted a prior one.

**Errors:**
| Code | Case |
|------|------|
| 404 | `event_not_found`: unknown or soft-deleted event |

Rate-limited to 60/hour.

### `POST /admin/events/{id}/versions/{version_no}/redact` 🛡️

Blank one filed version of an event's history. [`event_versions`](data-model.md#event_versions) is append-only and a version number is a public address, so a version carrying material the record must stop serving is blanked rather than removed: `snapshot` becomes `{}` and `note` becomes `null`, while the row, its `version_no`, its `created_at` and its `edited_by` stay. [`GET /events/{id}/versions`](#get-eventsidversions) keeps listing it with `redacted: true`, so `/vN` addressing never shifts and the history still shows that a version existed.

A redacted version displays nothing, so it stops holding evidence alive. A proof image no readable version and no current proof body points at is deleted with the redaction, row and object. So is the S3 object of a source media this version alone named: its row went when the correction that replaced it landed, and nothing renders it once the version is blanked. Audited via `admin_events` (`action = "event_version_redacted"`).

Idempotent: redacting an already-redacted version returns it unchanged and appends no audit row.

**Response 200:** one version, same shape as an item of [`GET /events/{id}/versions`](#get-eventsidversions), with `redacted: true`.

**Errors:**
| Code | Case |
|------|------|
| 403 | Not an admin (the event's owner included: redaction is moderation, not an owner action) |
| 404 | `geolocation_not_found`: unknown or soft-deleted event. `version_not_found`: the event carries no version under that number |

Rate-limited to 60/hour.

### `POST /admin/maintenance/reap-auth-tokens` 🛡️

Drop expired and old-consumed `auth_tokens` rows. Replaces the cron that previously lived in `scripts/reap_auth_tokens.py`. Audited as `maintenance_reap_auth_tokens`.

**Response 200:**
```json
{ "expired": 12, "old_consumed": 3 }
```

### `POST /admin/maintenance/reap-pending-registrations` 🛡️

Drop expired `pending_registrations` rows. Sweeps expired pending rows that the inline cleanup on `/auth/register` didn't reach. Audited as `maintenance_reap_pending_registrations`.

**Response 200:**
```json
{ "pending_registrations_deleted": 7 }
```

### `POST /admin/maintenance/send-completion-digests` 🛡️

Email every analyst holding unpublished detections: one message per analyst carrying the count and a link to their own Detections queue, where [`POST /events/batch-complete`](#post-eventsbatch-complete) publishes them. The other half of the completion flow, since the import-complete email scrolls away while the backlog does not. Selection: live detections only (never soft-deleted, published or closed rows), and the owner must be a live, active account with an address. Ordered by backlog and cut at 200 analysts, one provider round-trip each, so a click stays bounded; the tail is covered by clicking again. A provider failure on one address is counted, not raised, and the digest is re-sendable on the next run. Audited as `maintenance_send_completion_digests`.

**Response 200:** `detections_pending` counts the detections the *delivered* messages covered, so a failed send adds to `digest_send_failures` and to neither other count.
```json
{ "analysts_notified": 4, "detections_pending": 137, "digest_send_failures": 0 }
```

</details>

---

## Webhooks

The X Account Activity webhook, the bot's nominal mention delivery (see [`ingestion.md`](ingestion.md#the-bot)). **Unauthenticated by design**: X calls it, and the HMAC signature over the raw body (the app's consumer secret, held only by X and the deployment) is the gate.

### `GET /webhooks/x`

X's Challenge-Response Check (CRC), sent at registration and then hourly; a wrong or slow answer deactivates the webhook. Answered in-request, no DB.

**Query:** `crc_token` (required). Must match `^[A-Za-z0-9_-]{1,200}$` (X's CRC tokens are short URL-safe strings). The gate is what keeps the responder from being a signing oracle: the answer is the exact HMAC construction the POST verifies over the raw body, and a JSON webhook body can never fit that charset.

**Response 200:**
```json
{ "response_token": "sha256=<base64(HMAC-SHA256(consumer_secret, crc_token))>" }
```

**Response 400:** `crc_token` outside the URL-safe shape.

**Response 503:** the X credentials are not configured on this deployment.

### `POST /webhooks/x`

One Account Activity delivery. The `x-twitter-webhooks-signature` header must carry `sha256=<base64(HMAC-SHA256(consumer_secret, raw_body))>`; compared constant-time as bytes, mismatch → `401`. A body over 512 KiB → `413` before the body is read (an AAA delivery is small). A valid signature always answers `200`, whatever the payload: a foreign `for_user_id`, non-mention events, or the bot's own posts are ignored (a non-2xx would make X retry and eventually deactivate the webhook). Mentions are reduced to the internal shape and queued in [`bot_webhook_events`](data-model.md#bot_webhook_events); the import worker runs the pipeline, never the request.

**Response 200:**
```json
{ "queued": 1 }
```

**Response 503:** the consumer secret or the bot user id is not configured (an empty bot user id would otherwise silently drop every delivery).

---

## General conventions

### Pagination

**Every list response is capped at 100 rows**, whatever `limit` / `per_page` you request. Asking for more is clamped, not rejected: `?limit=500` answers 200 with 100 rows. Values that are not a usable page (below 1, non-numeric) return 422, and so does a malformed `cursor` (one that does not decode to the position its list pages on). A cursor that decodes cleanly is honored whether or not the server minted it: it names a position in an ordering, carries no authorization, and every filter on the request still applies. The cap and the cursor live in [`services/pagination.py`](../backend/app/services/pagination.py).

**Reading past the first page** means following a cursor. A capped response whose next page holds at least one row carries a `Link` header:

```
Link: <https://api.vidit.app/api/v1/events?view=requested&cursor=WyIyMDI2LTA4LTExVDA5OjE0OjIyKzAwOjAwIiwiOWY0…Il0>; rel="next"
```

The URL carries the whole query the page was minted under, so a walk stays inside one filter set. No header means no further rows. The header is on the CORS `Access-Control-Expose-Headers` list, so a browser client can read it. The cursor is opaque: it encodes the position of the page's last row in that list's ordering, and it's not a value you need to construct.

Cursor-paged: [`GET /events`](#get-events), `GET /admin/invite-codes` and [`GET /events/{id}/versions`](#get-eventsidversions). The first two order by `created_at DESC, id DESC`; the version history orders by `version_no DESC`, a number unique per event. Either ordering is total and immutable, which is what makes a walk safe: rows inserted mid-walk land ahead of the cursor, on pages already served, so no row is served twice and none is skipped, the way an `OFFSET` walk does both when the set shifts under it.

Endpoints that page return this envelope, `total` being the pre-cap match count:
```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "per_page": 20
}
```

`page` echoes what you sent, so it means nothing on a cursor-driven request: a walk has no page number, and the field stays at `1`. Read `Link` for position, not `page`. `total` is the match count either way.

The other lists sit outside the cursor scheme:

- [`GET /users/{username}/events`](#get-usersusernameevents), [`GET /events/detections`](#get-eventsdetections), and [`GET /timeline`](#get-timeline) are offset-paged and capped. `GET /users/{username}/events` orders by `event_date`, which is nullable and editable and so cannot key a cursor; `created_at DESC, id DESC` follows it as the tiebreaker, which makes the offset walk stable across pages even though `event_date` ties are common. The other two are owner- or follow-scoped queues whose clients render a page number, not a walk.
- [`GET /search`](#get-search) caps each result group at 50 and offers no offset or cursor at all. It ranks by relevance, and `ts_rank` ties are not a stable key; the walkable path over the same filter vocabulary is `GET /events`.
- [`GET /tags`](#get-tags) and [`GET /conflicts`](#get-conflicts) are server-managed vocabularies returned whole, since their pickers filter them client-side and a page of a vocabulary is a page of missing options. They are bounded by a referential ceiling (2000 rows) instead.

[`GET /events/points`](#get-eventspoints) returns no rows in the list sense and takes no cursor: it is bounded by the required `bbox`, so the requested area decides the payload size.

### Errors

All errors follow this shape:
```json
{
  "detail": "Human-readable error description"
}
```

### File limits

| Type | Extensions | Max size |
|------|------------|----------|
| Image | jpg, png, webp | 10 MB |
| Video | mp4, webm | 95 MiB |
