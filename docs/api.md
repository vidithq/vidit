# API, REST contracts

Base URL: `/api/v1`

All responses are JSON.

**Auth.** Endpoints marked 🔒 require a logged-in session: the `vidit_session` cookie (set by `POST /auth/login`, `HttpOnly; Secure; SameSite=Lax`) plus, for state-changing requests (`POST`/`PUT`/`PATCH`/`DELETE`), the `X-CSRF-Token` header echoing the JS-readable `vidit_csrf` cookie. There is no `Authorization: Bearer` flow; the cookie + CSRF pair is the only authenticated channel into the backend. Endpoints marked 🛡️ additionally require `is_admin=true` on the caller (returns 403 otherwise).

**Transport security.** Every response carries `Strict-Transport-Security: max-age=15768000`. The header has no `includeSubDomains` or `preload` directives.

**Auth audit log.** The `/auth/*` endpoints write to the `auth_events` table as a side-effect: `login` on success, `failed_login` on any rejected login (with `user_id` only when the address matched a live user), `logout`, `register_pending` (on `POST /auth/register`), `register_resent` (on `POST /auth/resend-confirmation`, on both the matched-pending and no-matching-pending branches so the rate-of-requests signal survives the always-204 discipline; `user_id` is always NULL since no user row exists yet), `register_confirmed` (on `POST /auth/confirm-registration`), `password_reset_requested` (on `POST /auth/forgot-password`, on both the known-email and unknown-email branches so the audit trail is a "rate of requests" signal), `password_reset_completed`, and `password_changed` (on `POST /auth/change-password`). Writes are best-effort inside a SAVEPOINT; an audit failure never breaks the auth flow.

**Error envelope.** Three shapes appear on the `detail` field of non-2xx responses, and frontend `apiFetch` ([`frontend/src/lib/api.ts`](../frontend/src/lib/api.ts)) normalises all three. (1) **Plain string**, `{"detail": "Invite code not found"}` for direct `HTTPException` raises in routers (e.g. `DELETE /admin/invite-codes/{id}` 404). (2) **Pydantic validation array**, `{"detail": [{"loc": [...], "msg": "...", "type": "..."}, ...]}` for request-body / query-string validation failures (FastAPI default). (3) **Typed envelope**, `{"detail": {"code": "<stable_id>", "message": "<human prose>"}}` for business-rule errors raised from the service layer and translated by the router. Used by every `/auth/register` + `/auth/confirm-registration` + `/auth/resend-confirmation` error branch (codes: `invalid_invite`, `email_already_registered`, `username_already_taken`, `email_pending_confirmation`, `username_pending_confirmation`, `invalid_or_expired_token`), every `/admin/*` business-rule error branch (codes: `user_not_found`, `geolocation_not_found`, `trust_reason_required`, `x_handle_conflict`), and every `POST /events`, `POST /events/requests`, and `POST /events/{id}/geolocate` business-rule branch (codes: `invalid_coordinates`, `too_many_files`, `media_required`, `invalid_proof`, `proof_image_required`, `tag_requirements_not_met`, `invalid_file`, `evidence_processing_failed`, `proof_files_mismatch`, `source_media_conflict`; the create, request, and geolocate paths share the file/media codes via `services/evidence_intake`). `POST /events/{id}/geolocate` and `POST /events/{id}/close` add `invalid_state` when the row is not `requested` / `detected`. The `code` is the stable contract surface: branch on it, not on `message`. Status codes follow the per-endpoint contracts below.

---

## Endpoints at a glance

Auth column: 🌐 anonymous, 🔒 logged-in, 🛡️ admin-only.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| **Auth** | | | |
| POST | `/auth/register` | 🌐 | Stage a pending registration; sends confirmation email |
| POST | `/auth/confirm-registration` | 🌐 | Confirm a pending registration (creates user, signs in) |
| GET | `/auth/invites/{code}/check` | 🌐 | Advisory invite-code probe for the registration form |
| POST | `/auth/resend-confirmation` | 🌐 | Re-send the confirmation email; invalidates previous token |
| POST | `/auth/login` | 🌐 | Email + password → session + CSRF cookies |
| POST | `/auth/logout` | 🌐 | Clear session cookies (idempotent) |
| GET | `/auth/me` | 🔒 | Current user |
| POST | `/auth/forgot-password` | 🌐 | Email a single-use reset token (always 204) |
| POST | `/auth/reset-password` | 🌐 | Consume reset token, set new password |
| POST | `/auth/change-password` | 🔒 | Authenticated password rotation; requires current password |
| **Events** | | | |
| GET | `/events` | 🌐 | List one lifecycle view, `located` (default) or `requested` (ex `/requests`) |
| GET | `/events/points` | 🌐 | Compact map-points tuples (cached) |
| GET | `/events/possible-duplicates` | 🔒 | Soft-warning probe for the submit form |
| POST | `/events/import-from-tweet` | 🔒 | Parse a tweet URL into a submit-form pre-fill payload |
| GET | `/events/import-from-tweet/media` | 🔒 | Proxy fetch an X CDN media URL |
| POST | `/events/import-archive/presign` | 🔒 | Mint a presigned direct-to-storage upload for your X data archive |
| POST | `/events/import-archive` | 🔒 | Enqueue your staged archive (by `upload_key`) for the backfill worker |
| GET | `/events/import-archive/{job_id}` | 🔒 | Poll your import job (status + assemble counts) |
| GET | `/events/{id}` | 🌐 | Full event detail, any lifecycle state |
| POST | `/events` | 🔒 | Create an event born `geolocated` (multipart, uploads media) |
| POST | `/events/requests` | 🔒 | Open a request (multipart); creates a `requested` event (ex `POST /requests`) |
| DELETE | `/events/{id}` | 🔒 | Owner-only hard delete + S3 sweep |
| POST | `/events/{id}/geolocate` | 🔒 | Give an event a vouched location: `requested` \| `detected` → `geolocated` |
| POST | `/events/{id}/close` | 🔒 | Owner withdraws a request or rejects a detection (→ `closed`) |
| POST | `/events/{id}/investigate` | 🔒 | "I'm working on this" (idempotent, multi-analyst) |
| DELETE | `/events/{id}/investigate` | 🔒 | Leave the working set |
| GET | `/events/detections` | 🔒 | Your `detected` events awaiting a geolocate (paginated) |
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
| GET | `/users/{username}/stats` | 🌐 | Aggregated shape of an analyst's work (status split, tags, activity) |
| PATCH | `/users/me` | 🔒 | Edit your bio, avatar, external links |
| GET | `/users/{username}/events` | 🌐 | List an analyst's geolocations |
| POST | `/users/{username}/follow` | 🔒 | Follow (idempotent; self-follow → 400) |
| DELETE | `/users/{username}/follow` | 🔒 | Unfollow (idempotent; unknown user → 404) |
| **Timeline** | | | |
| GET | `/timeline` | 🔒 | Activity feed from followed analysts |
| **Webhooks** | | | |
| GET | `/webhooks/x` | 🌐 | X webhook CRC challenge (HMAC answer, no DB) |
| POST | `/webhooks/x` | 🌐 | X Account Activity delivery; signature-verified, queues bot mentions |
| **Admin** (collapsed below) | | | |
| GET | `/admin/me` | 🛡️ | `is_admin` probe |
| GET | `/admin/detection-stats` | 🛡️ | Machine-extraction quality: reject-rate + pending missing-piece counts |
| POST/GET/DELETE | `/admin/invite-codes[/{id}]` | 🛡️ | Mint / list / revoke invite codes |
| GET | `/admin/users` | 🛡️ | Substring search on username/email |
| DELETE | `/admin/users/{id}` | 🛡️ | Soft delete (default) or `?hard=true` GDPR erasure |
| DELETE | `/admin/events/{id}` | 🛡️ | Soft delete or `?hard=true` GDPR erasure |
| PATCH | `/admin/users/{id}/trust` | 🛡️ | Grant / revoke `is_trusted` + `trust_reason` |
| PATCH | `/admin/users/{id}/x-handle` | 🛡️ | Link / clear the bot-attribution X handle |
| POST/DELETE | `/admin/seed-demo[-requests]` | 🛡️ | Generate / drop demo geos + users / requests |
| POST | `/admin/maintenance/reap-*` | 🛡️ | Cron-style reapers (auth tokens, pending regs) |

