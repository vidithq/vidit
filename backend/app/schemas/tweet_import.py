"""Tweet-import DTOs: the request and the outcome of ``import-from-tweet``.

The paste runs the shared detection engine and writes detections, so the response
is the outcome of that run. Kept separate from the core geolocation read/write
schemas in ``event.py``: they are a self-contained sub-feature, consumed only
by the import router.
"""

import uuid

from pydantic import BaseModel, Field


class TweetImportRequest(BaseModel):
    """Body of ``POST /events/import-from-tweet``."""

    url: str = Field(..., min_length=1, max_length=2048)


class ImportNote(BaseModel):
    """One thing the import has to say, as a stable code plus its sentence.

    The sentence travels with the code so the page renders what it is given
    rather than keeping its own table: the same wording reaches the bot's
    in-thread reply and the archive's outcome email, out of one backend table
    (``tweet_ingest.WARNING_MESSAGES`` / ``REFUSAL_MESSAGES``). Branch on
    ``code``, which is the stable half; ``message`` is prose and may be reworded.
    """

    code: str
    message: str


class TweetImportRead(BaseModel):
    """What one pasted post did, in the order the engine produced it.

    One coordinate makes one detection, so a thread carrying several lands several
    ids. ``created`` holds the new detections, ``updated`` the open detections a
    re-import overwrote, and ``skipped`` the rows the import must not touch
    (published, closed, withheld) or found already up to date. The caller opens
    the first id it gets.

    ``warnings`` carries what review still has to answer on the detections of this
    post, never a refusal. Three codes say what the engine could not settle from
    the post (``several_coordinates``, ``source_ambiguous``, ``source_missing``)
    and four what the detections ended up with (``source_footage_missing``,
    ``source_fetch_failed``, ``source_date_unknown``, ``duplicate_media``); the
    fetch-failed one is the source that could not be read this time, so the same
    import later may well fill it. ``reason`` is the refusal when
    the post produced no detection at all (``coords_missing``, ``coords_invalid``),
    and null whenever detections were produced. ``failed`` counts the detections that
    raised mid-persist.
    """

    created: list[uuid.UUID]
    updated: list[uuid.UUID]
    skipped: list[uuid.UUID]
    warnings: list[ImportNote]
    reason: ImportNote | None
    failed: int
