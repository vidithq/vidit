"""Tweet-import DTOs: the request and the outcome of ``import-from-tweet``.

The paste runs the shared detection engine and writes drafts, so the response
is the outcome of that run, not a form pre-fill. Kept separate from the core
geolocation read/write schemas in ``event.py``: they are a self-contained
sub-feature, consumed only by the import router.
"""

import uuid

from pydantic import BaseModel, Field


class TweetImportRequest(BaseModel):
    """Body of ``POST /events/import-from-tweet``."""

    url: str = Field(..., min_length=1, max_length=2048)


class TweetImportRead(BaseModel):
    """What one pasted post did, in the order the engine produced it.

    One coordinate makes one draft, so a thread carrying several lands several
    ids. ``created`` holds the new drafts, ``updated`` the open drafts a
    re-import overwrote, and ``skipped`` the rows the import must not touch
    (published, closed, withheld) or found already up to date. The caller opens
    the first id it gets.

    ``warnings`` carries the engine's warning codes for the drafts of this post
    (``several_coordinates``, ``source_ambiguous``, ``source_missing``): what
    review still has to answer, never a refusal. ``reason`` is the refusal code
    when the post produced no draft at all (``coords_missing``,
    ``coords_invalid``), and null whenever drafts were produced. ``failed``
    counts the detections that raised mid-persist.
    """

    created: list[uuid.UUID]
    updated: list[uuid.UUID]
    skipped: list[uuid.UUID]
    warnings: list[str]
    reason: str | None
    failed: int
