"""Contract test framework for the tweet-ingest core.

Exercises the one brick (``resolve_thread`` / ``detect`` / the archive backfill)
against a fixed catalogue of geolocation-tweet typologies, all fixtures fully
synthetic: invented handles, invented text, invented numeric ids, and media
URLs in the ``https://pbs.twimg.com/media/FAKE....jpg`` /
``https://video.twimg.com/....mp4`` shape. No real tweet content lives here.

Layout
------

``fixtures/<typology>/body.json``
    The syndication body of the geolocation tweet (or, for ``self_thread``, the
    raw X-export tweet entries, since a self-thread only exists in an archive).
``fixtures/<typology>/expected.json``
    The fields the brick must produce for that typology: rounded coordinates,
    ``source_url`` / ``source_posted_at``, title, the media roles by kind, and
    ``event_date``.
``fixtures/<typology>/chased_<id>.json``
    Present when the typology's source is chased via syndication (an X status
    link). The syndication body of that source tweet.

``loader`` turns a fixture into a ``TweetRecord`` (unit path) or into raw
archive tweet entries + on-disk media bytes (archive path). ``test_resolve_contract``
runs the parametrized unit check; ``test_archive_contract`` runs the consolidated
archive backfill against the test database.
"""