---

## Rate limits

One shared **slowapi** limiter ([`app/ratelimit.py`](../backend/app/ratelimit.py)), keyed per client IP, the right-most `X-Forwarded-For` entry (see [`engineering.md`](engineering.md) → *Particularities*). Limits are per-endpoint; there is **no global floor**, so any endpoint absent from this table is unlimited. Buckets are in-process (one replica today). An over-quota request gets `429` with `{"detail": "Rate limit exceeded. Try again later."}`. `RATE_LIMIT_ENABLED=false` disables every limit at once (local dev). Every read limit in this table is behaviorally pinned (N requests answer, N+1 returns `429`; see [`test_rate_limits.py`](../backend/tests/test_rate_limits.py)); write limits have wiring-level coverage only.

| Endpoint | Limit (per IP) |
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
| `GET /events`, `GET /events/{id}`, `GET /events/detections` | 120/min |
| `GET /events/points` | 60/min |
| `GET /events/possible-duplicates` | 60/min |
| `POST /events/import-from-tweet` | 30/min |
| `GET /events/import-from-tweet/media` | 60/min |
| `POST /events/import-archive/presign` | 10/hour |
| `POST /events/import-archive` | 10/hour |
| `GET /events/import-archive/{job_id}` | 60/min |
| `POST /events`, `POST /events/requests`, `DELETE /events/{id}` | 30/min |
| `POST /events/{id}/geolocate` | 30/min |
| `POST /events/{id}/close`, `POST`/`DELETE /events/{id}/investigate` | 60/min |
| **Search / Tags** | |
| `GET /search`, `GET /search/authors` | 60/min |
| `GET /tags` | 60/min |
| `POST /tags` | 30/min |
| `GET /conflicts` | 60/min |
| **Users / Timeline** | |
| `GET /users/{username}`, `GET /users/{username}/stats`, `GET /users/{username}/events`, `GET /timeline` | 120/min |
| `PATCH /users/me` | 30/min |
| `POST`/`DELETE /users/{username}/follow` | 60/min |
| **Admin** 🛡️ | |
| `POST /admin/invite-codes` · `DELETE /admin/users/{id}` | 30/hour |
| `DELETE /admin/invite-codes/{id}` · `PATCH /admin/users/{id}/trust` · `PATCH /admin/users/{id}/x-handle` · `DELETE /admin/events/{id}` | 60/hour |
| `POST`/`DELETE /admin/seed-demo[-requests]` | 10/hour |
| `POST /admin/maintenance/reap-*` | 30/hour |

