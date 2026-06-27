# API — REST contracts

Base URL: `/api/v1`

All responses are JSON.

**Auth.** Endpoints marked 🔒 require a logged-in session: the `vidit_session` cookie (set by `POST /auth/login`, `HttpOnly; Secure; SameSite=Lax`) plus, for state-changing requests (`POST`/`PUT`/`PATCH`/`DELETE`), the `X-CSRF-Token` header echoing the JS-readable `vidit_csrf` cookie. There is no `Authorization: Bearer` flow — the cookie + CSRF pair is the only authenticated channel into the backend. Endpoints marked 🛡️ additionally require `is_admin=true` on the caller (returns 403 otherwise).

**Transport security.** Every response carries `Strict-Transport-Security: max-age=15768000`. The header has no `includeSubDomains` or `preload` directives.

**Auth audit log.** The `/auth/*` endpoints write to the `auth_events` table as a side-effect: `login` on success, `failed_login` on any rejected login (with `user_id` only when the address matched a live user), `logout`, `register_pending` (on `POST /auth/register`), `register_resent` (on `POST /auth/resend-confirmation`, on both the matched-pending and no-matching-pending branches so the rate-of-requests signal survives the always-204 discipline; `user_id` is always NULL since no user row exists yet), `register_confirmed` (on `POST /auth/confirm-registration`), `password_reset_requested` (on `POST /auth/forgot-password`, on both the known-email and unknown-email branches so the audit trail is a "rate of requests" signal), `password_reset_completed`, and `password_changed` (on `POST /auth/change-password`). Writes are best-effort inside a SAVEPOINT — an audit failure never breaks the auth flow.

**Error envelope.** Three shapes appear on the `detail` field of non-2xx responses, and frontend `apiFetch` ([`frontend/src/lib/api.ts`](../frontend/src/lib/api.ts)) normalises all three. (1) **Plain string** — `{"detail": "Invite code not found"}` for direct `HTTPException` raises in routers (e.g. `DELETE /admin/invite-codes/{id}` 404). (2) **Pydantic validation array** — `{"detail": [{"loc": [...], "msg": "...", "type": "..."}, ...]}` for request-body / query-string validation failures (FastAPI default). (3) **Typed envelope** — `{"detail": {"code": "<stable_id>", "message": "<human prose>"}}` for business-rule errors raised from the service layer and translated by the router. Used by every `/auth/register` + `/auth/confirm-registration` + `/auth/resend-confirmation` error branch (codes: `invalid_invite`, `email_already_registered`, `username_already_taken`, `email_pending_confirmation`, `username_pending_confirmation`, `invalid_or_expired_token`), every `/admin/*` business-rule error branch (codes: `user_not_found`, `geolocation_not_found`, `trust_reason_required`), every `POST /geolocations` business-rule branch (codes: `invalid_coordinates`, `too_many_files`, `media_required`, `invalid_proof`, `tag_requirements_not_met`, `invalid_file`, `evidence_processing_failed`, `bounty_not_found`, `bounty_not_open`), and every `POST /bounties` business-rule branch (codes: `too_many_files`, `media_required`, `invalid_file`, `evidence_processing_failed`, `invalid_proof` — geolocations and bounties share the file/media codes via `services/evidence_intake`). The `code` is the stable contract surface — branch on it, not on `message`. Status codes follow the per-endpoint contracts below.

---

## Endpoints at a glance

Auth column: — anonymous, 🔒 logged-in, 🛡️ admin-only.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| **Auth** | | | |
| POST | `/auth/register` | — | Stage a pending registration; sends confirmation email |
| POST | `/auth/confirm-registration` | — | Confirm a pending registration (creates user, signs in) |
| GET | `/auth/invites/{code}/check` | — | Advisory invite-code probe for the registration form |
| POST | `/auth/resend-confirmation` | — | Re-send the confirmation email; invalidates previous token |
| POST | `/auth/login` | — | Email + password → session + CSRF cookies |
| POST | `/auth/logout` | — | Clear session cookies (idempotent) |
| GET | `/auth/me` | 🔒 | Current user |
| POST | `/auth/forgot-password` | — | Email a single-use reset token (always 204) |
| POST | `/auth/reset-password` | — | Consume reset token, set new password |
| POST | `/auth/change-password` | 🔒 | Authenticated password rotation; requires current password |
| **Geolocations** | | | |
| GET | `/geolocations` | — | List geolocations for the map (lightweight format) |
| GET | `/geolocations/points` | — | Compact map-points tuples (cached) |
| GET | `/geolocations/possible-duplicates` | 🔒 | Soft-warning probe for the submit form |
| POST | `/geolocations/import-from-tweet` | 🔒 | Parse a tweet URL into a submit-form pre-fill payload |
| GET | `/geolocations/import-from-tweet/media` | 🔒 | Proxy fetch an X CDN media URL |
| GET | `/geolocations/{id}` | — | Full geolocation detail |
| POST | `/geolocations` | 🔒 | Create a geolocation (multipart, uploads media) |
| DELETE | `/geolocations/{id}` | 🔒 | Author-only delete + S3 sweep |
| GET | `/geolocations/review-queue` | 🔒 | Your `detected` geolocations awaiting review (paginated) |
| POST | `/geolocations/proof-images` | 🔒 | Upload an inline image referenced by the Tiptap proof |
| **Bounties** | | | |
| GET | `/bounties` | — | List bounties (newest first, soft-delete filtered) |
| GET | `/bounties/{id}` | — | Bounty detail |
| POST | `/bounties` | 🔒 | Post a bounty (multipart) |
| DELETE | `/bounties/{id}` | 🔒 | Author hard-delete; cascades media + claims |
| POST | `/bounties/{id}/claim` | 🔒 | "I'm working on this" (idempotent, multi-claimer) |
| DELETE | `/bounties/{id}/claim` | 🔒 | Leave the working set |
| POST | `/bounties/{id}/close` | 🔒 | Author withdraws without fulfilment |
| **Search** | | | |
| GET | `/search` | 🔒 | Free-text search across geolocations / bounties / users |
| **Tags** | | | |
| GET | `/tags` | — | List tags (defaults to ones referenced by live geos) |
| POST | `/tags` | 🔒 | Create a free tag (curated categories rejected) |
| **Users** | | | |
| GET | `/users/{username}` | — | Public analyst profile |
| PATCH | `/users/me` | 🔒 | Edit your bio, avatar, external links |
| GET | `/users/{username}/geolocations` | — | List an analyst's geolocations |
| POST | `/users/{username}/follow` | 🔒 | Follow (idempotent; self-follow → 400) |
| DELETE | `/users/{username}/follow` | 🔒 | Unfollow (idempotent; unknown user → 404) |
| **Timeline** | | | |
| GET | `/timeline` | 🔒 | Activity feed from followed analysts |
| **Admin** (collapsed below) | | | |
| GET | `/admin/me` | 🛡️ | `is_admin` probe |
| POST/GET/DELETE | `/admin/invite-codes[/{id}]` | 🛡️ | Mint / list / revoke invite codes |
| GET | `/admin/users` | 🛡️ | Substring search on username/email |
| DELETE | `/admin/users/{id}` | 🛡️ | Soft delete (default) or `?hard=true` GDPR erasure |
| DELETE | `/admin/geolocations/{id}` | 🛡️ | Soft delete or `?hard=true` GDPR erasure |
| PATCH | `/admin/users/{id}/trust` | 🛡️ | Grant / revoke `is_trusted` + `trust_reason` |
| POST/DELETE | `/admin/seed-demo[-bounties]` | 🛡️ | Generate / drop demo geos + users / bounties |
| POST | `/admin/maintenance/reap-*` | 🛡️ | Cron-style reapers (auth tokens, proof orphans, pending regs) |

