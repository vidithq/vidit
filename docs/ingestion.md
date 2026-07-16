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

The bot reads its own mentions: an analyst tags the bot on the tweet that carries the coordinate. That tagged tweet must itself carry or quote its source, the same two signals (quote, footage link) the rest of the pipeline recognizes. A tag on a tweet with neither produces a sourceless `detected` draft, same as any other path.

## Archive formats

An X "Download your data" export additionally exposes the analyst's own reply edges and inline media, which syndication alone does not carry. The archive backfill accepts:

- **Self-threads**: reply chains stitched back together via the reply-to edges. The export contains only the analyst's own tweets, so every record the stitch draws on already shares the analyst's own authorship; a self-thread's combined text is searched for a coordinate exactly like a single tweet's text.
- **Quotes of the analyst's own tweets**: resolved by an in-archive join (both tweets are in the same export).
- **Third-party quotes and footage links**: resolved by chasing the referenced tweet id through syndication, when chasing is enabled for the import.
- **Telegram footage links**: chased through the post's public embed (`t.me/<channel>/<id>?embed=1`) for the post date and, when the embed serves it, the footage media. A sensitive-content post serves neither, so it degrades to link + date. Only public `t.me/<channel>/<id>` posts are fetched; several distinct footage links leave the source ambiguous and nothing is chased.
- **Photos and videos**: video capture takes the highest-bitrate mp4 variant the export saved.

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

**Scheduler config.** Mirrors the [`backend-backup`](backups.md) pattern: a dedicated Railway service built from the backend image (root `Dockerfile`), cron schedule `0 6 * * *`, start command `uv run python scripts/sync_conflicts.py`, env `DATABASE_URL=${{backend.DATABASE_URL}}` (reference `backend.DATABASE_URL`, not the DB service). The process makes one pass and exits; a non-zero exit shows on the service's deployment view and, when `SENTRY_DSN` is set, a strict-parse abort is captured to Sentry. A missed run is harmless: the sync is idempotent and the 14-day grace period absorbs multi-day gaps.

## See also

- [`api.md`](api.md#post-eventsimport-from-tweet) for the `import-from-tweet` and `import-archive` request/response contracts, and [`GET /conflicts`](api.md#get-conflicts) for the referential on the wire.
- [`data-model.md`](data-model.md#conflicts) for the `conflicts` / `event_conflicts` columns, and [`data-model.md`](data-model.md#events) for the `events` table columns and CHECK constraints.
