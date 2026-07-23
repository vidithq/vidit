# Ingestion: tweet id to event

The core of every ingestion path (human paste, machine detection, archive backfill, the bot) is one brick: a tweet id plus whatever thread context is available resolves to a set of event fields. [`resolve.py`](../backend/app/services/tweet_ingest/resolve.py) implements it once; [`parse.py`](../backend/app/services/tweet_ingest/parse.py) (human pre-fill) and [`detect.py`](../backend/app/services/tweet_ingest/detect.py) (machine detection) are thin mappers over the same resolution, so the two paths cannot drift on coordinates, source, or media.

## The contract

Every derived field is either correct or empty. No field is a guess dressed as data.

A field fills only on an explicit signal in the tweet or its quote:

- **Quote**: the OP quote-tweets another post. The quoted tweet is the footage source.
- **Footage link**: the OP's text carries a link to X, Telegram, or YouTube (the OSINT convention `Source: <url>`). That link is the footage source. For X, only a status link counts (`x.com/<handle>/status/<id>`); a profile link is not footage. A link to any other host (a coordinate link, an article, anything outside X / Telegram / YouTube) is not a footage signal and leaves the source empty.
- **Coordinate**: a parseable coordinate in the OP's own text, or, when the OP's text yields none, in the quoted tweet's text.

Nothing is deduced beyond these three signals:

