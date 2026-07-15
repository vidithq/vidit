# Ingestion: tweet id to event

The core of every ingestion path (human paste, machine detection, archive backfill, the bot) is one brick: a tweet id plus whatever thread context is available resolves to a set of event fields. [`resolve.py`](../backend/app/services/tweet_ingest/resolve.py) implements it once; [`parse.py`](../backend/app/services/tweet_ingest/parse.py) (human pre-fill) and [`detect.py`](../backend/app/services/tweet_ingest/detect.py) (machine detection) are thin mappers over the same resolution, so the two paths cannot drift on coordinates, source, or media.

## The contract

Every derived field is either correct or empty. No field is a guess dressed as data.

A field fills only on an explicit signal in the tweet or its quote:

- **Quote**: the OP quote-tweets another post. The quoted tweet is the footage source.
- **Footage link**: the OP's text carries a link to X, Telegram, or YouTube (the OSINT convention `Source: <url>`). That link is the footage source. For X, only a status link counts (`x.com/<handle>/status/<id>`); a profile link is not footage.
- **Coordinate**: a parseable coordinate in the OP's own text, or, when the OP's text yields none, in the quoted tweet's text.

Nothing is deduced beyond these three signals:

- **No self-source.** A thread that neither quotes nor links footage has declared no source. Its own media stays proof (the analyst's annotation), never promoted to source. The thread's own permalink is provenance, not a source.
- **No cross-author thread rollup.** The archive backfill stitches a reply chain into one thread (see [Archive formats](#archive-formats) below); a third party's post is never folded into the analyst's own thread as if it were the analyst's own text.
- **No self-reference as source.** A link to the analyst's own post is a cross-reference, not footage; a single remaining third-party footage link is the source, several distinct candidates leave the source empty for review.

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
- **Photos and videos**: video capture takes the highest-bitrate mp4 variant the export saved.

## See also

- [`api.md`](api.md#post-eventsimport-from-tweet) for the `import-from-tweet` and `import-archive` request/response contracts.
- [`data-model.md`](data-model.md#events) for the `events` table columns and CHECK constraints.