`GET /auth/invites/{code}/check` and the read-only admin probes (`GET /admin/me`, `/admin/detection-stats`, `/admin/users`, `/admin/invite-codes` list) carry no limit. The [`/webhooks/x`](#webhooks) pair carries none either: the POST verifies the HMAC signature over the raw body (one HMAC, cheaper than any limiter bookkeeping), and the GET only ever signs tokens matching X's URL-safe CRC shape, the charset gate that keeps the responder from being a signing oracle for forged webhook bodies.

---

## Auth

### `POST /auth/register`

Stage a registration. Anonymous. **No `users` row is created here**: the submission lives in `pending_registrations` until the user proves they own the email by clicking the link in the confirmation message. The invite code is referenced by the pending row but not consumed; an abandoned signup does not burn the invite.

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

No session cookie is set. The confirmation email is sent on a background task so the success and error branches return at the same wire timing.

**Errors:**
| Code | Case |
|------|------|
| 400 | Invite code invalid, expired, revoked, or exhausted |
| 409 | Email or username already registered (live or soft-deleted user) |
| 409 | Email or username already has a live pending confirmation (distinct message) |
| 429 | Rate-limited (10/hour/IP) |

---

### `POST /auth/confirm-registration`

Anonymous. Consumes the token emailed by `POST /auth/register`, creates the `users` row, marks the invite consumed, and signs the analyst in (sets `vidit_session` + `vidit_csrf` cookies in the same response).

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

### `GET /auth/invites/{code}/check`

Anonymous. Pre-flight invite-code probe for the registration form. Mirrors the same `validate_invite_code` check the `POST /auth/register` step runs, so a `200 {"valid": true}` here does not reserve the code, a concurrent registration can still consume it between the check and the submit.

**Response 200:**
```json
{ "valid": true }
```

**Errors:**
| Code | Case |
|------|------|
| 404 | Invalid, exhausted, or expired invite code |

---

### `POST /auth/resend-confirmation`

Anonymous. Re-mints the token for an outstanding pending registration and re-sends the confirmation email. Always 204 to avoid leaking which addresses are in flight. The previous token is invalidated by the re-mint, a shoulder-surfed link from the first email cannot be redeemed after the resend.

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

Clears the session and CSRF cookies. Not session-gated (idempotent); like any mutating request it still requires the `X-CSRF-Token` header when a `vidit_csrf` cookie is present. **Response 204:** no body.

---

### `GET /auth/me` 🔒

Returns the current user.

**Response 200:**
```json
{
  "id": "uuid",
  "username": "kalush",
  "email": "kalush@example.com",
  "is_trusted": false,
  "trust_reason": null,
  "bio": null,
  "avatar_url": null,
  "external_links": {},
  "created_at": "2026-03-28T10:00:00Z"
}
```

`is_trusted` / `trust_reason` are public on purpose: the trust mark is a credibility signal, and the reason is what makes it credible. The profile fields (`bio`, `avatar_url`, `external_links`) ship with the self-payload so the sidebar avatar and "edit profile" form can render without a second fetch. **`is_admin` is not on this shape**; the admin role only surfaces via `GET /admin/me`. `email_verified_at` is not exposed: the pre-creation flow means there's no unverified-user state.

---

### `POST /auth/forgot-password`

Anonymous. Emails a single-use reset token if the address matches an account. Always 204 to avoid user enumeration. Email-send failures are logged and swallowed for the same reason.

**Body:**
```json
{ "email": "kalush@example.com" }
```

**Response 204** (always, on success or unknown email).

Rate-limited to 5/hour per IP.

---

### `POST /auth/reset-password`

Anonymous. Consumes a reset token and sets a new password. Tokens are single-use, expire `PASSWORD_RESET_TOKEN_MINUTES` after mint (default 15, the reset email quotes the same value), and become invalid the moment a fresh `forgot-password` is issued for the same user.

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

Authenticated password rotation from the settings page. Requires re-asserting the current password so a stolen cookie can't lock the owner out. Audited as `password_changed` on success. After commit, a best-effort heads-up email goes to the address (no IP/UA, links to `/forgot-password` for owners who didn't trigger it). Email-send failure is swallowed (logged with `user_id`, never the address); the rotation succeeds either way.

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
| `view` | string | `located` (default, the catalog: `geolocated` + `detected` rows, plus a `closed` row whose `before_closed_status` was `detected`) or `requested` (the open-call queue, ex `/requests`: `requested` rows, plus a `closed` row whose `before_closed_status` was `requested`). Anything else → 422. |
| `status` | string (repeatable) | Narrows within the view, e.g. `?view=requested&status=closed`. Repeat the param to OR within the bucket (`?status=geolocated&status=detected`). Values outside `requested` / `detected` / `geolocated` / `closed` return 422; a value the view can't contain returns an empty list. |
| `conflict` | string (repeatable) | Filter by conflict name, matched against the [`conflicts`](#conflicts) referential (`conflicts.name`), not tags. Repeat the param to OR within the conflict bucket (`?conflict=Russian invasion of Ukraine&conflict=Gaza war`). Combining with other buckets ANDs across them. |
| `capture_source` | string (repeatable) | Filter by capture-source tag name (`?capture_source=Satellite&capture_source=Drone`). Same semantics as `conflict`: OR within the bucket, AND across buckets, and the matched tag must carry `category == "capture_source"`. |
| `tag` | string (repeatable) | Filter by tag name (any category). Repeat the param to OR within the tag bucket (`?tag=drone&tag=tank`). Combining buckets ANDs across them, the event must satisfy each bucket independently. |
| `bbox` | string | `south,west,north,east` (four comma-separated floats). 422 on malformed input, latitudes in [-90, 90], longitudes in [-180, 180], south ≤ north, west ≤ east. |
| `event_date_from` / `event_date_to` | date (YYYY-MM-DD) | Inclusive event-date range. Malformed values return 422 (used to silently 500 from Postgres `InvalidDatetimeFormat`). |
| `submitted_from` / `submitted_to` | date (YYYY-MM-DD) | Inclusive submission-date range. Same 422-on-malformed shape as the event-date filters. |
| `author` | string | Exact, case-insensitive match on owner username ("this analyst's work"; pick real handles via [`GET /search/authors`](#get-searchauthors)). Whitelisted to `[A-Za-z0-9_-]{1,50}`, any other character returns 422. |
| `limit` | int | Default 200, must be in [1, 200], 422 otherwise. |

**Response 200:**
```json
[
  {
    "id": "uuid",
    "title": "Strike on depot, Donetsk",
    "event_coords": { "lat": 48.123, "lng": 37.456 },
    "event_date": "2026-03-15",
    "is_demo": false,
    "status": "geolocated",
    "before_closed_status": null,
    "owner": {
      "id": "uuid",
      "username": "kalush",
      "is_trusted": false,
      "trust_reason": null
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
    "investigator_count": null,
    "investigators_sample": null
  }
]
```

`status` is one of `requested` / `detected` / `geolocated` / `closed`; `event_coords` is `null` on a coordinate-less `requested` row. `media` is the card thumbnail: the event's `source` attachment, else its first `proof` image (`null` when it has neither; a proof video is never picked). The pick lives in `backend/app/services/thumbnails.py`, the one home every card surface uses. `conflicts` is the event's rows from the [conflict referential](#conflicts) (`ConflictRead` shape). `investigator_count` / `investigators_sample` (up to 3, newest first) populate only on `view=requested`, `null` on `view=located`. The same card shape flows through the profile feed, the timeline, and search hits.

---

### `GET /events/points`

Compact `[id, lat, lng, event_date, added_date, detected, demo]` tuples for client-side clustering, no joins, no pagination. `event_date` / `added_date` are ISO `YYYY-MM-DD` (the `created_at` calendar day); the map buckets them for its timeline scrubbers and filters client-side. `detected` is `1` for a machine-detected row, `0` for a `geolocated` one; `demo` is `1` for a demo row, so the map's filter panel offers its hide-demo toggle only when one is present (flags, not status strings). Located rows only, so `requested` events never appear here.

Results are cached in-memory for 60s per unique filter combination; the response
echoes `X-Cache: HIT|MISS` and `Cache-Control: public, max-age=30`. Rate-limited
to 60/min/IP.

**Query params:** `conflict`, `capture_source`, `tag`, `event_date_from`, `event_date_to`
`submitted_from`, `submitted_to`, `author` (see `GET /events` for semantics), plus
map-only filters `media` (repeatable, `?media=image&media=video`, matches a geolocation
carrying any attachment of a listed type; values are constrained to `image`/`video`, else
422), `trusted_only` (author `is_trusted`), and `hide_demo` (exclude demo rows). The date
params are still accepted but the map now filters dates client-side from the payload.

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

Match rule: within ~500 m geodesic of the proposed `(lat, lng)` **AND** (same source-URL host *or* same `event_date`). Auth-required; rate-limited to 60/min/IP.

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
      "username": "kalush",
      "is_trusted": true,
      "trust_reason": "Bellingcat affiliate"
    }
  }
]
```

---

### `POST /events/import-from-tweet` 🔒

Parse a public tweet URL into a pre-fill payload for the submit form. Read-only, never creates a row; the analyst submits the form. Rate-limited to 30/min/IP.

Data source is X's public *syndication* endpoint (the same backend the embeddable `<blockquote class="twitter-tweet">` widget uses). It's unauthenticated and undocumented; the route surfaces upstream failures as `502` with a fixed error string the frontend renders verbatim ("Couldn't read tweet, fill the form manually"). Responses are cached in-memory for 1h per tweet ID to bound repeat fetches.

**Request body:**
```json
{ "url": "https://x.com/handle/status/1234567890" }
```

Accepts both `x.com` and `twitter.com` (with or without `www.`), tolerates query string + fragment, and reduces the path to `/<handle>/status/<id>`. Anything else (profile, list, search, non-X host) returns 400.

**Response 200:**
```json
{
  "source_url": "https://x.com/source_handle/status/1234567890123456789",
  "original_tweet_url": "https://x.com/analyst_handle/status/1234567890123456790",
  "posted_at": "2025-11-12T14:33:00.000Z",
  "author_handle": "analyst_handle",
  "tweet_text": "<full OP tweet text>",
  "suggested_title": "<first non-empty line, trimmed to 120 chars>",
  "parsed_coords": [
    { "lat": 48.012345, "lng": 37.802411 }
  ],
  "media": [
    { "kind": "video", "remote_url": "https://video.twimg.com/...", "content_type": "video/mp4", "origin": "quote" },
    { "kind": "image", "remote_url": "https://pbs.twimg.com/...", "content_type": "image/jpeg", "origin": "op" }
  ],
  "quoted_tweet": {
    "source_url": "https://x.com/source_handle/status/1234567890123456789",
    "author_handle": "source_handle",
    "tweet_text": "<full quoted tweet text>"
  },
  "detected": [
    {
      "lat": 48.012345,
      "lng": 37.802411,
      "title": "<derived title>",
      "proof_text": "<cleaned tweet text>",
      "detected_from_url": "https://x.com/analyst_handle/status/1234567890123456790",
      "event_date": "2025-11-12",
      "media": [
        { "kind": "image", "remote_url": "https://pbs.twimg.com/...", "content_type": "image/jpeg", "origin": "op" }
      ]
    }
  ]
}
```

`detected` is the **machine path's** view of the same tweet, the `DetectedGeoloc`s the assemble pipeline would produce, surfaced for inspection with **zero DB writes** (no row, no media fetch). One entry per parsed coordinate; empty when none parse. It's distinct from the human pre-fill above (`parsed_coords` + `media`): `parsed_coords` is candidates for the analyst to pick, `detected` is what the machine would persist as a `detected` row if this tweet were tagged or backfilled.

Every field is best-effort. `parsed_coords` runs four coordinate extractors (decimal, decimal + hemisphere, DMS, Google-Maps URL) over the OP then the quoted tweet, capped at 3 candidates. `suggested_title` is the OP's first usable line (leading hashtags / URLs / list markers / bare coordinates stripped), truncated to 120 chars on a word boundary; empty when nothing usable remains. `media[].remote_url` is always `pbs.twimg.com` or `video.twimg.com`.

`source_url` and `source_posted_at` are both nullable: they fill only on an explicit signal, never as a guess. See [`ingestion.md`](ingestion.md) for the full contract shared with the machine detection path. `source_url` resolution priority:

1. **Quoted tweet's URL**: when the OP quote-retweets, the quoted tweet is the source. `quoted_tweet` carries its metadata so the frontend can render the credit in the proof body. `source_posted_at` is the quote's post date.
2. **First X / Telegram / YouTube link in the OP's `entities.urls`**: catches the OSINT convention of typing `Source: https://t.me/<channel>/<id>` in the body. `source_posted_at` stays `null`, the link carries no date. A coordinate link (Google Maps) or any other host is not a footage source.

Without either signal, `source_url` and `source_posted_at` are both `null` and the form field starts empty. The OP's own URL is never a fallback.

`original_tweet_url` is always the OP's canonical URL, kept separately so the proof body can credit the analyst even when `source_url` points at the source.

`media[].origin` (`op` = own attachment, `quote` = quoted tweet) is informational; the frontend routes by media type:

- `kind: "video"` → **primary** (lands in `files[]` on the submit form).
- `kind: "image"` → **proof** (loaded into the Tiptap proof body inline; it uploads as one of the create/geolocate multipart's `proof_files[]` at publish, see [`POST /events`](#post-events)).
- No video in the response → no primary media is loaded; the analyst attaches the source media manually.

The syndication endpoint doesn't expose reply-chain media, so a video the analyst posted as a self-reply on the same thread is invisible to this route.

**Errors:**
| Code | Case |
|------|------|
| 400 | Not a tweet URL (wrong host, profile / list / search path, malformed) |
| 404 | Tweet not accessible (deleted, protected, never existed) |
| 502 | Syndication endpoint timeout / 5xx / schema drift, frontend renders the "fill the form manually" banner |

---

### `GET /events/import-from-tweet/media?u=<url>` 🔒

Thin proxy that fetches a single X CDN media URL and streams the bytes back.

Auth-required. The `u` host is whitelisted to `pbs.twimg.com` / `video.twimg.com`, any other host returns 400 (SSRF guard). Per-stream byte cap (~110 MB) matches the upload pipeline's video ceiling plus HTTP framing overhead.

**Query params:**
| Field | Type | Required | Description |
|---|---|---|---|
| `u` | string | yes | Absolute X CDN URL (`pbs.twimg.com` / `video.twimg.com`, `https://` only). |

**Response 200:** the upstream bytes, with the upstream `Content-Type` preserved and `Cache-Control: private, max-age=300`.

**Errors:**
| Code | Case |
|------|------|
| 400 | `u` host not in the whitelist |
| 404 | Upstream returned 404 |
| 502 | Upstream transport error, 5xx, or response above the size cap |

---

### `POST /events/import-archive/presign` 🔒

Step one of the archive import: mint a staging key and a presigned direct-to-storage upload for the caller's (browser-stripped) zip. The archive never transits the API. The target is an S3 POST policy (or the dev upload endpoint against local storage, same shape): POST a `multipart/form-data` form to `upload.url` carrying every `upload.fields` entry ahead of the file part, no credentials. The policy pins the exact key, `application/zip`, and the size guard (2 GB), and expires after 15 minutes. No content validation here.

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

Step two: enqueue the staged archive for the backfill worker. The upload **is the consent**: every geolocation lands `detected`, attributed to the caller (no handle-ownership check in this version). The request verifies the staged object (the caller's own `upload_key`, present, under the size guard; a storage HEAD, the zip is never opened here) and returns a **`queued` job (202)**: the worker service (see [`ingestion.md`](ingestion.md#archive-import-worker)) runs the import off the request path and emails the caller the outcome. Poll the job (below) for the counts. A malformed zip therefore surfaces as a `failed` job + failure email, not a synchronous 4xx; the browser strip catches the common shapes before upload.

**Tweets-only intake guard.** Only the allowlisted entries are extracted (`tweets.js`, `tweets_media/`); everything else (DMs, email, account data, `deleted-*`) is never read. Extraction is hardened against zip-slip and zip-bombs; the per-media caps at assemble time are the product limits (see [`ingestion.md`](ingestion.md#archive-import-worker)).

Idempotent on `(detected_from_url, coordinate)`, so a re-upload is a free catch-up. A detection with no recoverable media persists media-incomplete (the owner adds media before submitting).

A tweet that references its footage only through a linked status (`Source: x.com/.../status/...`) has that footage chased via syndication; an unreachable status still lands the tweet, just source-less. A tweet whose footage is a Telegram post (`Source: t.me/<channel>/<id>`) has that post's public embed chased for its date and, when the embed serves it, its media; a sensitive post degrades to link + date.

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
  "created": 0, "skipped": 0, "recreated": 0, "failed": 0,
  "error": null,
  "created_at": "2026-07-17T12:00:00Z",
  "started_at": null,
  "finished_at": null
}
```

**Errors:**
| Code | Case |
|------|------|
| 400 | `archive_upload_invalid` (not a staging key the caller minted: wrong shape, or another user's) |
| 401 | Not authenticated |
| 404 | `archive_upload_missing` (nothing uploaded at `upload_key`) |
| 413 | `archive_too_large` (the staged object is over the size guard) |

---

### `GET /events/import-archive/{job_id}` 🔒

One archive-import job, owner-only (someone else's job id reads as 404, indistinguishable from unknown). The upload page polls this until `status` is terminal; the completion email is the durable signal for an analyst who left.

`status` walks `queued` → `running` → `done` | `failed`. `post_estimate` is a free zip-metadata volume hint stamped at enqueue (declared `tweets.js` size over a per-record average; a display hint, not a promise); once the worker's parse has the exact detection count it stamps `progress_total` and batches `progress_done` as rows land, the upload page's live "137 / 412". The counts are final once `done`: `created` is new `detected` rows; `skipped` a pair a live row already held; `recreated` a previously rejected pair re-detected; `failed` a detection that raised mid-persist (the rest still land). A `failed` **job** keeps whatever landed before the failure (re-uploading skips it and continues); `error` is a terse operator-facing reason. Rate-limited to 60/min/IP.

**Response 200:** the job payload above, counts and timestamps filled per status.

---

### `GET /events/{id}`

Full detail for a single event, in any lifecycle state.

**Response 200:**
```json
{
  "id": "uuid",
  "title": "Strike on depot, Donetsk",
  "event_coords": { "lat": 48.123, "lng": 37.456 },
  "capture_source_coords": null,
  "source_url": "https://t.me/channel/12345",
  "proof": { "type": "doc", "content": [] },
  "event_date": "2026-03-15",
  "event_time": "14:30:00",
  "source_posted_at": "2026-03-14T18:05:00Z",
  "created_at": "2026-03-16T09:42:00Z",
  "updated_at": "2026-03-16T09:42:00Z",
  "requested_at": null,
  "detected_at": null,
  "geolocated_at": "2026-03-16T09:42:00Z",
  "closed_at": null,
  "is_demo": false,
  "status": "geolocated",
  "close_reason": null,
  "before_closed_status": null,
  "detected_from_url": null,
  "detected_post_at": null,
  "owner": {
    "id": "uuid",
    "username": "kalush"
  },
  "requested_by": null,
  "geolocators": [
    { "id": "uuid", "username": "kalush", "is_trusted": false, "trust_reason": null }
  ],
  "investigator_count": 0,
  "investigators": [],
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

`event_coords` is the subject point, `null` on a coordinate-less `requested` event; every `geolocated` row carries it. `capture_source_coords` is the optional camera position, `null` unless the submitter set it. `source_url` / `source_posted_at` are `null` on a `detected` row with no declared source (see [`ingestion.md`](ingestion.md)); a `requested` or `geolocated` row always carries a `source_url`. `requested_by` is the analyst who opened the request, `null` on a directly-created event (no request preceded it). `geolocators` is the durable credit list (who vouched the location, oldest first; empty until the first `geolocate`); `investigators` is the full "working on this" list (newest first, `event_investigators`) and `investigator_count` its length. `close_reason` / `before_closed_status` are `null` while the event is open. `media` carries only the event's `source` attachment(s); a `proof` image never appears here, it lives inline in the `proof` document as a URL. `thumbnail` is the picked card thumbnail (the `source` attachment, else the first `proof` image, else `null`; same rule as [`GET /events`](#get-events)), so previews built on this payload (the map pin hover) render it without re-deriving the pick.

**Errors:**
| Code | Case |
|------|------|
| 404 | Event not found |

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
| `event_date` | string (YYYY-MM-DD) | no | When the depicted event happened. Omitted / empty → stored NULL (the footage doesn't always establish the date; renders as *Unknown*). |
| `event_time` | string (HH:MM) | no | Optional time-of-day for the event (UTC). Omitted / empty → stored NULL. |
| `source_posted_at` | string (`YYYY-MM-DDTHH:MM`) | yes | When the source posted the media, a full instant, read as UTC. Required on this path; the analyst supplies it, since an off-platform source doesn't always carry a machine-readable date. Distinct from `event_date` and the submission time. |
| `proof` | string (JSON) | no | Serialized Tiptap document. Its inline images reference not-yet-uploaded files as `placeholder://<filename>`, resolved against `proof_files`. |
| `tag_ids` | string (JSON array) | yes | `["uuid1", "uuid2"]`. **Must include at least one `capture_source` tag** (see *Required categories* below). |
| `conflict_ids` | string (JSON array) | yes | `["uuid1"]`. Ids from the [conflict referential](#conflicts). **At least one is required** (see *Required categories* below). |
| `file` | File | yes | Exactly one source file (image or video): the footage. |
| `proof_files` | File[] | no | The proof body's inline images, matched to its `placeholder://` srcs by filename. At least one is required (see *Required categories*). |

**Response 201:** same shape as `GET /events/{id}`, born `"status": "geolocated"` with `requested_by: null` and the caller in `geolocators`.

**Required categories.** Three legs of the evidence floor, checked before any upload so a rejection doesn't pay an S3 round-trip: (1) exactly one source `file`; (2) at least one image in the `proof` body (an already-uploaded URL or a `placeholder://` resolved from `proof_files`); (3) `conflict_ids` must resolve to at least one [conflict](#conflicts) (error message "A conflict is required") and `tag_ids` to at least one tag of category `capture_source`, the curated, server-managed taxonomy (see [`Tags`](#tags)). Both domains ship an escape value (conflict → `"Other"`, `capture_source → "Unknown"`) so the requirement is always satisfiable; either miss rejects with `tag_requirements_not_met`.

**Errors:**
| Code | Case |
|------|------|
| 400 | Typed `{code, message}` branch: `invalid_coordinates`, `media_required` (no source file), `invalid_proof` (sanitiser rejection), `proof_image_required` (no proof image), `tag_requirements_not_met` (missing conflict or `capture_source` tag), `invalid_file` (disallowed MIME / size), `evidence_processing_failed`, or `proof_files_mismatch` (a `placeholder://` src with no matching `proof_files` upload, or vice versa) |
| 409 | `source_media_conflict`, a concurrent request raced past the one-source-per-event index |
| 413 | Request body exceeds the platform body-size cap (`max_video_size + max_proof_images_per_event × max_image_size + 10 MB` headroom). Pre-checked by the HTTP-layer middleware before any bytes touch the worker; 413 responses traverse CORS so cross-origin callers see a clean status instead of a CORS error. |
| 422 | Malformed input: `event_date` (not a YYYY-MM-DD date), `event_time` (not HH:MM), `source_posted_at` (not an ISO datetime), **more than `max_proof_images_per_event` files** in `proof_files` (`too_many_files`), `title` over 255 chars, `source_url` over 2000 chars. All match the same-shape rejection on `GET /events` filter params and `_parse_bbox`. |

---

### `DELETE /events/{id}` 🔒

Owner-only delete. Cascades media, tag links, and contributor rows. A **hard** delete: the row and every S3 object it referenced are gone, distinct from the admin soft-delete (`DELETE /admin/events/{id}`) and from `POST /events/{id}/close`, which leaves the row readable.

**Response 204:** no body.

**Errors:**
| Code | Case |
|------|------|
| 403 | Caller is not the owner |
| 404 | Event not found (incl. soft-deleted) |

---

### `GET /events/detections` 🔒

The owner "Detections" queue: the caller's machine-`detected` events awaiting a geolocate, newest first (`created_at` desc). **Scoped to `current_user`**, it ignores any URL username and never exposes another analyst's rows. Powers `/profile/{username}/detections`, where the owner reviews and geolocates each detection. Returns the **full detail** shape (media + tags), not the lightweight list card, so the queue shows the evidence and computes geolocate-readiness (source media + a conflict + a `capture_source` tag) client-side without a per-row fetch.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | int | Page number (default 1) |
| `per_page` | int | Results per page (default 20, max 100) |

**Response 200:** each item is the same shape as `GET /events/{id}`.
```json
{
  "items": [ { "id": "uuid", "status": "detected", "media": [], "tags": [] } ],
  "total": 12,
  "page": 1,
  "per_page": 20
}
```

A detection carries no location it was promoted from; `requested_by` is always `null` here (a detection is machine-born, not opened as a request).

**Errors:**
| Code | Case |
|------|------|
| 401 | Not authenticated |

---

### `POST /events/requests` 🔒

Open a request: creates a `requested` event with no coordinates yet (ex `POST /requests`). One source file is required, since the platform treats a request as an "unfinished geolocation"; coordinates, the camera point, tags, and the event date are all optional (an approximate guess is allowed, both-or-neither on each coordinate pair). The caller is recorded as both `owner` and `requested_by`; `requested_by` survives the later `geolocate`.

**Request body (`multipart/form-data`):**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Title; empty / whitespace-only rejected. Max 255 chars. |
| `source_url` | string | yes | URL where the media was found. Max 2000 chars. |
| `proof` | string (JSON) | no | In-progress proof (Tiptap document); sanitised server-side and image-free (no `proof_files` on this path, inline images are dropped by the sanitiser) |
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
| 400 | Plain-string validation (empty / whitespace-only `title` or `source_url`) **or** a typed `{code, message}` branch: `invalid_coordinates` (a half-typed guess pair), `media_required` (no file), `invalid_proof`, `invalid_file`, `evidence_processing_failed` |
| 413 | Request body exceeds the platform body-size cap, same middleware as `POST /events` |
| 422 | `title` over 255 chars / `source_url` over 2000 chars, malformed `event_date` / `event_time` / `source_posted_at`, missing required `source_posted_at`, or `event_time` without `event_date` |

---

### `POST /events/{id}/geolocate` 🔒

Give an event a vouched location: transitions `requested` | `detected` → `geolocated` in one atomic request, writing the caller's whole edited form. This is the **single** fulfil / geolocate path. A `detected` row is immutable machine output, so this is the **only** write to it, and it stays owner-only; a `requested` event is answerable by anyone, and the fulfiller becomes its `owner` (`requested_by` keeps the original poster). **Multipart**, mirroring `POST /events`: the form posts the whole row state and the server applies the field updates, media removals, and new-media uploads, then freezes the row as `geolocated`, in one transaction under a row lock (a concurrent geolocate on the same row serializes and the loser gets 409). Allowed **only while `requested` / `detected`**; a `geolocated` row is frozen.

**Request body (`multipart/form-data`):**
| Field | Type | Description |
|-------|------|-------------|
| `title` | string | 1-255 chars |
| `lat` | float | Latitude (-90 to 90) of the subject |
| `lng` | float | Longitude (-180 to 180) of the subject |
| `capture_source_lat` | float | Latitude of the camera position. Both-or-neither with `capture_source_lng`. |
| `capture_source_lng` | float | Longitude of the camera position. |
| `source_url` | string | ≤2000 chars, the footage origin. A `detected` draft may start with no declared source (`null`, see [`ingestion.md`](ingestion.md)): a blank value here 400s as `source_url_required`, since a `geolocated` row always carries one. Fulfilling a `requested` event ignores this field and keeps the request's `source_url` (a fulfiller must not rewrite the requester's evidence anchor) |
| `event_date` | string (YYYY-MM-DD) | When the depicted event happened. Optional, mirroring create: empty / omitted stores NULL (renders as *Unknown*) |
| `event_time` | string (HH:MM) | Optional time-of-day for the event (UTC); empty / omitted clears it |
| `source_posted_at` | string (`YYYY-MM-DDTHH:MM`) | When the source posted the media, a full instant (UTC). Required on this path; the analyst supplies it, since an off-platform source doesn't always carry a machine-readable date |
| `proof` | JSON string | Tiptap document (sanitised); its `placeholder://` srcs resolve against `proof_files`, already-uploaded URLs pass through untouched |
| `tag_ids` | JSON string (UUID[]) | Replaces the tag set wholesale |
| `conflict_ids` | JSON string (UUID[]) | Replaces the event's [conflict](#conflicts) set wholesale |
| `remove_media_ids` | JSON string (UUID[]) | Existing source media to drop (S3 swept) |
| `files` | file[] | New source media to add (0 or 1; kept + new must total exactly one, same allowlist + size limits as create) |
| `proof_files` | file[] | New proof images referenced by `placeholder://` srcs in `proof` |

`detected_from_url` (the provenance anchor, the post the detection was imported from) and `status` carry no field, so a caller that sends them is ignored. Blocked until the evidence floor a direct create meets is satisfied by the post-geolocate state: **exactly one source media** (kept + new), **at least one proof image** in the final proof body, and **one conflict + one `capture_source` tag**. A `requested` event and a machine detection are both born without the curated floor, so it is enforced here; the fulfiller adds the conflict and tags as part of the geolocate.

**Response 200:** same shape as `GET /events/{id}` (now `"status": "geolocated"`, the caller added to `geolocators`).

**Errors:**
| Code | Case |
|------|------|
| 400 | `invalid_coordinates`, `invalid_proof`, `proof_image_required` (no proof image in the final body), `tag_requirements_not_met`, a rejected file (`invalid_file` / `evidence_processing_failed`), no surviving source media (`media_required`), `proof_files_mismatch`, or `source_url_required` (a `detected` draft with no declared source, geolocated with a blank `source_url` field) |
| 403 | Caller is not the owner of a `detected` draft (a `requested` event is answerable by anyone) |
| 404 | Event not found (incl. soft-deleted) |
| 409 | Row is not `requested` / `detected` (`invalid_state`, a `geolocated` row is frozen), or `source_media_conflict` (a concurrent edit raced past the one-source cap) |
| 422 | Kept + new source media over one (`too_many_files`), or more than `max_proof_images_per_event` proof files |

---

### `POST /events/{id}/close` 🔒

Close an event: withdraw a `requested` row or reject a `detected` draft, owner-only, in one verb. The row stays publicly visible (transparency: a queue entry that didn't produce a geolocation, or a machine draft judged wrong); `before_closed_status` records which state it left (drives the status badge and the requested-view routing). A closed `detected` row is re-importable if the same tweet is later re-detected. Distinct from `DELETE`, which removes the row for good.

**Request body:**
```json
{ "close_reason": "AI-generated image, not a real event" }
```
`close_reason` is required (1-2000 chars) and stays publicly visible on the closed row.

**Response 200:** same shape as `GET /events/{id}` (now `"status": "closed"`).

**Errors:**
| Code | Case |
|------|------|
| 403 | Caller is not the owner |
| 404 | Event not found (incl. soft-deleted) |
| 409 | Row is not `requested` / `detected` (`invalid_state`, `geolocated` and `closed` are both terminal here) |
| 422 | `close_reason` missing or over 2000 chars |

---

### `POST /events/{id}/investigate` 🔒

Signal "I'm working on this" on a `requested` event. Multi-analyst: several investigators can hold the signal on one event at once, it's a coordination hint, not a single-claimer reservation. Idempotent, re-signalling is a 204 no-op, not a 409.

**Response 204:** no body.

**Errors:**
| Code | Case |
|------|------|
| 404 | Event not found (incl. soft-deleted) |
| 409 | Event status is not `requested` |

---

### `DELETE /events/{id}/investigate` 🔒

Caller leaves the working set. Idempotent (204 even if the caller wasn't signalling).

**Response 204:** no body.

**Errors:**
| Code | Case |
|------|------|
| 404 | Event not found (incl. soft-deleted) |
| 409 | Event status is not `requested` (a terminated event's signals are frozen history) |

---

## Requests, geolocations, and detections are `/events` views

There is no `/requests` router. A **request** is a `requested` event, a **geolocation** is a `geolocated` event, and a **detection** is a `detected` event, all rows on the one `events` table, distinguished only by `status`. Every read and write above already covers all three:

- **List / detail**: [`GET /events`](#get-events) (`view=requested` is the request queue, `view=located` the geolocation catalog, both carry `detected` rows too) and [`GET /events/{id}`](#get-eventsid) (any status).
- **Open a request**: [`POST /events/requests`](#post-eventsrequests) (no coordinates required).
- **Fulfil a request, or vouch a detection**: [`POST /events/{id}/geolocate`](#post-eventsidgeolocate) (`requested` | `detected` → `geolocated`, one verb for both).
- **Withdraw a request, or reject a detection**: [`POST /events/{id}/close`](#post-eventsidclose) (one verb for both, `before_closed_status` tells them apart).
- **"I'm working on this"** on a request: [`POST`](#post-eventsidinvestigate) / [`DELETE /events/{id}/investigate`](#delete-eventsidinvestigate).
- **Remove**: [`DELETE /events/{id}`](#delete-eventsid) (owner hard delete) or `DELETE /admin/events/{id}` (admin soft/hard delete).

`GET /events?view=requested` cards additionally carry `investigator_count` / `investigators_sample`; `GET /events/{id}` always carries the full `investigators` list and `geolocators`. `Search` groups a hit under `requests` when its `status` is `requested`, see below.

---

## Search

Slice-1 full-text discovery surface across the three first-class entity types. Backed by two Postgres GIN indexes on `to_tsvector('simple', …)` expressions: one over `events.title` and one over `users.username || ' ' || users.bio` (migration `o1j3k5l7m9n1`). One FTS query path over the single `events` table; the located (`geolocations`) and requested (`requests`) groups run the same `title` index with different `WHERE`s (`status IN ('geolocated', 'detected') AND event_coords IS NOT NULL` vs `status = 'requested'`). The `simple` dictionary keeps matching predictable. The response is still grouped by entity type.

**Out of scope for slice 1:** searching `source_url`, JSONB-content search (`events.proof`), per-group infinite scroll, and the filter chips beyond the entity-type pick.

### `GET /search` 🌐

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Free-text query. Empty / whitespace-only short-circuits to empty groups (unless a filter is active). |
| `type` | enum | `all` (default), `event` (the two event groups: what the search page's unified "Events" chip sends), `geolocation`, `request`, or `user`. Anything else → 422. |
| `limit` | int | Per-group cap. 1 ≤ `limit` ≤ 50, default 20. |
| *filter set* | | The standard event filter set, same names and semantics as [`GET /events`](#get-events): `status`, `conflict`, `capture_source`, `tag`, `media` (repeatable), `event_date_from` / `event_date_to`, `submitted_from` / `submitted_to`, `author`, `trusted_only`, `hide_demo`. Scopes the two event groups (a `status` value a group's view can't contain empties that group). |

Any active filter empties the users group (the filters are event predicates; an unfiltered analyst list next to a filtered event view would read as if the filter applied). With an empty `q` and at least one active filter, **browse mode**: the filtered view, newest first, plain titles as their own highlight (the profile's "Show more" entry point); typing then narrows within it.

**Ranking:** `ts_rank` descending then `created_at` descending as a stable tie-breaker.

**Soft-delete:** every group filters `deleted_at IS NULL` at query time.

**Highlight markers:** each hit carries one or more `*_highlight` fields with STX (`U+0002`) / ETX (`U+0003`) control bytes around matched fragments. JSON encodes them as `` / ``. The frontend (`lib/search.ts::splitHighlights`) splits on those bytes and wraps the inner segments in `<mark>`, no raw HTML crosses the wire, so it's XSS-safe by construction.

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
      "is_demo": false,
      "status": "geolocated",
      "owner": { "id": "uuid", "username": "osint_analyst", "is_trusted": true, "trust_reason": "…" },
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
      "is_demo": false,
      "owner": { "…": "…" },
      "media": [{ "id": "uuid", "storage_url": "…", "media_type": "image" }],
      "tags": [],
      "claimer_count": 3
    }
  ],
  "users": [
    {
      "id": "uuid",
      "username": "kharkiv_osint",
      "username_highlight": "kharkiv_osint",
      "bio": "Tracking armoured movement in Eastern Ukraine.",
      "bio_highlight": null,
      "is_trusted": true,
      "trust_reason": "Established public track record",
      "avatar_url": null
    }
  ],
  "total": { "geolocations": 1, "requests": 1, "users": 1 },
  "query": "kharkiv",
  "type": "all"
}
```

`media` on both event groups carries the picked card thumbnail (at most one row: the `source` attachment, else the first `proof` image), the same rule as the [`GET /events`](#get-events) card.

`bio_highlight` is `null` when only the username matched, the UI uses this to hide the snippet block instead of rendering an un-highlighted bio. Groups the caller didn't request via `type=` come back as empty arrays.

`total` is a fixed-key object (`geolocations`, `requests`, `users`), each the pre-LIMIT match count for its group (so the UI renders "3 of 142", not "3 of 3"). `type` echoes the request and is one of `all`, `geolocation`, `request`, `user`.

**Errors:**
| Code | Case |
|------|------|
| 401 | Unauthenticated |
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

List the conflict referential, ordered `ongoing` first then by name. Server-managed (the daily Wikipedia sync, the one-shot Wikidata seed, operator rows; see [`ingestion.md`](ingestion.md#conflict-referential-sync)): there is no create endpoint. The default returns **every** row, ongoing and ended alike, so the submit picker can offer ended conflicts for archival footage. Rate-limited to 60/min/IP.

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

Ongoing-conflict names and dates derive from Wikipedia's "List of ongoing armed conflicts", available under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); any surface listing them should carry that attribution.

---

## Users

### `GET /users/{username}`

Public profile of an analyst.

**Response 200:**
```json
{
  "id": "uuid",
  "username": "kalush",
  "is_trusted": false,
  "trust_reason": null,
  "bio": "OSINT analyst tracking armoured movement in Eastern Ukraine.",
  "avatar_url": "https://cdn.example.com/avatars/kalush.jpg",
  "external_links": {
    "x": "@kalush",
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

`is_trusted` toggles via `PATCH /admin/users/{id}/trust`; `trust_reason` is required when granting. `bio` / `avatar_url` / `external_links` are self-set via `PATCH /users/me`, defaults are `null` / `null` / `{}`. `is_following` is `true` only when the caller is authenticated and follows this user; anonymous viewers and self-views always get `false`. Email is never on this shape.

**Errors:**
| Code | Case |
|------|------|
| 404 | User not found |

---

### `GET /users/{username}/stats`

Aggregated shape of an analyst's work, over their live events only (`deleted_at IS NULL`). Pure aggregation over existing columns; drives the profile's insights section (status split, media volume, top theatres, capture lens, 12-month activity).

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
  "monthly_activity": [{ "month": "2025-08", "count": 0 }, { "month": "2025-09", "count": 3 }]
}
```

`total_events` is the sum of the three status counts (`requested` events are not part of the split). `top_conflicts` and `capture_sources` are capped at 5, ordered by count desc then name. `monthly_activity` buckets `event_date` into the last 12 calendar months (current month last), zero-filled.

**Errors:**
| Code | Case |
|------|------|
| 404 | User not found |

---

### `PATCH /users/me` 🔒

Edit your own profile, bio, avatar URL, and Linktree-style external account handles.

**Body** (all fields optional; absent = leave column alone, explicit `null` or empty string = clear):
```json
{
  "bio": "OSINT analyst, Eastern Ukraine armoured movement.",
  "avatar_url": "https://cdn.example.com/avatars/me.jpg",
  "external_links": {
    "x": "@me",
    "discord": "me",
    "website": "https://me.example.com",
    "github": "@me"
  }
}
```

`bio` is capped at 500 characters. `avatar_url` must be `http` or `https`, `javascript:` and other schemes are rejected (XSS class blocked at write time). `external_links` is **wholesale-replaced**, not deep-merged: send the full panel each time. Per-platform values are 200 chars max; values are free-form strings (handle or URL).

**Response 200:** the updated `UserRead` (same shape as `GET /auth/me`).

**Errors:**
| Code | Case |
|------|------|
| 401 | Not authenticated |
| 422 | Validation failure (bio too long, non-http(s) URL, unknown field) |

---

### `GET /users/{username}/events`

Geolocations for a given analyst.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | int | Page number (default 1) |
| `per_page` | int | Results per page (default 20, max 100) |

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

Activity feed of geolocations submitted by analysts the current user follows, ordered by event date descending.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | int | Page number (default 1) |
| `per_page` | int | Results per page (default 20, max 100) |

**Response 200:** same `PaginatedEvents` shape as `GET /users/{username}/events`.

**Errors:**
| Code | Case |
|------|------|
| 401 | Not authenticated |

---

## Admin

All routes below are mounted under `/admin` and gated by the `require_admin` FastAPI dependency. `require_admin` layers on top of `get_current_user`, so a deactivated admin (`is_active=false`) loses access immediately.

<details>
<summary>16 admin endpoints, rarely-touched ops surface (invites, detection-quality metrics, soft/hard delete, trust toggle, X handle link, demo seeding, maintenance reapers). Expand for full contracts.</summary>

### `GET /admin/me` 🛡️

**Response 200:**
```json
{ "is_admin": true }
```

Returns 403 for non-admins, 401 for anonymous callers.

### `GET /admin/detection-stats` 🛡️

Quality signal on the machine-extraction pipeline. A **machine detection** is an event imported from X (the archive backfill or the bot), identified by `detected_from_url` being set; a human submit always carries `detected_from_url = null`. Demo rows (`is_demo`) are excluded from both aggregates. Read-only, no audit row (a metric read is not an administrative act).

**Reject-rate** is the share of machine detections dismissed while still a draft, whichever door they left through. A machine detection counts as a reject if either an owner closed it straight out of `detected` (`status = "closed"` with `before_closed_status = "detected"`) or an admin soft-deleted it while it was still `detected` (`deleted_at` set with `status = "detected"`). A detection the owner vouched (promoted to `geolocated`) is **not** a reject, even once soft-deleted (it was vouched before removal); one still awaiting review is **not** a reject yet. `reject_rate` is `machine_rejected / machine_total` as a 0..1 ratio (`0` when there are no machine detections). Counted over every (non-demo) machine row, soft-deleted or not: the metric measures what the pipeline produced.

Two counting edges the metric accepts, both favouring over-counting dismissals over under-counting them: an owner **hard-delete** (`DELETE /events/{id}` on an own draft) removes the row from both counts entirely; an **account-departure cascade** soft-delete counts that account's pending drafts as rejects.

The `pending_*` counts profile the **live** `detected` queue (`deleted_at IS NULL`, machine rows only, demo excluded): drafts missing a piece the geolocate floor will demand (a source media, a proof-role image, or a `source_url`), so a low-quality extraction run is visible before an analyst opens the queue.

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

`max_uses` is server-fixed at `1` and is not accepted in the request body. `expires_in_days` is optional (omit / `null` for "never expires"), max `365`. `x_handle` is optional: it binds the code to an X handle, normalized like `PATCH /admin/users/{id}/x-handle` (single leading `@` stripped, lowercased, `^[a-z0-9_]{1,15}$`); redemption copies it onto the new account as its bot-attribution link (fail-soft: if the handle got linked elsewhere meanwhile, the account is still created without it).

**Response 201:**
```json
{
  "id": "8e67f0…",
  "code": "abc123xyz",
  "max_uses": 1,
  "use_count": 0,
  "expires_at": "2026-05-23T10:00:00Z",
  "revoked_at": null,
  "created_at": "2026-05-09T10:00:00Z",
  "status": "active",
  "used_by_username": null,
  "used_at": null,
  "x_handle": "osint_hawk"
}
```

`status` is one of `active | exhausted | revoked | expired`, computed at read time.

**Response 409:** `x_handle` already linked to a user (`{"code": "x_handle_conflict", …}`).

**Response 422:** `x_handle` outside the handle alphabet.

### `GET /admin/invite-codes` 🛡️

List every invite code (newest first), including exhausted / revoked / expired ones.

**Response 200:**
```json
[
  { "id": "…", "code": "…", "status": "active", "max_uses": 1, "use_count": 0, "expires_at": null, "revoked_at": null, "created_at": "…", "used_by_username": null, "used_at": null, "x_handle": null }
]
```

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
    "is_trusted": true,
    "trust_reason": "Established OSINT track record",
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

### `DELETE /admin/events/{id}` 🛡️

Remove an event. Default is soft delete (sets `deleted_at`); pass `?hard=true` for GDPR-grade erasure. Both modes invalidate the `/events/points` cache. Audited via `admin_events` (`action = "geolocation_soft_deleted"` / `"geolocation_hard_deleted"`).

**Soft delete** (`?hard=false` or omitted): the row, its media rows, and its S3 objects stay put. Only `deleted_at` flips, and every public read filters it out. Idempotent: re-soft-deleting preserves the original timestamp and skips the audit append.

**Hard delete** (`?hard=true`): drops the row (cascade kills every `media` row, source and proof roles alike) and best-effort-deletes the corresponding S3 objects. The DB transaction commits *before* the S3 delete attempt so a flaky storage backend can't strand DB rows pointing at live keys; per-key S3 failures are logged and swallowed (the accepted residual orphan risk).

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

### `PATCH /admin/users/{id}/trust` 🛡️

Grant or revoke `is_trusted`. Granting requires a non-empty `trust_reason` (rejected with 422 otherwise). Revoking ignores any reason in the body and clears `trust_reason` server-side. Audited via `admin_events` (`action = "trust_granted"` / `"trust_revoked"`).

**Request body:**
```json
{ "is_trusted": true, "trust_reason": "Established OSINT track record" }
```

**Response 200:** the updated `AdminUserRead`.

**Response 422:** granting trust without a reason.

**Response 404:** unknown user id.

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

### `POST /admin/seed-demo-requests` 🛡️

Generate `count` synthetic demo requests attributed to the same fixed pool of demo authors as `POST /admin/seed-demo`. Reads templates from the shared `demo-pool/` storage prefix; if the prefix is empty or missing the expected layout, returns 422 so the admin can populate the pool before retrying. A fraction of requests get 1-3 random demo-author claims attached. Audited as `demo_requests_seeded`.

**Request body:**
```json
{ "count": 20 }
```
Capped at 5000 per click.

**Response 200:**
```json
{
  "created": 20,
  "templates": 3,
  "authors": 5,
  "with_claims": 11,
  "open": 12,
  "fulfilled": 5,
  "closed": 3
}
```

`open` / `fulfilled` / `closed` are the per-status breakdown across the generated batch (`requested` / `geolocated` / `closed` under the hood), proving the status-filter chips have data to render. `with_claims` counts requests that got 1-3 random demo-analyst `event_investigators` rows attached (the field name predates the claim → investigate rename; the wire shape is unchanged).

---

### `DELETE /admin/seed-demo-requests` 🛡️

Drop every `is_demo=true` request in one bulk DELETE. Demo users and demo geolocations are NOT touched; those live behind the separate `/admin/seed-demo` panel. The `demo-pool/` S3 objects stay (shared assets). Audited as `demo_requests_wiped`.

**Response 200:**
```json
{ "deleted_requests": 20 }
```

---

### `POST /admin/seed-demo` 🛡️

Generate synthetic demo geolocations attributed to the demo author pool (`demo-analyst-1` … `-5`, `is_demo=true`). Reads templates from the `demo-pool/` storage prefix populated by the admin outside the codebase; each generated geo references (does not copy) a random subset of the template's media and proof imagery via CloudFront URLs. Region split (weights, integer percent): Ukraine 50, Middle East 20, Sahel 8, Western Europe 7, Balkans 4, North America 4, South America 3, East Asia 2, Sub-Saharan Africa 2. Audited as `demo_seeded`. Invalidates the points cache.

**Request body:**
```json
{ "count": 100 }
```

`count` is `1 ≤ count ≤ 50000`; default 100. Re-running is additive on geos and idempotent on demo authors.

**Response 200:**
```json
{ "created": 100, "templates": 10, "authors": 5 }
```

**Response 422:** the `demo-pool/` prefix is empty or has no `geo-XX/media/<file>` entries.

### `DELETE /admin/seed-demo` 🛡️

Drop every `is_demo=true` geolocation + user. The `demo-pool/` S3 objects are NOT touched; they're shared assets for re-seeding. Audited as `demo_wiped`. Invalidates the points cache.

**Response 200:**
```json
{ "deleted_geos": 100, "deleted_users": 5 }
```

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

</details>

---

## Webhooks

The X Account Activity webhook, the bot's nominal mention delivery (see [`ingestion.md`](ingestion.md#bot-format)). **Unauthenticated by design**: X calls it, and the HMAC signature over the raw body (the app's consumer secret, held only by X and the deployment) is the gate.

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

Endpoints that return paginated lists use this shape:
```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "per_page": 20
}
```

`GET /events` and `GET /events/points` are intentionally **unpaginated** today. A hard server-side `LIMIT` will land before public read access.

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