---

## Rate limits

One shared **slowapi** limiter ([`app/ratelimit.py`](../backend/app/ratelimit.py)), keyed per client IP — the right-most `X-Forwarded-For` entry (see [`engineering.md`](engineering.md) → *Particularities*). Limits are per-endpoint; there is **no global floor**, so any endpoint absent from this table is unlimited. Buckets are in-process (one replica today). An over-quota request gets `429` with `{"detail": "Rate limit exceeded. Try again later."}`. `RATE_LIMIT_ENABLED=false` disables every limit at once (local dev).

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
| **Geolocations** | |
| `GET /geolocations` | 120/min |
| `GET /geolocations/points` | 60/min |
| `GET /geolocations/possible-duplicates` | 60/min |
| `GET /geolocations/{id}` | 120/min |
| `GET /geolocations/review-queue` | 120/min |
| `POST /geolocations/import-from-tweet` | 30/min |
| `GET /geolocations/import-from-tweet/media` | 60/min |
| `POST /geolocations` | 30/min |
| `DELETE /geolocations/{id}` | 30/min |
| `POST /geolocations/proof-images` | 30/min (+ per-user 24h DB ceiling) |
| **Bounties** | |
| `GET /bounties`, `GET /bounties/{id}` | 120/min |
| `POST /bounties`, `DELETE /bounties/{id}` | 30/min |
| `POST`/`DELETE /bounties/{id}/claim`, `POST /bounties/{id}/close` | 60/min |
| **Search / Tags** | |
| `GET /search` | 60/min |
| `GET /tags` | 60/min |
| `POST /tags` | 30/min |
| **Users / Timeline** | |
| `GET /users/{username}`, `GET /users/{username}/geolocations`, `GET /timeline` | 120/min |
| `PATCH /users/me` | 30/min |
| `POST`/`DELETE /users/{username}/follow` | 60/min |
| **Admin** 🛡️ | |
| `POST /admin/invite-codes` · `DELETE /admin/users/{id}` | 30/hour |
| `DELETE /admin/invite-codes/{id}` · `PATCH /admin/users/{id}/trust` · `DELETE /admin/geolocations/{id}` | 60/hour |
| `POST`/`DELETE /admin/seed-demo[-bounties]` | 10/hour |
| `POST /admin/maintenance/reap-*` | 30/hour |

`GET /auth/invites/{code}/check` and the read-only admin probes (`GET /admin/me`, `/admin/users`, `/admin/invite-codes` list) carry no limit.

---

## Auth

### `POST /auth/register`

Stage a registration. Anonymous. **No `users` row is created here** — the submission lives in `pending_registrations` until the user proves they own the email by clicking the link in the confirmation message. The invite code is referenced by the pending row but not consumed; an abandoned signup does not burn the invite.

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

Anonymous. Pre-flight invite-code probe for the registration form. Mirrors the same `validate_invite_code` check the `POST /auth/register` step runs, so a `200 {"valid": true}` here does not reserve the code — a concurrent registration can still consume it between the check and the submit.

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

Anonymous. Re-mints the token for an outstanding pending registration and re-sends the confirmation email. Always 204 to avoid leaking which addresses are in flight. The previous token is invalidated by the re-mint — a shoulder-surfed link from the first email cannot be redeemed after the resend.

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

`is_trusted` / `trust_reason` are public on purpose — the trust mark is a credibility signal and the reason is what makes it credible. The profile fields (`bio`, `avatar_url`, `external_links`) ship with the self-payload so the sidebar avatar and "edit profile" form can render without a second fetch. **`is_admin` is not on this shape**; the admin role only surfaces via `GET /admin/me`. `email_verified_at` is not exposed: the pre-creation flow means there's no unverified-user state.

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

Anonymous. Consumes a reset token and sets a new password. Tokens are single-use, expire `PASSWORD_RESET_TOKEN_MINUTES` after mint (default 15 — the reset email quotes the same value), and become invalid the moment a fresh `forgot-password` is issued for the same user.

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
| 400 | Token unknown, expired, already consumed, or wrong purpose — same opaque error to avoid leaking which |

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

## Geolocations

### `GET /geolocations`

