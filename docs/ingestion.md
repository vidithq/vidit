# Ingestion: a post becomes an event

One detection engine, three entries. The bot, the pasted-tweet import and the archive backfill read the same grammar, resolve through the same core and write through the same path, so a fix on one reaches all three. This page states what the engine reads once, then what differs per entry.

- **What the engine reads** is [the contract](#the-contract) below, and the [grammar table](#grammar-table) pins it shape by shape.
- **The engine** is [`resolve_threads`](../backend/app/services/tweet_ingest/resolve.py) (threads in, one `Draft` per coordinate out, plus the warnings and the refusals, with no I/O) and [`detection.persist_drafts`](../backend/app/services/detection.py) (the one write path from a draft to a `detected` row).
- **The entries** are [the bot](#the-bot), [the pasted-tweet import](#the-pasted-tweet-import) and [the archive backfill](#archive-formats).
- **The analyst-facing projection** is the single guide at [`/import`](../frontend/src/app/import/page.tsx), which states the same rules once and then one section per entry (`#bot`, `#paste`, `#archive`). `/bot` and `/archive` redirect into it.

**Module layout.** [`tweet_ingest/`](../backend/app/services/tweet_ingest) splits along one line, whether the module fetches. `records`, `extract`, `stitch` and `resolve` derive everything and fetch nothing; `urls` is the URL vocabulary they read (what a link names, and the one place a post URL is written back from an id). On the other side, `syndication` is the X read, `chase/` holds the one chase step plus one chaser per technology behind one dispatcher, `acquire` is the live one-hop acquisition and `archive` the export reader, which is pure disk. A test states the direction: no pure module imports `syndication`, and `chase/` is imported by `acquire` alone inside the package ([`test_ingest_boundaries.py`](../backend/tests/test_ingest_boundaries.py)).

**One acquisition for the two live entries.** The pasted-tweet import and the bot both read their thread through `acquire_thread` in [`acquire.py`](../backend/app/services/tweet_ingest/acquire.py): the post named by a tweet ID, plus the post it replies to when that parent has the same author. One hop and no further, and never across authors, so a coordinate posted under someone else's footage stays that author's. Both entries therefore read the two-post field format, where the analyst posts the coordinate and replies to themselves with the source link: the coordinate comes from the parent and the source from the reply, and provenance (`detected_from_url`) anchors on the parent, whichever of the two posts the entry was pointed at. The acquisition also runs the chase (below), so the resolution downstream does no I/O. The archive backfill reads its threads from the export instead, which carries every reply edge inline, and runs the same chase step over each stitched thread (see [Archive formats](#archive-formats)).

## The contract

Every derived field is either correct or empty. No field holds a guess. A field fills only on an explicit signal in the analyst's own text.

**Retweet.** A post whose text opens with `RT @<handle>:` produces nothing. Its words belong to another account, so importing it would file a stranger's geolocation under the analyst. `extract.is_retweet` holds the rule; the archive reader also drops the entry before stitching, so a retweet never joins a thread.

**Coordinate.** A coordinate counts only in the analyst's own text: the post, its same-author parent, the archive self-thread. One that lives only in a quoted post is that author's geolocation, not the analyst's. Four extractors run over that text ([`extract.py`](../backend/app/services/tweet_ingest/extract.py)), in order:

| Form | Example |
|---|---|
| Decimal pair | `48.012345, 37.802411` |
| Decimal degrees plus hemisphere | `33.1°N 35.5°E`, `N48.0123 E37.8024` |
| DMS | `48°00'45"N 37°48'08"E` |
| Google Maps `@lat,lng` | `google.com/maps/@48.0123,37.8024,15z` |

Position does not matter: a coordinate inside a sentence reads exactly like one alone on its line. There is no candidate cap. Every coordinate found makes one draft, deduplicated on six decimal places, and a thread yielding several raises the `several_coordinates` warning. A coordinate-shaped string outside the world is dropped, and that refusal has its own name (`coords_invalid`) so an entry can say which of the two happened.

**Source.** Every link the thread carries is a candidate, whatever its host: an X status, a Telegram post, a YouTube video, a TikTok, an Instagram reel and a news article all qualify. Three exclusions, each because the link points at no footage at all:

- a status link back to the analyst's own post (a cross-reference);
- an X link naming no status, such as a profile or a search, since on X footage lives at a status and nowhere else;
- a Google Maps link, which is where the coordinate came from.

A quote outranks links: when the thread quotes a post, that post is the source and its date comes free. Otherwise the thread's **one** candidate is the source. Several candidates leave `source_url` empty, land every candidate in the [secondary source links](#secondary-source-links) and raise `source_ambiguous`. No candidate and no quote raises `source_missing`. The thread's own permalink is provenance (`detected_from_url`), never the source.

**The chase.** One chase step runs once a thread's records are built, and it spends at most one fetch on that thread: [`chase_thread`](../backend/app/services/tweet_ingest/chase/__init__.py), which the live acquisition runs over its one hop and the archive backfill over each stitched thread. The thread names the target one of two ways. A quote names it by post id, when the records do not already carry the quoted post: syndication embeds the post, and an export joins a quote of a post it also holds, so only a quote pointing outside the export is left to fetch. Failing a quote, the thread's sole source candidate names it by URL, and a chase that comes back authored by the thread's own author is a cross-reference to the analyst's own post, never footage. A thread that already carries a quote chases nothing, since a quote outranks every link.

The host of a candidate link then decides what gets *fetched*, never what gets *stored*. One module per technology answers for its own hosts, and one dispatcher asks them in turn ([`chase/`](../backend/app/services/tweet_ingest/chase)), so the caller hands over a target and places whatever comes back without naming a technology. A sole X status candidate resolves through syndication ([`chase/x.py`](../backend/app/services/tweet_ingest/chase/x.py)), which supplies the author, the post date and the media. A sole public `t.me` post resolves through its embed ([`chase/telegram.py`](../backend/app/services/tweet_ingest/chase/telegram.py)), which supplies the post date, plus the media when the embed serves it; a sensitive post serves neither. Every other candidate fills `source_url` link-only, with no date and no media. An ambiguous thread chases nothing, and every chase is fail-soft: a refusing upstream reads as "no footage", never as a failed import.

**Media split.** A quoted tweet's media is the footage, and it is the only media the source slot takes. With no quote anywhere in the thread, a chased Telegram embed's media fills the slot instead. When both leave the slot empty, the thread's **first own video** fills it, and every other own media stays `role=proof`. The promotion moves media only: `source_url` is unaffected, so a video-only draft still declares no source. Photos are never promoted, because an analyst's photo is a map crop, a screenshot, or an annotated frame. The proof document embeds images only, so a video left in the annotation slot is dropped at persistence, which is what the promotion prevents.

**Title.** The first line that is neither a coordinate alone nor a URL alone, taken verbatim, whitespace collapsed, cut at 120 characters on a word boundary. Nothing is stripped out of it: a hashtag, a mention or a coordinate inside the line stays. No line qualifying leaves the title empty, and the analyst types one at review.

**Proof.** The thread's raw text, with each link's `t.co` wrapper expanded back to the real URL so the analyst's references stay readable. Two things go: the wrappers X appends for the post's own attached media, which expand to a permalink of the post itself, and the bot's `@handle` where it opens a line, which is addressing rather than content. Nothing else, and the coordinate line stays. The analyst edits the proof at review.

### Secondary source links

`secondary_source_urls` ([`resolve_secondary_sources`](../backend/app/services/tweet_ingest/resolve.py)) holds the candidates the source slot did not take, in order, normalized and capped at the write-path ceiling (see [`api.md`](api.md#post-events)). When the source stayed empty because several candidates competed, every candidate lands here so the analyst promotes one at review.

Two links count as one when they share an identity: an X status keys on its status ID, so `x.com`, `twitter.com`, trailing-slash and query variants of one status are always one link; every other host keys on host plus path plus the query minus tracking parameters (`utm_*`, `si`, `s`, `t`, `ref*`, `feature`, `fbclid`, `gclid`, `igshid`). The query counts because a video ID usually lives in it, so `watch?v=AAA` and `watch?v=BBB` are two links while `watch?v=AAA&si=…` is one link shared twice. The candidate whose identity matches the resolved `source_url` is the primary in another spelling and is excluded.

### Warnings

The engine returns the drafts it created plus what those drafts still need from their owner. Warnings are not refusals: the draft lands either way, and review is where they are answered.

| Warning | Raised when |
|---|---|
| `source_ambiguous` | Several candidate links, so `source_url` stayed empty and all of them landed as secondary links. |
| `source_missing` | No candidate link and no quote. |
| `several_coordinates` | One thread carried several coordinates, so it produced one draft each. |

Each entry surfaces them its own way: the bot in its [reply](#the-bot), the archive backfill as counts in its [outcome email](#archive-import-worker).

Three refusals are all the engine can tell apart, and only the bot names them back: `post_unreadable` (X served no body), `coords_missing` (the analyst's own text carries no coordinate) and `coords_invalid` (a coordinate-shaped string sat outside the world).

**Coverage is text-only.** Coordinates are read from post text and nothing else. Measured on a 48.5k-tweet external OSINT corpus (853 analysts), this recovers about 86% of the geolocations at about 0% false positives. Decimal pairs dominate; DMS and hemisphere spellings make up the handled long tail. The remaining about 14% carry the coordinate only inside the image. Reading those would require running vision over every backfilled media item, which is out of scope. The analyst sees this limit stated where it bites: the import panel says so when a pasted post produces no draft.

## Grammar table

Each row is one input shape, and the three middle columns are what the bot, the pasted-tweet import and the archive backfill make of it. They read one grammar, so every row's three columns equal its target. The table is the regression reference: a change that splits an entry off the target shows up here as a cell that stops matching.

Reading the cells:

- A shape in backticks names the fixture that pins the row, under [`tests/ingest_contract/`](../backend/tests/ingest_contract/).
- The bot's refusals carry the code its failure reply names.
- The archive column reads with the chase on, which is how the import worker runs it.
- `n/a` marks a shape that cannot reach that path.
- Three behaviours apply to every row and stay out of the cells: the proof keeps the analyst's text as written, coordinate lines and label lines included; the title is the first line that is neither a coordinate alone nor a URL alone, taken verbatim and cut at 120 characters on a word boundary; a draft whose source slot stays empty, and each draft of a post carrying several coordinates, carries a warning.

| Input shape | Bot | Paste | Archive | Target |
|---|---|---|---|---|
| No coordinate anywhere (`no_coord`) | `0, coords_missing` | `0` | `0` | `0, no coordinate` |
| Coordinate inside prose, no link and no quote (`referenceless_annotation`) | 1 draft, source empty | 1 draft, source empty | 1 draft, source empty | 1 draft, source empty |
| Coordinate inside prose behind an `@mention` prefix (`mention_prefix`) | 1 draft, source empty | 1 draft, source empty | 1 draft, source empty | 1 draft, source empty |
| Coordinate alone on its line, no link and no quote | 1 draft, source empty, title empty | 1 draft, source empty, title empty | 1 draft, source empty, title empty | 1 draft, source empty, title empty |
| Two coordinates inside prose (`multi_coord`) | 2 drafts | 2 drafts | 2 drafts | 2 drafts |
| Four or more coordinates in the text | one draft per coordinate | one draft per coordinate | one draft per coordinate | one draft per coordinate |
| Hemisphere or DMS coordinate | 1 draft | 1 draft | 1 draft | 1 draft |
| Google Maps `@lat,lng` link carrying the only coordinate | 1 draft | 1 draft | 1 draft | 1 draft |
| Coordinate out of bounds and nothing else | `0, coords_invalid` | `0` | `0` | `0, coordinate out of bounds` |
| Coordinate only in the quoted post (`quote_coord_in_quoted`) | `0, coords_missing` | `0` | `0` | `0, no coordinate` |
| `T:` / `C:` / `S:` marker lines | 1 draft, the markers kept as text | 1 draft, the markers kept as text | 1 draft, the markers kept as text | 1 draft, the markers kept as text |
| `Source:` line naming one of two links | 1 draft, source empty, two mirrors | 1 draft, source empty, two mirrors | 1 draft, source empty, two mirrors | 1 draft, source empty, two mirrors |
| Two links, no `Source:` line | 1 draft, source empty, two mirrors | 1 draft, source empty, two mirrors | 1 draft, source empty, two mirrors | 1 draft, source empty, two mirrors |
| Sole link off the chase vocabulary (TikTok, Instagram, an article) | 1 draft, source is the link | 1 draft, source is the link | 1 draft, source is the link | 1 draft, source is the link |
| Sole X profile link (`x_profile_link`) | 1 draft, source empty | 1 draft, source empty | 1 draft, source empty | 1 draft, source empty |
| Sole Google Maps link | 1 draft, source empty | 1 draft, source empty | 1 draft, source empty | 1 draft, source empty |
| Sole link back to the analyst's own status | 1 draft, source empty | 1 draft, source empty | 1 draft, source empty | 1 draft, source empty |
| Quote plus one other link | 1 draft, source is the quote, one mirror | 1 draft, source is the quote, one mirror | 1 draft, source is the quote, one mirror | 1 draft, source is the quote, one mirror |
| Sole X status link (`x_status_link`) | 1 draft, source is the chased status, with its date and video | 1 draft, source is the chased status, with its date and video | 1 draft, source is the chased status, with its date and video | 1 draft, source is the chased status, with its date and video |
| Sole Telegram link (`telegram_link`) | 1 draft, source is the link, with the chased date and media | 1 draft, source is the link, with the chased date and media | 1 draft, source is the link, with the chased date and media | 1 draft, source is the link, with the chased date and media |
| Sole YouTube link (`youtube_link`) | 1 draft, source is the link | 1 draft, source is the link | 1 draft, source is the link | 1 draft, source is the link |
| Own-status link, profile link and one third-party status (`self_reference_link`) | 1 draft, source is the third-party status | 1 draft, source is the third-party status | 1 draft, source is the third-party status | 1 draft, source is the third-party status |
| Coordinate in the post, quoted post carries a photo (`quote_coord_in_op`) | 1 draft, source is the quote, its photo as source media | 1 draft, source is the quote, its photo as source media | 1 draft, source is the quote, its photo as source media | 1 draft, source is the quote, its photo as source media |
| Coordinate in the post, quoted post carries a video (`quoted_video`) | 1 draft, source is the quote, its video as source media | 1 draft, source is the quote, its video as source media | 1 draft, source is the quote, its video as source media | 1 draft, source is the quote, its video as source media |
| Own video, coordinate, no link and no quote (`self_video_no_signal`) | 1 draft, source empty, the video as source media | 1 draft, source empty, the video as source media | 1 draft, source empty, the video as source media | 1 draft, source empty, the video as source media |
| Coordinate in the post, source link in the analyst's own reply (`self_reply_geo_then_source`) | 1 draft, source is the reply's link | 1 draft, source is the reply's link | 1 draft, source is the reply's link | 1 draft, source is the reply's link |
| Self-thread, video in the head, coordinate in the reply (`self_thread`) | `n/a` | `n/a` | 1 draft, source empty, the head video as source media | 1 draft, source empty, the head video as source media |
| Parent by another author carries the coordinate | `0, coords_missing` | `0` | `n/a` | `0, no coordinate` |
| Retweet, text opening `RT @<handle>:` | `0, coords_missing` | `0` | `0`, dropped before detection | `0`, dropped |

The `self_thread` fixture ships export entries rather than syndication bodies, so the two live entries cannot be pointed at it. The same two-post shape does reach them through the one-hop acquisition, which the `self_reply_geo_then_source` row covers.

## `detected`: a partial draft by definition

A machine-produced event starts in the `detected` status. A `detected` row may lack a `source_url`, a source media item, or a location. This partial state is normal, not an error condition.

A `detected` row is **public on every read surface from the moment it lands**, badged as a machine draft and attributed to the importing account (see the `EventStatus` block in [`event.py`](../backend/app/models/event.py)). Review gates the vouching, not the visibility. The owner either completes the draft and promotes it to `geolocated`, an explicit act that puts their name behind the coordinates, or rejects it, which closes the row (`before_closed_status = 'detected'`) and takes it off the read surfaces. Reader-facing copy states it the same way: the guides say a draft is on the map straight away, marked and credited, and that only the owner turns one into a geolocation.

The source requirement applies at promotion to `geolocated`. `services/events.geolocate` rejects the transition with `source_url_required` (400) when no `source_url` is set. This matches the `ck_events_source_url_status` CHECK constraint on the `events` table: `requested` and `geolocated` rows always carry a `source_url` (see [`data-model.md`](data-model.md#events)). A human submit or edit already requires a source URL at the form level, so this invariant holds across every path that produces a `requested` or `geolocated` row.

## The bot

The bot adds a delivery and a reply on top of the engine. It reads no grammar of its own: what it makes of a post is [the contract](#the-contract) above, and the public guide at [`/import#bot`](../frontend/src/app/import/page.tsx) states the same rules for analysts.

**Delivery: webhook nominal, poll reconciliation.** Two paths feed one per-mention pipeline ([`bot.py`](../backend/app/services/bot.py) `process_single_mention`). The nominal path is the **X Account Activity webhook**. X POSTs each mention to [`/webhooks/x`](api.md#webhooks) (signature-verified, see the API contract). The endpoint reduces the mention to the internal mention shape and queues it in [`bot_webhook_events`](data-model.md#bot_webhook_events). The always-on **import worker** drains the queue between archive passes, using the same `FOR UPDATE SKIP LOCKED` claim pattern, so a tag gets answered in seconds. The **hourly poll** ([`run_bot.py`](../backend/scripts/run_bot.py)) stays as the reconciliation net. It pulls the mentions timeline newer than the last processed ID (the paid read, see [`x_api.py`](../backend/app/services/x_api.py)) and catches anything the webhook dropped.

**Pipeline, per mention.** Acquire the tagged post and its same-author parent (`acquire_tagged_thread`, the shared one hop), then run `resolve_threads` and `detection.persist_drafts`, then record the mention in the [`bot_mentions`](data-model.md#bot_mentions) ledger, whatever the outcome. The ledger is the idempotency guarantee **across both paths**: whichever path sees a mention first records it, and the other counts it as already handled. This ensures a mention is processed, billed, and answered at most once. The poll's `since_id` derives from the ledger, so a mid-pull crash resumes exactly where it stopped. A `failed` row retries only when an operator deletes it. When syndication refuses to serve the tagged post at all, because it is deleted, protected, age-restricted or withheld, the mention lands `no_detection` and the failure reply names the restriction.

**Attribution.** Detections land owned by the **existing Vidit account whose `x_handle` an admin linked**. The bot never creates new users. The nominal link binds to the invite code at mint time and copies onto the account at registration. `PATCH /admin/users/{id}/x-handle` (see [`api.md`](api.md)) is the repair and backfill path. A mention from a handle with no live account is recorded in the ledger as `no_account` and produces nothing: no user row, no draft, no reply. The tag itself is the consent for sync. Self-serve handle linking (verify-by-post) is a later gate (see `planning/next.md`). A post that quotes someone else's footage credits the tagger, while the quoted post stays recorded as `source_url`. The claim/dispute pipeline exists to handle contested attribution.

**Response model.** The in-thread reply is the only gesture the bot makes. It does not like the mention: a like would fire at worker pickup, seconds before the reply, and would signal nothing the reply does not, while costing the mention's most expensive API call. It does not retweet either; that is deliberately out. Every reply is billed, so replies are budget-capped over a trailing-hour wall-clock window, in total and per author. The budget seeds from the `bot_mentions` ledger, so the caps hold across drain passes and worker restarts. Past a cap, the draft still lands, since detection is unbilled, and only the reply is skipped and logged.

| Moment | Gesture | Condition |
|---|---|---|
| Drafts created | In-thread reply, opening ✅: the draft count, a bare event ref, one ⚠ line per warning | Always (budget permitting) |
| Nothing created | In-thread reply mirroring the success shape: the ❌ header, one ⚠ line naming the refusal, the footer; no recited lesson and no fix recipe (the guide lives behind the bio link) | Author linked AND the tagged tweet is not itself a reply to the bot (the loop guard: a courtesy answer to the bot's own reply auto-mentions it and must not earn another reply, forever) |
| Anything else | Nothing | `no_account` and every unlinked author stay fully silent |

Reply text is **linkless**: it never carries a URL or an auto-linkable domain. X bills a link-carrying post about 13 times a plain one, so the clickable link lives in the bot bio instead. Every reply is also **unique per mention**, using the success reference and a short mention tail on failures. X refuses a tweet identical to a recent one (403 duplicate content), which would otherwise block a repeated diagnosis; that specific 403 is logged without paging anyone.

The success reply carries the engine's [warnings](#warnings) first, then three of its own: no footage was stored from the source (a link-only source, a media-less or restricted source post, or a failed fetch; review is the only repair, re-tagging lands on the existing idempotency key and deduplicates), the source's post date came back unknown, and the draft's media is already known on Vidit (exact `Media.sha256` equality; perceptual near-duplicate matching is a separate feature). The last two are dropped when the source itself is empty, which already says why neither is there. The failure reply names one of the three refusals the engine can tell apart.

**CRC and the gap detector.** X re-runs the Challenge-Response Check (CRC) hourly. The endpoint answers it in-request, using pure HMAC with no database access. A failed check deactivates the webhook silently. Two nets catch that failure. `scripts/manage_x_webhook.py list` shows the webhook's `valid` flag. The poll's **gap detector** also catches it: while `X_WEBHOOK_ENABLED=true`, a mention the poll processes fresh, meaning the webhook should have delivered it, logs a warning and captures a Sentry message (`webhook gap: mention <id> arrived via reconciliation`). This way a dead webhook pages an operator instead of silently degrading into hourly latency forever. For a known outage longer than the poll covers, X's replay API can re-deliver up to 24 hours of events on request, manually, from the developer console or API.

**Webhook runbook** ([`manage_x_webhook.py`](../backend/scripts/manage_x_webhook.py) reads the same `X_*` environment variables as the bot):

```
uv run python scripts/manage_x_webhook.py register https://api.vidit.app/api/v1/webhooks/x
uv run python scripts/manage_x_webhook.py subscribe <webhook_id>   # bind the bot account
uv run python scripts/manage_x_webhook.py list                     # webhook ids + valid flag
uv run python scripts/manage_x_webhook.py status <webhook_id>      # subscription check
uv run python scripts/manage_x_webhook.py revalidate <webhook_id>  # re-run the CRC after an outage
uv run python scripts/manage_x_webhook.py delete <webhook_id>
```

Register the webhook **after** you deploy the endpoint: X fires a CRC at register time. Once `register` and `subscribe` succeed, set `X_WEBHOOK_ENABLED=true` on the backend services.

**Scheduler config.** This mirrors the [conflict sync](#conflict-referential-sync) configuration, including the [`backend/railway.scheduler.json`](../backend/railway.scheduler.json) config-as-code path. It runs as a dedicated Railway service built from the backend image, on cron schedule `0 * * * *` (hourly: the webhook owns latency, the cron only reconciles). The start command is `uv run python scripts/run_bot.py`. The environment includes `DATABASE_URL=${{backend.DATABASE_URL}}` and `JWT_SECRET=${{backend.JWT_SECRET}}` (the script imports `app.config`, whose boot check refuses to start with the placeholder secret against a non-local database), plus the six `X_*` credentials and `X_WEBHOOK_ENABLED` (see `backend/.env.example`): a bearer token and bot user ID to read, and the four OAuth 1.0a values to post. Without the OAuth values, the bot processes mentions but posts nothing. The process makes one pass, then exits. A failed mentions pull exits non-zero and is captured to Sentry when `SENTRY_DSN` is set. A missed run is harmless: the next pass resumes from the ledger. The [import worker](#archive-import-worker) service also needs the same six `X_*` values, since it is the process that posts the webhook path's replies.

## The pasted-tweet import

An analyst pastes a post URL into the submit form and `POST /events/import-from-tweet` creates the drafts the post carries, one per coordinate, owned by the analyst. The response returns the created, updated and skipped ids plus the [warnings](#warnings) review has to answer, and the browser opens the first draft. The request and response contract is [`api.md`](api.md#post-eventsimport-from-tweet).

**Own posts only.** The post's author must equal the X handle linked to the caller's account (`users.x_handle`), the bot's rule; anything else answers `not_your_post`. A third party's footage goes through the plain submit form with a `source_url`.

The entry reads the same acquisition, the same engine and the same write path as the bot, so a coordinate in a post and a source link in its author's own reply resolve together whichever of the two was pasted, and pasting the same post twice overwrites the open draft instead of duplicating it (see [re-import](#re-import)).

## Archive formats

An X "Download your data" export exposes the analyst's own reply edges and inline media, which syndication alone does not carry. The archive backfill accepts:

- **Self-threads**: reply chains stitched back together through the reply-to edges. The export contains only the analyst's own tweets, so every record the stitch draws on already shares the analyst's own authorship. The backfill searches a self-thread's combined text for a coordinate exactly as it would search a single tweet's text. The thread is ordered by `created_at`, then by tweet ID ascending. An export stores timestamps at second precision and lists tweets newest first, so when a reply is posted in the same second as its parent, the ID settles which one is the head: snowflake IDs are chronological at millisecond precision. The head anchors provenance, the title, and the event date.
- **Quotes of the analyst's own tweets**: resolved by an in-archive join, since both tweets are in the same export. No fetch, so the join runs whether or not chasing is enabled.
- **Third-party quotes and status links**: resolved by [the chase](#the-contract) over the stitched thread, when chasing is enabled for the import. With the chase off (the pure-disk read), the link is still the source, stored link-only.
- **Telegram links**: chased through the post's public embed (`t.me/<channel>/<id>?embed=1`) for the post date, and for the footage media when the embed serves it. A sensitive-content post serves neither, so it degrades to link plus date. Only public `t.me/<channel>/<id>` posts are fetched. Several candidate links leave the source ambiguous, and nothing is chased.
- **Photos and videos**: video capture takes the highest-bitrate mp4 variant the export saved.

**Retweets are excluded.** [`archive.py`](../backend/app/services/tweet_ingest/archive.py)'s `read_tweets` drops them before anything downstream sees them. A retweet carries another account's post, and importing one would file a stranger's geolocation under the analyst running the import. The `RT @<handle>:` prefix anchored at the start of the entry's text decides this (`extract.is_retweet`, the same rule the engine applies to the live entries). A post the analyst hand-typed with that same prefix is dropped along with genuine retweets, while text that mentions RT further in is kept. Thread stitching is unaffected, since a retweet is never anyone's reply parent.

## Archive import worker

**The upload goes direct to storage, never through the API.** The browser strips the export down to the allowlist, then calls `POST /events/import-archive/presign` for a staging key (`archive-imports/<user_id>/<uuid>.zip`; the owner ID in the path binds the key to the caller) plus a presigned S3 POST policy (exact key, `application/zip`, a size guard, 15-minute expiry; the dev upload endpoint stands in for it against local storage, using the same form shape). The browser POSTs the zip there itself, then enqueues it by key: the JSON `POST /events/import-archive` call HEAD-verifies the staged object and inserts an [`archive_import_jobs`](data-model.md) row, and the worker does the rest. Two things follow from this design. The archive size limit is no longer an HTTP body cap, so an analyst's zipped media can far exceed one request's worth. And with uploads off the API path, `api.vidit.app` can sit behind Cloudflare's free-plan 100 MB request cap for read-surface protection.

**Limits.** The product limits are the per-media caps applied when a draft is persisted: `MAX_IMAGE_SIZE` and `MAX_VIDEO_SIZE`. An over-cap file skips that media, but the tweet still lands. The archive-level numbers in [`archive_zip.py`](../backend/app/services/tweet_ingest/archive_zip.py) are guards, not policy. The staged zip is capped at 4 GB, enforced by the browser strip, the POST policy, the enqueue HEAD check, and again at claim time; this stays under S3's 5 GB single-part POST ceiling. The uncompressed archive is capped at 8 GB total and 200 MB per file, an anti-zip-bomb guard sized to never bind a legitimate export.

**Postgres is the queue.** [`archive_jobs.py`](../backend/app/services/archive_jobs.py) claims the oldest runnable row with `FOR UPDATE SKIP LOCKED`, which is safe under concurrent workers. It stamps the row `running`, re-checks the staged object's size (the presign window outlives the enqueue), downloads the zip, and runs the hardened extract-and-backfill attributed to the job's owner. The terminal states are `done`, with assemble counts stamped, and `failed`, with a terse `error`. Both states delete the staged object, so no live object accumulates: the bucket's versioning keeps a noncurrent copy until the lifecycle rule expires it (see [`engineering.md`](engineering.md#deployment)). Zip-shape validation happens only here. A malformed upload lands `failed` and triggers the failure email; the browser strip catches the common shapes before upload.

**Crash recovery.** A worker killed mid-job leaves its row `running`. The row becomes claimable again once `started_at` is older than the stale window (30 minutes). `started_at` also doubles as a liveness heartbeat, re-stamped every 5 minutes while the job runs. This way a legitimately long import never crosses the window while it is still alive, and a reclaim never races a still-running first run, for example two worker instances overlapping during a rolling deploy. After three attempts, the job lands `failed` as a poison-pill guard. A reclaimed, half-applied run never duplicates rows, because the matching rule below already holds every row the first pass wrote.

### Re-import

A detection is matched against the importing owner's own rows on `(detected_from_tweet_id, coordinate)`, and on `(source_url, coordinate)` when the detection declares a source. The coordinate compares to six decimal places, the same rounding the coordinate extraction dedups on.

The provenance leg is the post's ID, not its URL. One post spells the same URL several ways (`x.com` or `twitter.com`, the handle in any case, the handle-less `/i/web/status/` form), and two spellings of one post must not split one geolocation across two drafts. `detected_from_url` stays as the display value, written from the ID at the engine's exit (see [`data-model.md`](data-model.md#events)). The source URL leg collapses the delete-and-repost shape: two provenance posts declaring the same footage at the same coordinate are one draft.

What happens to a matched row depends on what the row is. [`detection._row_disposition`](../backend/app/services/detection.py) holds the matrix:

| Matched row | Outcome |
|---|---|
| Soft-deleted (`deleted_at`) | Skipped. An admin removal stands; a re-import never brings the event back. |
| Withheld (`hidden_at`) | Skipped, whatever its status. A takedown freezes the row for its owner too. |
| `geolocated` | Skipped. A machine never overwrites published work. |
| `detected` | Updated in place. |
| `closed` | Skipped. A rejected detection stays rejected, so nobody rejects the same post twice. |
| No match | A new `detected` row. |

**What an update rewrites.** The row keeps its id, its owner, its `created_at` and `detected_at` stamps, the post it was detected from (`detected_from_tweet_id` and `detected_from_url`), and its place in the review queue. The import overwrites what it owns: the title, the coordinate, the event date, `source_url`, the [secondary source links](data-model.md#event_source_links), `source_posted_at`, `detected_post_at`, the proof document, and the media. This is safe because no analyst-facing path writes those fields and leaves the row `detected`: every field edit is welded to the `geolocated` promotion, so an open draft carries no analyst work to lose. The one artifact an analyst can attach to a draft is an [archived copy](#source-archival), and those survive the update; if the update moves `source_url`, the copy filed as the source is re-filed under another link the row still carries, or dropped when the row no longer carries it.

**An unchanged post writes nothing.** Every field is compared before it is written, and media is compared by SHA-256, so re-running the same export leaves `updated_at` where it was, uploads no bytes and creates no storage objects. Such a row counts as `skipped`, not `updated`.

**Email.** The job typically finishes after the analyst has navigated away, so the worker emails the outcome. On success, the email carries the counts (created, updated, skipped, failed, each a disjoint bucket), then how many drafts carry each of the engine's [warnings](#warnings) under a "what to look at first" heading, and a link to the Detections queue. The warning counts cut across the four buckets, which is why they sit apart from them. On failure, the email carries a retry-safe failure notice. The upload page also polls `GET /events/import-archive/{job_id}` while it stays open.

**Runner.** `uv run python scripts/run_import_worker.py` polls the queue forever, with a 5-second idle sleep and one fresh session per pass. Each pass also drains the bot's [`bot_webhook_events`](data-model.md#bot_webhook_events) queue (see [The bot](#the-bot)). Set `IMPORT_WORKER_ONCE=1` to run a single drain-and-exit pass over both queues, by hand or as a cron fallback.

**Scheduler config.** This runs as an **always-on** Railway service, not a cron. It is built from the backend image (Root Directory `backend`), using the config-as-code path [`backend/railway.scheduler.json`](../backend/railway.scheduler.json). This config-as-code path is mandatory here: the worker listens on no port, so the API `railway.json`'s inherited `/health` healthcheck would fail the deploy, whereas a cron service merely replays the pre-deploy. The start command is `uv run python scripts/run_import_worker.py`, with no exposed port. The environment includes `DATABASE_URL=${{backend.DATABASE_URL}}` and `JWT_SECRET=${{backend.JWT_SECRET}}` (the boot check refuses the placeholder secret against a non-local database), plus the same storage variables (`STORAGE_BACKEND`, `S3_BUCKET`, `AWS_*`) and email variables (`EMAIL_*`, `RESEND_API_KEY`, `FRONTEND_URL`) as the backend, and `SENTRY_DSN` so a failed job pages instead of sitting in logs.

## Source archival

Source tweets get deleted and accounts get suspended, which destroys exactly the evidence the catalog preserves. An archived copy keeps a dead original readable, and the analyst who owns the event is who makes it.

**The capture happens in the analyst's browser, not on the server.** Roughly nine in ten sources here are `x.com`, which Save Page Now refuses structurally (`We're currently facing some limitations when it comes to archiving this site`), and archive.today has no API and answers a burst of server-side submissions by banning the submitting host. Both services work from a browser, which is how the OSINT community uses them. So the event page hands the analyst one prefilled submit page, `https://web.archive.org/save/<link>`, and takes back the snapshot URL the service produced. The Wayback Machine is the page it opens because Save Page Now runs from a browser and mints a replay URL that embeds the link it captured, which is what `validate_snapshot` checks a paste against; an analyst who prefers archive.today opens it themselves and pastes the snapshot into the same field, which takes all three hosts.

**Scope.** An analyst can archive the event's `source_url`, its [secondary source links](data-model.md#event_source_links) (the analyst-submitted mirrors, which carry the same link-rot risk as the primary), its `detected_from_url` (the analyst's own post a machine draft was detected from, which is the provenance of the geolocation claim), and every `http(s)` href carried by a link mark in the proof body's Tiptap document. [`source_archive.collect_links`](../backend/app/services/source_archive.py) is the one home for that walk, reading the proof body through [`sanitize.extract_link_hrefs`](../backend/app/services/sanitize.py). Each row records where its link came from in `origin` (`source_url`, `secondary_source`, `detected_from`, `proof_link`); a URL reachable from more than one is one link, kept under the first of those it appears in. Every link goes through [`sanitize.safe_link_href`](../backend/app/services/sanitize.py) (the same allowlist the proof editor writes against) plus a 2000-byte ceiling matching the `source_url` column. Analyst profile external links are out of scope, since they represent identity rather than evidence.

**One copy per link, from whichever service produced it.** [`source_archives`](data-model.md#source_archives) is unique on `(event_id, original_url)`, and the row holds one `snapshot_url` plus the `provider` that produced it. Two snapshots of one link is redundancy nobody reads back, and a resubmission by the owner overwrites the slot instead of competing with it, which is how a wrong paste is corrected. There is no queue state, no attempt counter and no per-provider slot: a row exists because a copy exists.

**The write is [`POST /events/{event_id}/archives`](api.md#post-eventsevent_idarchives), owner-only.** The body names which link the copy is of (`original_url`) and where the copy lives (`snapshot_url`). `original_url` is checked against `collect_links`, so a snapshot cannot be filed against a URL the event does not carry, and the stored `origin` comes from the same walk.

**Archival starts at the submit form, not after publication.** The source is most archivable while the analyst still has it open, so the field that takes the source URL carries the affordance beside it: one link opening `https://web.archive.org/save/<link>` prefilled with the value currently typed, and one field taking the snapshot back from any of the three accepted hosts. The paste posts with the form as `source_snapshot_url` on [`POST /events`](api.md#post-events), [`POST /events/requests`](api.md#post-eventsrequests) and [`POST /events/{id}/geolocate`](api.md#post-eventsidgeolocate) (the edit / submit transition), runs the same `validate_snapshot` checks as the standalone endpoint, and lands in the same transaction as the event, filed under origin `source_url`. A rejected paste therefore publishes nothing: the analyst fixes it and submits the same form again. The field is optional and sits in no publish floor. Mirrors, the provenance link and proof citations are archived from the event page afterwards, through the endpoint above.

**A copy always matches the source URL it is filed against.** The source URL is editable until the event is published, so an edit can leave a snapshot describing a link the event no longer declares. Every write that stores a source URL therefore reconciles the copy filed under origin `source_url`: if that copy's `original_url` is no longer the event's `source_url`, it is re-filed under the origin the URL now has (the analyst moved it to the mirrors, or cited it in the proof) or deleted when the event no longer carries the URL at all. An edit that changes the source and pastes no new snapshot thus leaves the event with **no** archived source rather than a stale one; pasting a `source_snapshot_url` with the same write fills the slot back in. The reconcile reads the links the event carries at that moment, so the mirrors are the submitted ones while the proof body is still the stored one (a write applies its new proof at commit).

**What counts as a snapshot.** `https` only, on exactly three hosts: `web.archive.org`, `archive.ph`, `archive.today`. The host is also what infers the provider. A `web.archive.org` URL must be a replay URL (`/web/<timestamp>/<original>`) whose embedded original names the same page as `original_url`; the comparison drops the scheme, the host case, a leading `www.` and a trailing slash, because Wayback stores the URL it crawled rather than the string the analyst submitted. An `archive.ph` / `archive.today` URL is a short code (`/<code>`) that embeds nothing, so only the code's shape is checked. The server deliberately does not fetch the page to verify it: fetching archive.today from a server is what gets the deployment's IP banned. The paste comes from the authenticated owner of the event, whose own catalog entry a wrong code degrades, and the host allowlist plus the code shape is what bounds the abuse. Every rejection is a 400 carrying the code for the check it failed (`snapshot_url_not_https`, `snapshot_provider_not_allowed`, `snapshot_not_a_replay_url`, `snapshot_original_mismatch`, `snapshot_not_a_snapshot_code`, `original_url_not_on_event`).

**Read surface.** `EventRead.archived_source` carries the archived copy of the event's own `source_url` as `{url, provider}`. `archived_secondary_sources` carries the same per mirror, index-aligned with `secondary_source_urls`, and `archived_detected_from` carries it for the provenance link (see [`api.md`](api.md#get-eventsid)). All three are `null` when no copy has been recorded, which is every link's starting state. The event detail surface, both the full page and the map side panel, renders each as one small icon beside the link it covers, using [`ArchivedCopies`](../frontend/src/components/ui/ArchivedCopies.tsx) as the one component for the primary source, the mirrors and the provenance link. The icon is accent-coloured and opens the copy where one exists. Where none does, it is grey: inert for a reader, and for the event's owner a disclosure that opens `https://web.archive.org/save/<link>` in a new tab and takes the snapshot back in one field, flipping the icon in place. Drafts get the affordance too, since a draft's source rots while it waits. The submit and edit forms render the same affordance as a field under the Source URL input ([`ArchiveSourceField`](../frontend/src/components/ui/ArchivedCopies.tsx), which reuses the same provider link), showing the copy an event already carries above the field that replaces it. Proof-link copies are stored but not rendered inline.


## Conflict referential sync

The conflicts an event can be tagged with are not user-created. They live in the [`conflicts`](data-model.md#conflicts) table, fed from two external sources by [`conflict_sync.py`](../backend/app/services/conflict_sync.py) and [`seed_conflicts.py`](../backend/scripts/seed_conflicts.py).

**Source.** The daily sync parses Wikipedia's "List of ongoing armed conflicts" through the MediaWiki API. It reads the top-level rows of the three top tiers (major wars, minor wars, conflicts), and excludes skirmishes as high-churn editorial noise. The page's presence boundary (a conflict is listed only if editors judge it ongoing) matches the product's `ongoing` flag exactly, so syncing the page externalizes both the list and the "is it still ongoing" judgment.

**QID identity.** Each row's article resolves to its Wikidata QID, and the sync upserts by QID, not by name. The page renames conflicts constantly: 24 of 35 month transitions over 2023-2026 changed at least one name, almost all editorial renames of the same conflict. The QID survives every rename. A rename updates `conflicts.name` in place. A same-name row without a QID is adopted. A name collision is skipped and logged.

**Tier capture.** Each row's tier table becomes `conflicts.tier`: `major`, `minor`, or `conflict`. These match the page's death-toll bands: 10,000+ combat deaths in the current or previous year, 1,000-9,999, or 100-999. A conflict that moves to another tier table gets `tier` updated on the next pass. Rows the sync has never seen keep `tier` as NULL.

**start_year fill.** The sync parses each row's start-of-conflict year from the page and writes `start_year` only where it is NULL. It never overwrites an existing value, such as the Wikidata seed's years.

**Grace period, never delete.** Disappearance from the page is ambiguous: a conflict may have ended, been renamed, or slid below a tier threshold. A row flips `ongoing=false` only after 14 consecutive days of absence (`last_seen_at`), and rows are never deleted. Rows the sync has never seen (`last_seen_at IS NULL`, such as the manual `Other` row and unseen seed rows) are never touched.

**Strict-parse abort.** If the page structure stops matching (tier tables missing) or the row count falls outside [15, 80], the sync raises an error and writes nothing, leaving the referential table as it was. The runner exits non-zero.

**The two scripts:**

- `uv run python scripts/seed_conflicts.py [--dry-run]` runs **once at setup**. It performs a Wikidata SPARQL pull of historical conflicts since 1914, about 700 to 850 rows, using a P31 type allowlist: wars, civil wars, armed conflicts, rebellions, insurgencies, and the relevant margins. It excludes battles, operations, and coup attempts. Rows with missing QIDs insert as `source='seed'`, `ongoing=false`. It never modifies existing rows, since the sync owns them. It is idempotent and safe to re-run.
- `uv run python scripts/sync_conflicts.py` runs **daily through a Railway cron service**: one pass of the Wikipedia sync described above. You can also run it by hand.

**Scheduler config.** This mirrors the [`backend-backup`](backups.md) pattern. It runs as a dedicated Railway service built from the backend image (Root Directory `backend`), using the config-as-code path [`backend/railway.scheduler.json`](../backend/railway.scheduler.json). Without that config-as-code path, Root Directory `backend` auto-discovers the API's [`railway.json`](../backend/railway.json), whose alembic pre-deploy replays before every run and whose `/health` healthcheck fails any deploy that is not the API server. The cron schedule is `0 6 * * *`, and the start command is `uv run python scripts/sync_conflicts.py`. The environment includes `DATABASE_URL=${{backend.DATABASE_URL}}` (reference `backend.DATABASE_URL`, not the DB service) and `JWT_SECRET=${{backend.JWT_SECRET}}` (the boot check refuses the placeholder secret against a non-local database). The process makes one pass and exits. A non-zero exit shows on the service's deployment view, and when `SENTRY_DSN` is set, a strict-parse abort is captured to Sentry. A missed run is harmless: the sync is idempotent, and the 14-day grace period absorbs multi-day gaps.

## See also

- [`api.md`](api.md#post-eventsimport-from-tweet) for the `import-from-tweet` and `import-archive` request/response contracts, and [`GET /conflicts`](api.md#get-conflicts) for the referential on the wire.
- [`data-model.md`](data-model.md#conflicts) for the `conflicts` / `event_conflicts` columns, [`data-model.md`](data-model.md#events) for the `events` table columns and CHECK constraints, and [`data-model.md`](data-model.md#source_archives) for the `source_archives` columns.
