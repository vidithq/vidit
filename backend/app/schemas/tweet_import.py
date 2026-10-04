"""Tweet-import DTOs: the request and the outcome of ``import-from-tweet``.

The response is the outcome of a shared-engine run; kept apart from ``event.py``
as a self-contained sub-feature used only by the import router.
"""

import uuid

from pydantic import BaseModel, Field


class TweetImportRequest(BaseModel):
    """Body of ``POST /events/import-from-tweet``."""

    url: str = Field(..., min_length=1, max_length=2048)


class ImportNote(BaseModel):
    """One thing the import has to say: a stable code plus its sentence.

    The sentence comes from one backend table
    (``tweet_ingest.WARNING_MESSAGES`` / ``REFUSAL_MESSAGES``) shared with the
    bot's reply and the archive email, so the page renders what it is given.
    Branch on ``code``; ``message`` is prose and may be reworded.
    """

    code: str
    message: str


class TweetImportRead(BaseModel):
    """What one pasted post did, in the order the engine produced it.

    One coordinate makes one detection. ``created`` holds new detections,
    ``updated`` open detections a re-import overwrote, ``skipped`` rows the
    import must not touch (published, closed, withheld) or found up to date.

    ``warnings`` is what review still has to answer, never a refusal. Three
    codes say what the engine could not settle from the post
    (``several_coordinates``, ``source_ambiguous``, ``source_missing``); four
    say what the detections ended with (``source_footage_missing``,
    ``source_fetch_failed``, ``source_date_unknown``, ``duplicate_media``;
    fetch-failed may fill on a later import). ``reason`` is the refusal when no
    detection was produced (``coords_missing``, ``coords_invalid``), else null.
    ``failed`` counts detections that raised mid-persist.
    """

    created: list[uuid.UUID]
    updated: list[uuid.UUID]
    skipped: list[uuid.UUID]
    warnings: list[ImportNote]
    reason: ImportNote | None
    failed: int