List geolocations for the map. Returns a lightweight format (no full proof).

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `conflict` | string (repeatable) | Filter by conflict tag name. Repeat the param to OR within the conflict bucket (`?conflict=Ukraine&conflict=Gaza`). Matching tags must additionally carry `category == "conflict"`, so a free tag with the same name doesn't poison the result. |
| `capture_source` | string (repeatable) | Filter by capture-source tag name (`?capture_source=Satellite&capture_source=Drone`). Same semantics as `conflict`: OR within the bucket, AND across buckets, and the matched tag must carry `category == "capture_source"`. |
| `tag` | string (repeatable) | Filter by tag name (any category). Repeat the param to OR within the tag bucket (`?tag=drone&tag=tank`). Combining buckets ANDs across them — the geolocation must satisfy each bucket independently. |
| `bbox` | string | `south,west,north,east` (four comma-separated floats). 422 on malformed input — latitudes in [-90, 90], longitudes in [-180, 180], south ≤ north, west ≤ east. |
| `event_date_from` / `event_date_to` | date (YYYY-MM-DD) | Inclusive event-date range. Malformed values return 422 (used to silently 500 from Postgres `InvalidDatetimeFormat`). |
| `submitted_from` / `submitted_to` | date (YYYY-MM-DD) | Inclusive submission-date range. Same 422-on-malformed shape as the event-date filters. |
| `author` | string | Substring match on author username. Whitelisted to `[A-Za-z0-9_-]{1,50}` — any other character (including the LIKE meta-characters `%` and `\`) returns 422. |
| `limit` | int | Default 200 |

**Response 200:**
```json
[
  {
    "id": "uuid",
    "title": "Strike on depot, Donetsk",
    "lat": 48.123,
    "lng": 37.456,
    "event_date": "2026-03-15",
    "is_demo": false,
    "state": "human",
    "author": {
      "id": "uuid",
      "username": "kalush",
      "is_trusted": false,
      "trust_reason": null
    },
    "tags": [
      { "name": "Ukraine", "category": "conflict" },
      { "name": "Drone", "category": "capture_source" },
      { "name": "airstrike", "category": "free" }
    ]
  }
]
```

`state` is `human` (human submits + bounty fulfilments) or `detected` (machine-produced, rendered marked). The same field flows through the profile feed, the timeline, and search hits.

---

### `GET /geolocations/points`

Compact `[id, lat, lng, event_date, submitted_date, detected]` tuples for client-side clustering — no joins, no pagination. Public (anonymous read). `event_date` and `submitted_date` (the `created_at` calendar day) are ISO `YYYY-MM-DD` strings; the map buckets them for its two timeline scrubbers and filters the date windows client-side. `detected` is `1` for a machine `detected` row (the map colours it distinctly), `0` for a human row — a flag, not the state string, to keep the no-LIMIT catalog payload small.

Results are cached in-memory for 60s per unique filter combination; the response
echoes `X-Cache: HIT|MISS` and `Cache-Control: public, max-age=30`. Rate-limited
to 60/min/IP.

**Query params:** `conflict`, `capture_source`, `tag`, `event_date_from`, `event_date_to`,
`submitted_from`, `submitted_to`, `author` (see `GET /geolocations` for semantics), plus
map-only filters `media` (repeatable — `?media=image&media=video` — matches a geolocation
carrying any attachment of a listed type; values are constrained to `image`/`video`, else
422), `trusted_only` (author `is_trusted`), and `hide_demo` (exclude demo rows). The date
params are still accepted but the map now filters dates client-side from the payload.

**Response 200:**
```json
[
  ["6c1f…uuid", 48.123, 37.456, "2024-03-11", "2024-03-12", 0],
  ["a0b2…uuid", 50.450, 30.523, "2024-05-02", "2024-05-04", 1]
]
```

---

### `GET /geolocations/possible-duplicates` 🔒

Soft-warning probe wired into the submit form. Returns geolocations that might describe the same event. **Never blocks submission** — rendered as a "did you mean…" prompt; the analyst decides.

Match rule: within ~500 m geodesic of the proposed `(lat, lng)` **AND**
(same source-URL host *or* same `event_date`). Authenticated-only so the cheap proximity
probe isn't exposed to anonymous scraping. Rate-limited to 60/min/IP.

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
    "lat": 48.123,
    "lng": 37.456,
    "event_date": "2026-05-01",
    "source_url": "https://t.me/somechannel/12345",
    "distance_m": 55.4,
    "author": {
      "id": "uuid",
      "username": "kalush",
      "is_trusted": true,
      "trust_reason": "Bellingcat affiliate"
    }
  }
]
```

---

### `POST /geolocations/import-from-tweet` 🔒

Parse a public tweet URL into a pre-fill payload for the submit form. Read-only — never creates a row; the analyst submits the form. Rate-limited to 30/min/IP.

Data source is X's public *syndication* endpoint (the same backend the embeddable `<blockquote class="twitter-tweet">` widget uses). It's unauthenticated, undocumented — the route surfaces upstream failures as `502` with a fixed error string the frontend renders verbatim ("Couldn't read tweet — fill the form manually"). Responses are cached in-memory for 1h per tweet ID to bound repeat fetches.

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

`detected` is the **machine path's** view of the same tweet — the `DetectedGeoloc`s the assemble pipeline would produce, surfaced for inspection with **zero DB writes** (no row, no media fetch). One entry per parsed coordinate; empty when none parse. It's distinct from the human pre-fill above (`parsed_coords` + `media`): `parsed_coords` is candidates for the analyst to pick, `detected` is what the machine would persist as a `detected` row if this tweet were tagged or backfilled.

Every field is best-effort. `parsed_coords` runs four extractors over `tweet_text` first, then over `quoted_tweet.tweet_text` if the OP yielded nothing (decimal pairs; decimal degrees + hemisphere letter — `33.1°N 35.5°E`, `50.4501N, 30.5234E`, `N48.0123 E37.8024`, `°` optional; DMS with hemisphere letters; `@lat,lng,zoom` in Google Maps URLs) and caps at three candidates ordered by extractor. `suggested_title` is the first usable line of the OP's text with leading hashtags, URLs, a leading list marker, and any bare coordinates stripped, truncated to 120 chars on a word boundary; a coordinate-only line is skipped and the title is never a bare coordinate; empty when nothing usable remains. `media[].remote_url` is always either `pbs.twimg.com` or `video.twimg.com` — the response filters anything else.

`source_url` resolution priority:

1. **Quoted tweet's URL** — when the OP quote-retweets, the quoted tweet is the source. `quoted_tweet` carries its metadata so the frontend can render the credit in the proof body.
2. **First non-X URL in the OP's `entities.urls`** — catches the OSINT convention of typing `Source: https://t.me/<channel>/<id>` (or a Facebook / YouTube / Mastodon link) in the body. `x.com`, `twitter.com`, and bare `t.co` shortlinks are skipped.
3. **OP's own URL** as a fallback so the form is at least filled; the analyst is expected to override when neither of the above applies.

`original_tweet_url` is always the OP's canonical URL — kept separately so the proof body can credit the analyst even when `source_url` points at the source.

`media[].origin` records where the media came from (`op` = analyst's own attachment, `quote` = quoted tweet) but does NOT drive the primary-vs-proof split. The frontend uses **media type** instead:

- `kind: "video"` → **primary** (lands in `files[]` on the submit form).
- `kind: "image"` → **proof** (uploaded to `/geolocations/proof-images` and embedded inline in the Tiptap doc).
- No video in the response → no primary media is loaded; the analyst attaches the source media manually.

The syndication endpoint doesn't expose reply-chain media, so a video the analyst posted as a self-reply on the same thread is invisible to this route.

**Errors:**
| Code | Case |
|------|------|
| 400 | Not a tweet URL (wrong host, profile / list / search path, malformed) |
| 404 | Tweet not accessible (deleted, protected, never existed) |
| 502 | Syndication endpoint timeout / 5xx / schema drift — frontend renders the "fill the form manually" banner |

---

### `GET /geolocations/import-from-tweet/media?u=<url>` 🔒

Thin proxy that fetches a single X CDN media URL and streams the bytes back.

Auth-required. The `u` host is whitelisted to `pbs.twimg.com` / `video.twimg.com` — any other host returns 400 (SSRF guard). Per-stream byte cap (~110 MB) matches the upload pipeline's video ceiling plus HTTP framing overhead.

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

### `GET /geolocations/{id}`

Full detail for a single geolocation.

**Response 200:**
```json
{
  "id": "uuid",
  "title": "Strike on depot, Donetsk",
  "lat": 48.123,
  "lng": 37.456,
  "source_url": "https://t.me/channel/12345",
  "proof": { "type": "doc", "content": [] },
  "event_date": "2026-03-15",
  "event_time": "14:30:00",
  "source_posted_at": "2026-03-14T18:05:00Z",
  "created_at": "2026-03-16T09:42:00Z",
  "updated_at": "2026-03-16T09:42:00Z",
  "is_demo": false,
  "state": "human",
  "detected_from_url": null,
  "detected_post_at": null,
  "author": {
    "id": "uuid",
    "username": "kalush"
  },
  "media": [
    {
      "id": "uuid",
      "storage_url": "https://d10w3bld05vsky.cloudfront.net/uploads/.../video.mp4",
      "media_type": "video",
      "sha256": "f7c3bcd13f00e8a4b2d4e9b3f1a2c5d6e7f8901234567890abcdef1234567890",
      "original_filename": "IMG_2034.MOV"
    },
    {
      "id": "uuid",
      "storage_url": "https://d10w3bld05vsky.cloudfront.net/uploads/.../photo.jpg",
      "media_type": "image",
      "sha256": null,
      "original_filename": null
    }
  ],
  "tags": [
    { "name": "Ukraine", "category": "conflict" }
  ]
}
```

**Errors:**
| Code | Case |
|------|------|
| 404 | Geolocation not found |

---

### `POST /geolocations` 🔒

Create a geolocation.

**Request body (`multipart/form-data`):**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Title. The fulfilling analyst's title goes on the geolocation row — the bounty's own `title` stays on the bounty row unchanged. |
| `lat` | float | yes | Latitude (-90 to 90) |
| `lng` | float | yes | Longitude (-180 to 180) |
| `source_url` | string | yes | Original source URL — ignored when `bounty_id` is set (see below) |
| `event_date` | string (YYYY-MM-DD) | yes | When the depicted event happened |
| `event_time` | string (HH:MM) | no | Optional time-of-day for the event (UTC). Omitted / empty → stored NULL. |
| `source_posted_at` | string (`YYYY-MM-DDTHH:MM`) | yes | When the source posted the media — a full instant, read as UTC. Required: a post always has a time. Distinct from `event_date` and the submission time. |
| `proof` | string (JSON) | no | Serialized Tiptap document |
| `tag_ids` | string (JSON array) | conditional | `["uuid1", "uuid2"]`. The fulfilling analyst's tag picks go on the geolocation — independent from the bounty's own tags. **Must include at least one `conflict` tag and one `capture_source` tag** (see *Required categories* below). |
| `bounty_id` | UUID | no | Fulfilment trace. See *Fulfilling a bounty* below. |
| `files` | File[] | conditional | At least one file (image or video). **Optional iff `bounty_id` is set and the bounty contributes media.** Capped at **12 files per submission**. |

**Response 201:** same shape as `GET /geolocations/{id}`.

**Required categories.** The resolved `tag_ids` must reference at least one tag of category `conflict` and at least one of category `capture_source` — the two curated, server-managed taxonomies (see [`Tags`](#tags)). The check runs against the tags' categories *before* any media upload, so a missing or free-tag-only selection 400s without paying an S3 round-trip. Both categories ship an escape value (`conflict → "Other"`, `capture_source → "Unknown"`) so the requirement is always satisfiable.

**Fulfilling a bounty.** When `bounty_id` is set, the server takes a `SELECT ... FOR UPDATE` on the bounty row and gates the insert on `status == 'open'`. The bounty's `source_url` is sourced **from the bounty row**, not the form (swapping it would let a caller fulfil with unrelated proof; the server enforces this even if the UI doesn't). `title` and `tag_ids` come from the form (the fulfilling analyst has more info); the bounty's own `title` / tags stay on the bounty row. Bad-faith refinements surface visibly on the geolocation's `originated_from_bounty` trace, so moderation sees them without needing a server-side equality check. The bounty's `Media` rows transfer in place to the new geolocation (`UPDATE media SET bounty_id=NULL, geolocation_id=:geo`) so the S3 keys keep their original `bounty_uploads/<bounty>/` prefix; any extra `files` in the form upload alongside. The bounty flips to `fulfilled` with `closed_at` stamped, and `geolocations.originated_from_bounty_id` carries the trace back. A partial unique index on `(originated_from_bounty_id) WHERE originated_from_bounty_id IS NOT NULL` is the DB-level belt to the row-lock suspenders — at most one geolocation per fulfilled bounty.

**Errors:**
| Code | Case |
|------|------|
| 400 | Validation (invalid coordinates, **file too large**, no file when none transfer, malformed `bounty_id`, **missing required `conflict` or `capture_source` tag**) |
| 404 | `bounty_id` references an unknown / soft-deleted bounty |
| 409 | `bounty_id` references a bounty that's no longer open (`fulfilled` or `closed`) |
| 413 | Request body exceeds the platform body-size cap (`max(max_video_size, 12 × max_image_size) + 10 MB` headroom). Pre-checked by the HTTP-layer middleware before any bytes touch the worker; 413 responses traverse CORS so cross-origin callers see a clean status instead of a CORS error. |
| 422 | Malformed input: `event_date` (not a YYYY-MM-DD date), `event_time` (not HH:MM), `source_posted_at` (not an ISO datetime), **more than 12 files** in the multipart batch, `title` over 255 chars, `source_url` over 2000 chars. All match the same-shape rejection on `GET /geolocations` filter params and `_parse_bbox`. |

---

### `DELETE /geolocations/{id}` 🔒

Author-only delete. Cascades media. A **hard** delete — distinct from `POST /geolocations/{id}/reject`, which soft-deletes a machine detection so a re-import can recreate it.

**Response 204:** no body.

**Errors:**
| Code | Case |
|------|------|
| 403 | Caller is not the author |
| 404 | Geolocation not found |

---

### `GET /geolocations/review-queue` 🔒

The owner review queue: the caller's machine-`detected` geolocations awaiting validation, newest first (`created_at` desc). **Scoped to `current_user`** — it ignores any URL username and never exposes another analyst's rows. Powers `/profile/{username}/review`, where the owner edits / validates / rejects each detection. Returns the **full detail** shape (media + tags), not the lightweight list card, so the queue shows the evidence and computes validation-readiness (≥1 media + a `conflict` + a `capture_source` tag) client-side without a per-row fetch.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | int | Page number (default 1) |
| `per_page` | int | Results per page (default 20, max 100) |

**Response 200:** each item is the same shape as `GET /geolocations/{id}`.
```json
{
  "items": [ { "id": "uuid", "state": "detected", "media": [], "tags": [] } ],
  "total": 12,
  "page": 1,
  "per_page": 20
}
```

A `detected` row never originates from a bounty (fulfilments are born `human`), so `originated_from_bounty` is always `null` here.

**Errors:**
| Code | Case |
|------|------|
| 401 | Not authenticated |

---

### `PATCH /geolocations/{id}` 🔒

Owner edit of a machine-`detected` geolocation — the review step. **Multipart**, mirroring `POST /geolocations`: the form posts the whole editable state and the server applies it **atomically** (field updates, media removals, and new-media uploads in one transaction). Editable **only while `detected`**; a `human` row is frozen.

**Request body (`multipart/form-data`):**
| Field | Type | Description |
|-------|------|-------------|
| `title` | string | 1–255 chars |
| `lat` | float | Latitude (-90 to 90) |
| `lng` | float | Longitude (-180 to 180) |
| `source_url` | string | ≤2000 chars — the footage origin (correct the machine's guess) |
| `event_date` | string (YYYY-MM-DD) | When the depicted event happened |
| `event_time` | string (HH:MM) | Optional time-of-day for the event (UTC); empty / omitted clears it |
| `source_posted_at` | string (`YYYY-MM-DDTHH:MM`) | When the source posted the media — a full instant (UTC). Required: a post always has a time |
| `proof` | JSON string | Tiptap document (sanitised); inline proof images upload via `POST /geolocations/proof-images` |
| `tag_ids` | JSON string (UUID[]) | Replaces the tag set wholesale |
| `remove_media_ids` | JSON string (UUID[]) | Existing source media to drop (S3 swept) |
| `files` | file[] | New source media to add (same allowlist + size limits as create) |

`detected_from_url` (the provenance anchor — the post the detection was imported from) and `state` are the only **immutable** fields: they carry no field, so a caller that sends them is ignored.

**Response 200:** same shape as `GET /geolocations/{id}`.

**Errors:**
| Code | Case |
|------|------|
| 400 | Invalid coordinates (`invalid_coordinates`), proof (`invalid_proof`), or a rejected file (`invalid_file` / `evidence_processing_failed`) |
| 403 | Caller is not the author |
| 404 | Geolocation not found (incl. soft-deleted) |
| 409 | Row is not `detected` — a `human` row is frozen (`invalid_state`) |
| 422 | Over the file-count cap (`too_many_files`) |

---

### `POST /geolocations/{id}/validate` 🔒

Owner-only. Transition a `detected` geolocation to `human`, which **freezes** the row (the edit endpoint then refuses it). Blocked until the row carries the evidence floor a human submit has at create: **at least one media** and **one `conflict` + one `capture_source` tag**. Machine detections are born tagless and exempt from the create-time tag rule, so the floor is enforced here — the owner adds the tags via `PATCH` during review.

**Response 200:** same shape as `GET /geolocations/{id}` (now `"state": "human"`).

**Errors:**
| Code | Case |
|------|------|
| 400 | Evidence floor unmet — no media (`media_required`) or missing required tag (`tag_requirements_not_met`) |
| 403 | Caller is not the author |
| 404 | Geolocation not found (incl. soft-deleted) |
| 409 | Row is not `detected` — already `human` (`invalid_state`) |

---

### `POST /geolocations/{id}/reject` 🔒

Owner-only. **Soft-delete** a `detected` geolocation (sets `deleted_at`), dropping it from every public read. Distinct from `DELETE` (hard delete): a rejected detection is recreated as a fresh `detected` row if the same tweet is later re-imported (the assemble step's `recreate` verdict matches a soft-deleted pair). A `human` row is not rejectable here — use `DELETE`.

**Response 204:** no body.

**Errors:**
| Code | Case |
|------|------|
| 403 | Caller is not the author |
| 404 | Geolocation not found (incl. soft-deleted) |
| 409 | Row is not `detected` (`invalid_state`) |

---

### `POST /geolocations/proof-images` 🔒

Upload a single inline image referenced by the proof Tiptap document. Inserts a `proof_images` row with `geolocation_id = NULL`; the row is linked to a geolocation when `POST /geolocations` runs and the URL survives sanitisation.

**Request body (`multipart/form-data`):**
| Field | Type | Description |
|-------|------|-------------|
| `file` | File | `image/jpeg`, `image/png`, or `image/webp`, up to `MAX_IMAGE_SIZE` (default 10 MB) |

**Response 201:**
```json
{
  "url": "https://d10w3bld05vsky.cloudfront.net/uploads/proof/<user-id>/<key>.jpg",
  "sha256": "f7c3bcd13f00e8a4b2d4e9b3f1a2c5d6e7f8901234567890abcdef1234567890"
}
```

`sha256` is the hex-encoded SHA-256 of the bytes that landed on S3 — useful for clients that want to verify integrity post-upload without re-downloading, and for any auditor cross-referencing later. The same hash is persisted on the `proof_images` row.

**EXIF strip.** Image uploads (`image/jpeg`, `image/png`, `image/webp`) are decoded by Pillow and re-encoded **without** EXIF / IPTC / XMP / ICC profile / GPS coordinates / camera-make-and-model / thumbnails before they touch S3. The `sha256` therefore reflects the post-strip bytes; an auditor downloading the public URL gets a file whose hash matches what we recorded. Corrupt / undecodable images, decompression bombs (>60 MP), and animated images surface as 400 before any storage write. **The same strip applies to image uploads under `POST /geolocations` and `POST /bounties` multipart bodies** — only videos pass through untouched (mp4-side metadata strip is a separate slice, not yet implemented).

**Display derivatives.** Image uploads under `POST /geolocations` and `POST /bounties` produce three S3 objects per file: the EXIF-stripped original at `<key>.<ext>`, a JPEG hero derivative at `<key_stem>_hero.jpg` (max-dim 1280, q80) for detail-page renders, and a JPEG thumbnail at `<key_stem>_thumb.jpg` (max-dim 400, q80) for map popups / index cards. The frontend resolves the right derivative URL via `frontend/src/lib/mediaUrls.ts` — the API response still carries only the original URL on the `media.storage_url` field. Inline proof-image uploads (`POST /geolocations/proof-images`) intentionally **skip** derivative production because the Tiptap renderer consumes the raw URL directly. Video uploads never produce derivatives (first-frame extraction is tracked separately).

**Rate limits:** 30/min/IP (slowapi) plus a per-user rolling-24h ceiling enforced against the DB (`MAX_PROOF_IMAGES_PER_USER_PER_DAY`).

**Errors:**
| Code | Case |
|------|------|
| 400 | MIME type not allowed, or size > limit |
| 429 | Per-user 24h ceiling reached |

---

## Bounties

A bounty is an unfinished geolocation: media + a source the poster couldn't place.

**Statuses:** `open` (default on insert), `fulfilled` (a geolocation was submitted from this bounty), `closed` (author withdrew). The "claimed" state is intentionally absent — "I'm working on this" is a parallel multi-analyst signal via `POST /bounties/{id}/claim`, not a lifecycle state.

**Trace:** the pointer from a fulfilled bounty to the resulting geolocation lives on `geolocations.originated_from_bounty_id`.

### `GET /bounties`

List bounties, newest first. Soft-deleted rows are filtered out (same invariant as `/geolocations`).

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `status` | string | One of `open`, `fulfilled`, `closed` (there is no `claimed` status — see the Bounties intro above) |
| `tag` | string | Filter by tag name |
| `author` | string | Substring match on author username. Whitelisted to `[A-Za-z0-9_-]{1,50}` — any other character (including the LIKE meta-characters `%` and `\`) returns 422. |
| `limit` | int | Default 50; must be in [1, 200] — 422 otherwise |

**Response 200:**
```json
[
  {
    "id": "uuid",
    "title": "Footage from a strike, location unknown",
    "source_url": "https://t.me/channel/12345",
    "status": "open",
    "created_at": "2026-05-12T09:42:00Z",
    "author": {
      "id": "uuid",
      "username": "kalush",
      "is_trusted": false,
      "trust_reason": null
    },
    "media": [
      {
        "id": "uuid",
        "storage_url": "https://d10w3bld05vsky.cloudfront.net/bounty_uploads/.../photo.jpg",
        "media_type": "image",
        "sha256": "f7c3bcd13f00e8a4b2d4e9b3f1a2c5d6e7f8901234567890abcdef1234567890",
        "original_filename": "screenshot.png"
      }
    ],
    "tags": [
      { "name": "Ukraine", "category": "conflict" }
    ],
    "claimer_count": 3,
    "claimer_sample": [
      { "id": "uuid", "username": "osint_analyst", "is_trusted": true, "trust_reason": "Established OSINT account" },
      { "id": "uuid", "username": "frontline_watcher", "is_trusted": false, "trust_reason": null },
      { "id": "uuid", "username": "geo_tracker", "is_trusted": false, "trust_reason": null }
    ]
  }
]
```

`claimer_sample` is capped server-side (3 newest); `claimer_count` is the total. The full claimer list is on the detail endpoint.

---

### `GET /bounties/{id}`

Full detail for one bounty.

**Response 200:**
```json
{
  "id": "uuid",
  "title": "Footage from a strike, location unknown",
  "source_url": "https://t.me/channel/12345",
  "proof": { "type": "doc", "content": [] },
  "event_date": "2026-05-10",
  "event_time": null,
  "source_posted_at": "2026-05-11T16:20:00Z",
  "status": "fulfilled",
  "created_at": "2026-05-12T09:42:00Z",
  "updated_at": "2026-05-12T09:42:00Z",
  "closed_at": "2026-05-13T11:00:00Z",
  "author": { "id": "uuid", "username": "kalush", "is_trusted": false, "trust_reason": null },
  "media": [ { "id": "uuid", "storage_url": "https://…/bounty_uploads/.../photo.jpg", "media_type": "image" } ],
  "tags": [ { "name": "Ukraine", "category": "conflict" } ],
  "claimers": [
    { "id": "uuid", "username": "osint_analyst", "is_trusted": true, "trust_reason": "Established OSINT account" },
    { "id": "uuid", "username": "frontline_watcher", "is_trusted": false, "trust_reason": null }
  ],
  "fulfilled_by": { "id": "uuid", "title": "Strike on depot, Donetsk" }
}
```

`claimers` is the full ordered (newest-first) list of analysts currently signaling. Empty when no one is working on the bounty. `fulfilled_by` is `null` until a geolocation is submitted from this bounty.

**Errors:**
| Code | Case |
|------|------|
| 404 | Bounty not found, or soft-deleted |

---

### `POST /bounties` 🔒

Post a bounty.

**Request body (`multipart/form-data`):**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Title; empty / whitespace-only rejected. Max 255 chars. |
| `source_url` | string | yes | URL where the media was found. Max 2000 chars. |
| `proof` | string (JSON) | no | In-progress proof (Tiptap document), mirroring a geolocation's `proof`; sanitised server-side and image-free (inline images dropped) |
| `event_date` | string (YYYY-MM-DD) | no | When the depicted event happened. Optional — a bounty is an unfinished geolocation. |
| `event_time` | string (HH:MM) | no | Optional time-of-day for the event (UTC). |
| `source_posted_at` | string (`YYYY-MM-DDTHH:MM`) | yes | When the source posted the media — a full instant (UTC). Required: the bounty's `source_url` is, so its post time is too. |
| `tag_ids` | string (JSON array) | no | `["uuid1", "uuid2"]` |
| `files` | File[] | yes | At least one image or video. Capped at **12 files per submission**. |

**Response 201:** same shape as `GET /bounties/{id}`, with `status: "open"`.

Multipart parsing + JSON-shape checks live in the router; business rules + the S3 upload run in `services/bounties.create_with_evidence`, which shares the file-cap, upload loop, and rollback-sweep with `POST /geolocations` via `services/evidence_intake` (no per-router duplication).

**Errors:**
| Code | Case |
|------|------|
| 400 | Plain-string validation (empty / whitespace-only `title` or `source_url`, malformed `proof` / `tag_ids` JSON) **or** a typed `{code, message}` business-rule branch: `media_required` (no files), `invalid_proof` (sanitiser rejection), `invalid_file` (disallowed MIME / size), `evidence_processing_failed`. |
| 413 | Request body exceeds the platform body-size cap — same middleware + `max(max_video_size, 12 × max_image_size) + 10 MB` headroom as `POST /geolocations`. |
| 422 | `title` over 255 chars / `source_url` over 2000 chars (Pydantic array), malformed `event_date` / `event_time` / `source_posted_at`, missing required `source_posted_at`, `event_time` without `event_date`, or **more than 12 files** (`too_many_files` typed envelope). |

---

### `DELETE /bounties/{id}` 🔒

Hard-delete by the author. Cascades drop `bounty_tags`, `bounty_claims` and `media` rows; the S3 objects are swept after the DB commit lands. The endpoint takes a `SELECT ... FOR UPDATE` on the bounty row so a concurrent `POST /geolocations bounty_id=…` fulfilment can't race the delete — whoever holds the lock commits first; the loser observes the new state and 409s.

**Response 204:** no body.

**Errors:**
| Code | Case |
|------|------|
| 403 | Caller is not the author |
| 404 | Bounty not found, or soft-deleted |
| 409 | A geolocation already traces back to this bounty (`Geolocation.originated_from_bounty_id`), including the case where a concurrent fulfilment committed first. The descendant would dangle — admin path required to walk it back. |

---

### `POST /bounties/{id}/claim` 🔒

Signal "I'm working on this." Multi-claimer, idempotent.

**Response 204:** no body.

**Errors:**
| Code | Case |
|------|------|
| 404 | Bounty not found, or soft-deleted |
| 409 | Bounty status is not `open` (already `fulfilled` or `closed`) |

---

### `DELETE /bounties/{id}/claim` 🔒

Caller leaves the working set. Idempotent.

**Response 204:** no body.

**Errors:**
| Code | Case |
|------|------|
| 404 | Bounty not found, or soft-deleted |

---

### `POST /bounties/{id}/close` 🔒

Author withdraws the bounty without anyone geolocating it. Sets `status="closed"` and stamps `closed_at`.

**Response 200:** same shape as `GET /bounties/{id}`.

**Errors:**
| Code | Case |
|------|------|
| 403 | Caller is not the author |
| 404 | Bounty not found, or soft-deleted |
| 409 | Bounty is already terminal (`fulfilled` or `closed`) |

---

## Search

Slice-1 full-text discovery surface across the three first-class entity types. Backed by three Postgres GIN indexes on `to_tsvector('simple', …)` expressions over `geolocations.title`, `bounties.title`, and `users.username || ' ' || users.bio` (migration `o1j3k5l7m9n1`). The `simple` dictionary keeps matching predictable.

**Out of scope for slice 1:** searching `source_url`, JSONB-content search (`geolocations.proof`, `bounties.proof`), per-group infinite scroll, and the filter chips beyond the entity-type pick.

### `GET /search` 🔒

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Free-text query. Empty / whitespace-only short-circuits to empty groups. |
| `type` | enum | `all` (default), `geolocation`, `bounty`, or `user`. Anything else → 422. |
| `limit` | int | Per-group cap. 1 ≤ `limit` ≤ 50, default 20. |

**Ranking:** `ts_rank` descending then `created_at` descending as a stable tie-breaker.

**Soft-delete:** every group filters `deleted_at IS NULL` at query time.

**Highlight markers:** each hit carries one or more `*_highlight` fields with STX (`U+0002`) / ETX (`U+0003`) control bytes around matched fragments. JSON encodes them as `` / ``. The frontend (`lib/search.ts::splitHighlights`) splits on those bytes and wraps the inner segments in `<mark>` — no raw HTML crosses the wire, so it's XSS-safe by construction.

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
      "state": "human",
      "author": { "id": "uuid", "username": "osint_analyst", "is_trusted": true, "trust_reason": "…" },
      "tags": [{ "id": "uuid", "name": "Ukraine", "category": "conflict" }]
    }
  ],
  "bounties": [
    {
      "id": "uuid",
      "title": "Footage from Kharkiv area, can someone place it?",
      "title_highlight": "Footage from Kharkiv area, can someone place it?",
      "source_url": "https://twitter.com/…",
      "status": "open",
      "created_at": "2026-04-12T08:00:00Z",
      "is_demo": false,
      "author": { "…": "…" },
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
  "total": { "geolocations": 1, "bounties": 1, "users": 1 },
  "query": "kharkiv",
  "type": "all"
}
```

`bio_highlight` is `null` when only the username matched — the UI uses this to hide the snippet block instead of rendering an un-highlighted bio. Groups the caller didn't request via `type=` come back as empty arrays.

**Errors:**
| Code | Case |
|------|------|
| 401 | Unauthenticated |
| 422 | `type` outside the allowed set, or `limit` outside [1, 50] |

---

## Tags

### `GET /tags`

List tags. By default returns only tags referenced by at least one **live** geolocation.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `category` | string | `conflict`, `capture_source`, or `free` |
| `curated` | bool | When `true`, return the full curated taxonomy (`conflict` + `capture_source`) **regardless of live usage**, ignoring the default usage filter. Combine with `category` to scope to one curated bucket. |

**Response 200:**
```json
[
  { "id": "uuid", "name": "Ukraine", "category": "conflict" },
  { "id": "uuid", "name": "Drone", "category": "capture_source" },
  { "id": "uuid", "name": "airstrike", "category": "free" }
]
```

---

### `POST /tags` 🔒

Create a tag. Only `free` tags are creatable; `conflict` / `capture_source` are server-managed and rejected with 403.

**Request body:**
```json
{
  "name": "drone strike",
  "category": "free"
}
```

**Validation.** `name` is stripped of leading / trailing whitespace before any check or DB write, then bounded `1 <= len(name) <= 100` (the `String(100)` column cap on `tags.name`). Empty or whitespace-only names return 422. Duplicate-name detection is **case-sensitive** to match the DB unique constraint — `Drone` and `drone` are distinct rows, so two analysts using different casing will create two tags.

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

`is_trusted` toggles via `PATCH /admin/users/{id}/trust`; `trust_reason` is required when granting. `bio` / `avatar_url` / `external_links` are self-set via `PATCH /users/me` — defaults are `null` / `null` / `{}`. `is_following` is `true` only when the caller is authenticated and follows this user; anonymous viewers and self-views always get `false`. Email is never on this shape.

**Errors:**
| Code | Case |
|------|------|
| 404 | User not found |

---

### `PATCH /users/me` 🔒

Edit your own profile — bio, avatar URL, and Linktree-style external account handles.

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

`bio` is capped at 500 characters. `avatar_url` must be `http` or `https` — `javascript:` and other schemes are rejected (XSS class blocked at write time). `external_links` is **wholesale-replaced**, not deep-merged: send the full panel each time. Per-platform values are 200 chars max; values are free-form strings (handle or URL).

**Response 200:** the updated `UserRead` (same shape as `GET /auth/me`).

**Errors:**
| Code | Case |
|------|------|
| 401 | Not authenticated |
| 422 | Validation failure (bio too long, non-http(s) URL, unknown field) |

---

### `GET /users/{username}/geolocations`

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
      "tags": [{ "name": "Ukraine", "category": "conflict" }]
    }
  ],
  "total": 42,
  "page": 1,
  "per_page": 20
}
```

---

### `POST /users/{username}/follow` 🔒

Follow another analyst. Idempotent — re-following a user you already follow returns 204 without error. Self-follow is rejected with 400.

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

**Response 200:** same `PaginatedGeolocations` shape as `GET /users/{username}/geolocations`.

**Errors:**
| Code | Case |
|------|------|
| 401 | Not authenticated |

---

## Admin

All routes below are mounted under `/admin` and gated by the `require_admin` FastAPI dependency. `require_admin` layers on top of `get_current_user`, so a deactivated admin (`is_active=false`) loses access immediately.

<details>
<summary>15 admin endpoints — rarely-touched ops surface (invites, soft/hard delete, trust toggle, demo seeding, maintenance reapers). Expand for full contracts.</summary>

### `GET /admin/me` 🛡️

**Response 200:**
```json
{ "is_admin": true }
```

Returns 403 for non-admins, 401 for anonymous callers.

### `POST /admin/invite-codes` 🛡️

Mint a new invite code. Audited via `admin_events` (`action = "invite_created"`).

**Request body:**
```json
{
  "expires_in_days": 14
}
```

`max_uses` is server-fixed at `1` and is not accepted in the request body. `expires_in_days` is optional (omit / `null` for "never expires"), max `365`.

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
  "used_at": null
}
```

`status` is one of `active | exhausted | revoked | expired`, computed at read time.

### `GET /admin/invite-codes` 🛡️

List every invite code (newest first), including exhausted / revoked / expired ones.

**Response 200:**
```json
[
  { "id": "…", "code": "…", "status": "active", "max_uses": 1, "use_count": 0, "expires_at": null, "revoked_at": null, "created_at": "…", "used_by_username": null, "used_at": null }
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
    "created_at": "…"
  }
]
```

### `DELETE /admin/users/{id}` 🛡️

Remove a user. Default is soft delete (sets `users.deleted_at` *and* cascade-soft-deletes every live geolocation **and bounty** they authored); pass `?hard=true` for GDPR-grade erasure (drops the user + cascade-drops their geolocations + bounties + sweeps S3). Both modes invalidate the points cache. Audited via `admin_events` (`action = "user_soft_deleted"` / `"user_hard_deleted"`).

**Soft delete** — the user can no longer log in (opaque 401 like wrong credentials); their public profile 404s; their author handle still renders on geolocations preserved in the audit trail. Idempotent: re-soft-deleting preserves the original timestamp.

**Hard delete** — drops the user row, cascade-drops every geolocation **and bounty** they authored (which cascade to media + proof_images + bounty_claims + bounty_tags), then sweeps the S3 objects (geolocation media + bounty media + proof images). `invite_codes.created_by` and `invite_codes.used_by` flip to NULL via `ON DELETE SET NULL` so the codes survive as audit rows even after the issuer or consumer is gone. Geolocations *fulfilling* the deleted user's bounties (potentially authored by other analysts) keep their rows — only the `originated_from_bounty_id` trace pointer flips to NULL via the FK's SET NULL. DB transaction commits before the S3 attempt so a flaky storage backend can't strand DB rows pointing at live keys.

**Response 200:**
```json
{
  "user_id": "…",
  "username": "throwaway",
  "mode": "soft",
  "deleted_at": "2026-05-09T16:45:00Z",
  "cascaded_geolocations": 3,
  "cascaded_bounties": 2,
  "media_count": 0,
  "proof_image_count": 0
}
```

For `mode = "hard"`, `deleted_at` is `null` and `media_count` / `proof_image_count` reflect what was swept from S3 (geolocation + bounty media combined under `media_count`).

**Response 404:** unknown id.

### `DELETE /admin/geolocations/{id}` 🛡️

Remove a geolocation. Default is soft delete (sets `deleted_at`); pass `?hard=true` for GDPR-grade erasure. Both modes invalidate the `/geolocations/points` cache. Audited via `admin_events` (`action = "geolocation_soft_deleted"` / `"geolocation_hard_deleted"`).

**Soft delete** (`?hard=false` or omitted) — the row, its media rows, and its S3 objects stay put. Only `deleted_at` flips, and every public read filters it out. Idempotent: re-soft-deleting preserves the original timestamp and skips the audit append.

**Hard delete** (`?hard=true`) — drops the row (cascade kills `media` and `proof_images` rows) and best-effort-deletes the corresponding S3 objects. The DB transaction commits *before* the S3 delete attempt so a flaky storage backend can't strand DB rows pointing at live keys; per-key S3 failures are logged and swallowed (orphaned objects are picked up by the proof-image reaper).

**Response 200:**
```json
{
  "geolocation_id": "…",
  "title": "Strike on depot, Donetsk",
  "mode": "soft",
  "deleted_at": "2026-05-09T16:30:00Z",
  "media_count": 0,
  "proof_image_count": 0
}
```

For `mode = "hard"`, `deleted_at` is `null` and `media_count` / `proof_image_count` reflect what was swept.

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

### `POST /admin/seed-demo-bounties` 🛡️

Generate `count` synthetic demo bounties attributed to the same fixed pool of demo authors as `POST /admin/seed-demo`. Reads templates from the shared `demo-pool/` storage prefix; if the prefix is empty or missing the expected layout, returns 422 so the admin can populate the pool before retrying. A fraction of bounties get 1–3 random demo-author claims attached. Audited as `demo_bounties_seeded`.

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
  "with_claims": 11
}
```

---

### `DELETE /admin/seed-demo-bounties` 🛡️

Drop every `is_demo=true` bounty in one bulk DELETE. Demo users and demo geolocations are NOT touched — those live behind the separate `/admin/seed-demo` panel. The `demo-pool/` S3 objects stay (shared assets). Audited as `demo_bounties_wiped`.

**Response 200:**
```json
{ "deleted_bounties": 20 }
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

Drop every `is_demo=true` geolocation + user. The `demo-pool/` S3 objects are NOT touched — they're shared assets for re-seeding. Audited as `demo_wiped`. Invalidates the points cache.

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

### `POST /admin/maintenance/reap-proof-orphans` 🛡️

Drop orphan `proof_images` rows + sweep their S3 objects. 24h grace window. Replaces the cron that previously lived in `scripts/reap_proof_image_orphans.py`. Audited as `maintenance_reap_proof_orphans`.

**Response 200:**
```json
{ "rows_deleted": 4, "s3_deleted": 4, "s3_failed": 0 }
```

Per-key S3 failures keep their DB rows so the next sweep can retry.

### `POST /admin/maintenance/reap-pending-registrations` 🛡️

Drop expired `pending_registrations` rows. Sweeps expired pending rows that the inline cleanup on `/auth/register` didn't reach. Audited as `maintenance_reap_pending_registrations`.

**Response 200:**
```json
{ "pending_registrations_deleted": 7 }
```

</details>

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

`GET /geolocations` and `GET /geolocations/points` are intentionally **unpaginated** today. A hard server-side `LIMIT` will land before public read access.

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
| Video | mp4, webm | 100 MB |