- **No self-source.** A thread that neither quotes nor links footage has declared no source. Its own media stays proof (the analyst's annotation), never promoted to source. The thread's own permalink is provenance, not a source.
- **No cross-author thread rollup.** The archive backfill stitches a reply chain into one thread (see [Archive formats](#archive-formats) below); a third party's post is never folded into the analyst's own thread as if it were the analyst's own text.
- **No self-reference as source.** A link to the analyst's own post is a cross-reference, not footage; a single remaining third-party footage link is the source, several distinct candidates leave the source empty for review. This excludes links only: a deliberate quote of the analyst's own earlier post is still an explicit quote signal, so it counts as the source under the quote rule above.

When no source is declared, `source_url` and `source_posted_at` are both `NULL`, and the tweet's own media (photos, video) is stored with `role=proof`, an annotation attached to the event rather than evidence of the footage's origin.

## `detected`: a partial draft by definition

A machine-produced event is born `detected`. A `detected` row may lack a `source_url`, a source media, or a location: partial is its normal state, not an error condition.

The promotion to `geolocated` is where the source requirement bites. `services/events.geolocate` rejects the transition with `source_url_required` (400) when no `source_url` is set, matching the `ck_events_source_url_status` CHECK constraint on the `events` table (`requested` and `geolocated` rows always carry a `source_url`; see [`data-model.md`](data-model.md#events)). A human submit or edit already requires a source URL at the form level, so the same invariant holds across every path that produces a `requested` or `geolocated` row.

## Bot format

The bot reads its own mentions and accepts one strict structure (a title, one decimal coordinate pair, a source designation, the remaining lines becoming the proof) in two spellings, delivered either **inline** (the tagged tweet carries the structure) or by **relay** (the tag sits in the analyst's direct reply to their own structured tweet, the reply carrying the footage; see below).

**Bare spelling (primary).** No prefixes; the shape carries the fields (`_bare_fields` in [`detect.py`](../backend/app/services/tweet_ingest/detect.py)):

- **Coordinates**: the one line that is nothing but a decimal pair. Whole line; inside the pair the grammar is lenient (optional `+`/`-` sign and optional `°` per number, comma or whitespace between them), bounds-checked by the same `validate_coordinates` every other path runs. Zero or several such lines fail the mention.
- **Source**: the one line that is nothing but a URL token binding to a link entity (X wraps every pasted link as `t.co`; the entity correlation resolves it). A whole-line token binding to nothing (the wrapper X appends for attached media) is ignored; two bound lines fail. With no such line, the inline quote card is the designated source; failing that, a post carrying exactly one link entity anywhere designates that link. None of those either fails the mention: with several links, the source must sit alone on its line.
- **Title**: the first remaining non-empty, non-URL-only line.

The shape fails as loudly as the markers did, with one deliberate trade: the title is positional, so a post that opens with commentary titles the draft with the commentary; the owner's review pass owns that correction.

**Marker spelling.** `T:` a non-empty title, `C:` the coordinate pair alone on the line, `S:` exactly one URL token designating the source (two or more is a failure; an `S:` line with no token designates the quote card, and no quote either is a failure). Marker lines match at line starts, case-insensitively (`t:` works); a marker takes its first non-empty value, so an empty `T:` line never shadows a real one below it. **Any marker line present, even one with an empty payload, pins this spelling**: an incomplete or empty marker set fails rather than falling back to the bare shape, where the literal marker line would leak into the title (a half-marked post is a mistake to teach, not a guess to absorb).

Both spellings share the source exception: a link back to the author's own post is a cross-reference, never footage. Every non-consumed line becomes the event's proof text; the structural lines, the raw coordinate string, and the `@viditbot` tag (configurable, `X_BOT_HANDLE`) never reach the stored draft. Links on proof lines never influence source resolution and never fail the mention: their opaque `t.co` tokens are expanded back to the real URL in the stored proof (a reference link survives readable); leftover tokens with no entity (the wrapper X appends for attached media) are stripped. Media attached to the tagged tweet lands as the analyst's annotation (`role=proof`): images only, embedded in the proof document; an attached **video is dropped** (the proof document embeds no video). A tweet missing any required part produces nothing (see the failure reply below): free-text coordinate detection is **not** a fallback on the bot path; that vocabulary stays the archive backfill's and the human paste's, including the archive's chase of footage links without any `S:` marker.

**What the designated source yields** (`detect_structured` in [`detect.py`](../backend/app/services/tweet_ingest/detect.py)): an X status resolves via syndication (at most one extra free fetch per mention) to its canonical URL, its post date as `source_posted_at`, and its media as `role=source`; the quote-card case is the same signal without the extra fetch. A public `t.me` post resolves through the existing embed chase to its post date, plus the footage media when the embed serves it (a sensitive post serves date only, a valid outcome). Any other designated link (YouTube, an article, another platform) is stored as `source_url` link-only: no media fetch, no post date. The X / Telegram / YouTube vocabulary decides what the archive path treats as a footage signal and what the bot chases, never what the bot stores.

**The relay form** (`detect_relay` in [`detect.py`](../backend/app/services/tweet_ingest/detect.py)): for an `S:` link the chase vocabulary cannot fetch (TikTok, Instagram, an article), the analyst posts the marker tweet, then tags the bot in a **direct reply to it, attaching the re-uploaded footage**. One extra syndication fetch resolves the parent, which runs the same strict mapper as an inline mention; the parent must be the tagged author's own post, checked on the fetched handle, so a tag under someone else's post relays nothing. On top of that resolution: the reply's attached media becomes the source media, outranking any chased media while a chased post date is kept. The source slot stores **one** media (`role=source`), so the reply should carry the footage alone; annotation screenshots belong on the structured tweet, where they land as proof. The reply's non-marker text joins the proof as a caption; a media-less reply-tag resolves the parent exactly as if it had been tagged inline. Provenance (`detected_from_url`) anchors on the **parent**, so tagging both tweets collapses onto one idempotency key. This is the one sanctioned promotion of an analyst's own attachment into the source slot: the two-tweet structure is the explicit signal the resolution contract requires.

**One hop, no free-text rollup.** The bot fetches the tagged tweet, plus its direct parent for the relay form; a coordinate or source living anywhere else in the thread does not count, and the parent is held to the same strict markers (free text keeps failing). The archive backfill keeps its self-thread stitching unchanged (its threads are same-author by construction, see [Archive formats](#archive-formats)).

**Delivery: webhook nominal, poll reconciliation.** Two paths feed one per-mention pipeline ([`bot.py`](../backend/app/services/bot.py) `process_single_mention`). The nominal path is the **X Account Activity webhook**: X POSTs each mention to [`/webhooks/x`](api.md#webhooks) (signature-verified, see the API contract), the endpoint reduces it to the internal mention shape and queues it in [`bot_webhook_events`](data-model.md#bot_webhook_events), and the always-on **import worker** drains the queue between archive passes (same `FOR UPDATE SKIP LOCKED` claim pattern), so a tag is answered in seconds. The **hourly poll** ([`run_bot.py`](../backend/scripts/run_bot.py)) stays as the reconciliation net: it pulls the mentions timeline newer than the last processed id (the paid read, see [`x_api.py`](../backend/app/services/x_api.py)) and catches anything the webhook dropped.

**Pipeline, per mention**: fetch the tagged tweet (free syndication) → the strict mapper (`detect_structured`, falling back to the relay parent via `detect_relay`) → the shared `assemble` step → record the mention in the [`bot_mentions`](data-model.md#bot_mentions) ledger whatever the outcome. The ledger is the idempotency guarantee **across both paths**: whichever sees a mention first records it, the other counts it already handled, so a mention is processed, billed, and answered at most once; the poll's `since_id` derives from it, so a mid-pull crash resumes exactly where it stopped (a `failed` row retries only when an operator deletes it).

**Attribution.** The detections land owned by the **existing Vidit account whose `x_handle` an admin linked**; the bot never mints users. The nominal link is bound to the invite code at mint time and copied onto the account at registration; `PATCH /admin/users/{id}/x-handle` (see [`api.md`](api.md)) is the repair and backfill path. A mention from a handle no live account carries is recorded in the ledger as `no_account` and produces nothing: no user row, no draft, no reply. The tag stays the consent for sync; self-serve handle linking (verify-by-post) is a later gate (see `planning/next.md`). A deliberate consequence of the shared source vocabulary: a conforming tweet quoting someone else's footage credits the tagger while the quoted tweet stays recorded as `source_url`; contested attribution is what the claim/dispute pipeline exists for.

**Response model.** The in-thread reply is the only gesture (no like: it would fire at worker pickup, seconds before the reply, signalling nothing the reply does not, and it was the mention's most expensive call; no retweet, deliberately out). Every reply is billed, so it is budget-capped over a trailing-hour wall-clock window, in total and per author (the budget seeds from the `bot_mentions` ledger, so the caps hold across drain passes and worker restarts); past a cap the draft still lands (detection is unbilled) and only the reply is skipped, logged.

| Moment | Gesture | Condition |
|---|---|---|
| Import succeeded | In-thread reply: bare event ref + warnings | Always (budget permitting) |
| Import failed (format incomplete or invalid) | In-thread reply: a one-sentence diagnosis of what broke (missing or ambiguous coordinate line, source rule, empty marker, ...) + the three-line shape and the relay hint (the full guide lives behind the bio link) | Author linked AND the tagged tweet is not itself a reply to the bot (the loop guard: a courtesy answer to the bot's own reply auto-mentions it and must not earn another reply, forever) |
| Anything else | Nothing | `no_account` and every unlinked author stay fully silent |

Reply text is **linkless, never a URL or auto-linkable domain**: X bills a link-carrying post ~13x a plain one, so the clickable link lives in the bot bio. The success reply warns when the draft's media is already known on Vidit (exact `Media.sha256` equality; perceptual near-duplicate matching is a separate feature); a conforming draft always carries its `source_url`, so the missing-source warning belongs to other assemble callers.

**CRC and the gap detector.** X re-runs the Challenge-Response Check hourly; the endpoint answers it in-request (pure HMAC, no DB), and a failed check deactivates the webhook silently. Two nets catch that: `scripts/manage_x_webhook.py list` shows the webhook's `valid` flag, and the poll's **gap detector**: while `X_WEBHOOK_ENABLED=true`, a mention the poll processes fresh (the webhook should have delivered it) logs a warning and captures a Sentry message (`webhook gap: mention <id> arrived via reconciliation`), so a dead webhook pages instead of degrading into hourly latency forever. For a known outage longer than the poll covers, X's replay API can re-deliver up to 24 h of events on request (manual, from the developer console or API).

**Webhook runbook** ([`manage_x_webhook.py`](../backend/scripts/manage_x_webhook.py), reads the same `X_*` env as the bot):

```
uv run python scripts/manage_x_webhook.py register https://api.vidit.app/api/v1/webhooks/x
uv run python scripts/manage_x_webhook.py subscribe <webhook_id>   # bind the bot account
uv run python scripts/manage_x_webhook.py list                     # webhook ids + valid flag
uv run python scripts/manage_x_webhook.py status <webhook_id>      # subscription check
uv run python scripts/manage_x_webhook.py revalidate <webhook_id>  # re-run the CRC after an outage
uv run python scripts/manage_x_webhook.py delete <webhook_id>
```

Registration must come **after** the endpoint is deployed (X fires a CRC at register time). Once `register` + `subscribe` succeed, set `X_WEBHOOK_ENABLED=true` on the backend services.

**Scheduler config.** Mirrors the [conflict sync](#conflict-referential-sync), including the [`backend/railway.scheduler.json`](../backend/railway.scheduler.json) Config-as-code path: a dedicated Railway service built from the backend image, cron schedule `0 * * * *` (hourly: the webhook owns latency, the cron only reconciles), start command `uv run python scripts/run_bot.py`, env `DATABASE_URL=${{backend.DATABASE_URL}}` and `JWT_SECRET=${{backend.JWT_SECRET}}` (the script imports `app.config`, whose boot check refuses to start with the placeholder secret against a non-local database) plus the six `X_*` credentials and `X_WEBHOOK_ENABLED` (see `backend/.env.example`: bearer token + bot user id to read, the four OAuth 1.0a values to post; without the latter the bot processes mentions but posts nothing). One pass, then exit; a failed mentions pull exits non-zero and is captured to Sentry when `SENTRY_DSN` is set. A missed run is harmless: the next pass resumes from the ledger. The [import worker](#archive-import-worker) service needs the same six `X_*` values too: it is the process that posts the webhook path's replies.

## Archive formats

An X "Download your data" export additionally exposes the analyst's own reply edges and inline media, which syndication alone does not carry. The archive backfill accepts:

- **Self-threads**: reply chains stitched back together via the reply-to edges. The export contains only the analyst's own tweets, so every record the stitch draws on already shares the analyst's own authorship; a self-thread's combined text is searched for a coordinate exactly like a single tweet's text.
- **Quotes of the analyst's own tweets**: resolved by an in-archive join (both tweets are in the same export).
- **Third-party quotes and footage links**: resolved by chasing the referenced tweet id through syndication, when chasing is enabled for the import.
- **Telegram footage links**: chased through the post's public embed (`t.me/<channel>/<id>?embed=1`) for the post date and, when the embed serves it, the footage media. A sensitive-content post serves neither, so it degrades to link + date. Only public `t.me/<channel>/<id>` posts are fetched; several distinct footage links leave the source ambiguous and nothing is chased.
- **Photos and videos**: video capture takes the highest-bitrate mp4 variant the export saved.

## Archive import worker

**The upload goes direct to storage, never through the API.** The browser strips the export to the allowlist, calls `POST /events/import-archive/presign` for a staging key (`archive-imports/<user_id>/<uuid>.zip`, the owner id in the path is what binds the key to the caller) plus a presigned S3 POST policy (exact key, `application/zip`, size guard, 15 min expiry; the dev upload endpoint stands in for it against local storage, same form shape), POSTs the zip there itself, then enqueues by key: the JSON `POST /events/import-archive` HEAD-verifies the staged object and inserts an [`archive_import_jobs`](data-model.md) row; the worker does the rest. Two things fall out: the archive size limit is no longer an HTTP body cap (an analyst's zipped media can far exceed one request's worth), and with uploads off the API path `api.vidit.app` can be proxied behind Cloudflare's free-plan 100 MB request cap for read-surface protection.

**Limits.** The product limits are the per-media caps at assemble time (`MAX_IMAGE_SIZE` / `MAX_VIDEO_SIZE`, an over-cap file skips that media, the tweet still lands). The archive-level numbers in [`archive_zip.py`](../backend/app/services/tweet_ingest/archive_zip.py) are guards, not policy: 2 GB on the staged zip (enforced by the POST policy, the enqueue HEAD, and again at claim time), 8 GB total + 200 MB per-file uncompressed (anti-zip-bomb, sized to never bind a legitimate export).

**Postgres is the queue.** [`archive_jobs.py`](../backend/app/services/archive_jobs.py) claims the oldest runnable row with `FOR UPDATE SKIP LOCKED` (safe under concurrent workers), stamps it `running`, re-checks the staged object's size (the presign window outlives the enqueue), downloads the zip, and runs the hardened extract + backfill attributed to the job's owner. Terminal states are `done` (assemble counts stamped) and `failed` (terse `error`); both delete the staged object, so no live object accumulates (the bucket's versioning keeps a noncurrent copy until the lifecycle rule expires it, see [`engineering.md`](engineering.md#deployment)). Zip-shape validation happens only here: a malformed upload lands `failed` + the failure email (the browser strip catches the common shapes before upload).

**Crash recovery.** A worker killed mid-job leaves the row `running`; it becomes claimable again once `started_at` is older than the stale window (30 min). `started_at` doubles as a liveness heartbeat, re-stamped every 5 min while the job runs, so a legitimately long import never crosses the window while alive and a reclaim never races a still-running first run (e.g. two worker instances overlapping during a rolling deploy). Three attempts, then the job lands `failed` (poison-pill guard). The backfill is idempotent on `(detected_from_url, coordinate)`, so a reclaimed half-applied run never duplicates rows.

**Email.** The job finishes after the analyst has typically navigated away, so the worker emails the outcome: the counts and a link to the Detections queue on success, a retry-safe failure notice otherwise. The upload page also polls `GET /events/import-archive/{job_id}` while it stays open.

**Runner.** `uv run python scripts/run_import_worker.py` polls the queue forever (5 s idle sleep), one fresh session per pass; each pass also drains the bot's [`bot_webhook_events`](data-model.md#bot_webhook_events) queue (see [Bot format](#bot-format)). `IMPORT_WORKER_ONCE=1` makes a single drain-and-exit pass (by hand, or a cron fallback).

**Scheduler config.** An **always-on** Railway service (not a cron): built from the backend image (Root Directory `backend`), Config-as-code path [`backend/railway.scheduler.json`](../backend/railway.scheduler.json) (mandatory here: the worker listens on no port, so the API `railway.json`'s inherited `/health` healthcheck fails the deploy, where a cron service merely replays the pre-deploy), start command `uv run python scripts/run_import_worker.py`, no exposed port, env `DATABASE_URL=${{backend.DATABASE_URL}}` and `JWT_SECRET=${{backend.JWT_SECRET}}` (the boot check refuses the placeholder secret against a non-local database) plus the same storage (`STORAGE_BACKEND`, `S3_BUCKET`, `AWS_*`) and email (`EMAIL_*`, `RESEND_API_KEY`, `FRONTEND_URL`) variables as the backend, and `SENTRY_DSN` so a failed job pages instead of sitting in logs.

## Conflict referential sync

The conflicts an event can be tagged with are not user-created: they live in the [`conflicts`](data-model.md#conflicts) table, fed from two external sources by [`conflict_sync.py`](../backend/app/services/conflict_sync.py) and [`seed_conflicts.py`](../backend/scripts/seed_conflicts.py).

**Source.** The daily sync parses Wikipedia's "List of ongoing armed conflicts" via the MediaWiki API: the top-level rows of the three top tiers (major wars, minor wars, conflicts), skirmishes excluded as high-churn editorial noise. The page's presence boundary (a conflict is listed iff editors judge it ongoing) is exactly the product's `ongoing` flag, so syncing it externalises both the list and the "is it still ongoing" judgement.

**QID identity.** Each row's article resolves to its Wikidata QID, and the sync upserts by QID, not by name: the page renames conflicts constantly (24 of 35 month transitions over 2023-2026 changed at least one name, almost all editorial renames of the same conflict), and the QID survives every rename. A rename updates `conflicts.name` in place; a same-name row without a QID is adopted; a name collision is skipped and logged.

**Tier capture.** Each row's tier table becomes `conflicts.tier` (`major`, `minor`, or `conflict`: the page's death-toll bands, 10,000+ combat deaths in the current or previous year, 1,000-9,999, 100-999). A conflict that moves to another tier table gets `tier` updated on the next pass; rows the sync has never seen keep `tier` NULL.

**start_year fill.** The sync parses each row's start-of-conflict year from the page and writes `start_year` only where it is NULL; an existing value (the Wikidata seed's years) is never overwritten.

**Grace period, never delete.** Disappearance from the page is ambiguous (ended, renamed, or slid below a tier threshold), so a row flips `ongoing=false` only after 14 consecutive days of absence (`last_seen_at`), and rows are never deleted. Rows the sync has never seen (`last_seen_at IS NULL`: the manual `Other`, unseen seed rows) are never touched.

**Strict-parse abort.** If the page structure stops matching (tier tables missing) or the row count falls outside [15, 80], the sync raises and writes nothing, leaving the referential as it was; the runner exits non-zero.

**The two scripts:**

- `uv run python scripts/seed_conflicts.py [--dry-run]` runs **once at setup**: a Wikidata SPARQL pull of historical conflicts since 1914 (~700-850 rows, a P31 type allowlist: wars, civil wars, armed conflicts, rebellions, insurgencies and the relevant margins; battles / operations / coup attempts excluded). Missing QIDs insert as `source='seed'`, `ongoing=false`; existing rows are never modified (the sync owns them). Idempotent, safe to re-run.
- `uv run python scripts/sync_conflicts.py` runs **daily via a Railway cron service**: one pass of the Wikipedia sync described above. Also runnable by hand.

**Scheduler config.** Mirrors the [`backend-backup`](backups.md) pattern: a dedicated Railway service built from the backend image (Root Directory `backend`), Config-as-code path [`backend/railway.scheduler.json`](../backend/railway.scheduler.json) (without it, Root Directory `backend` auto-discovers the API's [`railway.json`](../backend/railway.json), whose alembic pre-deploy replays before every run and whose `/health` healthcheck fails any deploy that is not the API server), cron schedule `0 6 * * *`, start command `uv run python scripts/sync_conflicts.py`, env `DATABASE_URL=${{backend.DATABASE_URL}}` (reference `backend.DATABASE_URL`, not the DB service) and `JWT_SECRET=${{backend.JWT_SECRET}}` (the boot check refuses the placeholder secret against a non-local database). The process makes one pass and exits; a non-zero exit shows on the service's deployment view and, when `SENTRY_DSN` is set, a strict-parse abort is captured to Sentry. A missed run is harmless: the sync is idempotent and the 14-day grace period absorbs multi-day gaps.

## See also

- [`api.md`](api.md#post-eventsimport-from-tweet) for the `import-from-tweet` and `import-archive` request/response contracts, and [`GET /conflicts`](api.md#get-conflicts) for the referential on the wire.
- [`data-model.md`](data-model.md#conflicts) for the `conflicts` / `event_conflicts` columns, and [`data-model.md`](data-model.md#events) for the `events` table columns and CHECK constraints.
