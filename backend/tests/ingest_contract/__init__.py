"""Contract test framework for the tweet-ingest core.

Runs ``resolve_threads`` (and the archive backfill that persists what it reads) against a
fixed catalogue of geolocation-tweet typologies. Fixtures are fully synthetic: invented
handles, text, ids, and ``pbs.twimg.com`` / ``video.twimg.com`` shaped media URLs.

``fixtures/<typology>/body.json``
    The syndication body of the geolocation tweet (for ``self_thread``, the raw X-export
    tweet entries, since a self-thread only exists in an archive).
``fixtures/<typology>/expected.json``
    The fields the engine must produce: rounded coordinates, ``source_url`` /
    ``source_posted_at``, title, media roles by kind, ``event_date``.
``fixtures/<typology>/chased_<id>.json``
    The syndication body of the source tweet chased via an X status link, when the
    typology has one.

``loader`` turns a fixture into a ``TweetRecord`` (unit path) or raw archive entries plus
on-disk media bytes (archive path).
"""
