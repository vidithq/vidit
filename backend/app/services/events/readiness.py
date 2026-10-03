"""The publish floor of a batch completion, projected into SQL for the queue.

``GET /events/detections`` filters on :func:`detection_ready_predicate`, which
states in one SQL predicate the checks ``batch._publish_detection`` runs row by
row. A change to a floor leg there is a change here.
"""

from __future__ import annotations

from sqlalchemy import ColumnElement, and_, func

from app.models.event import Event
from app.models.media import Media

# The proof-image leg as a Postgres jsonpath. Recursive descent over the
# document, matching any node typed ``image`` whose ``attrs.src`` is a string:
# the same verdict :func:`sanitize.extract_image_srcs` reaches by walking the
# tree in Python, on the same inputs. Both count a ``placeholder://`` src, which
# is the intake-time convention (see ``sanitize.PROOF_PLACEHOLDER_PREFIX``) and
# never survives into a persisted doc, so no prefix test is needed on either
# side. ``lax`` mode (the default) is what makes a node without ``attrs``, or
# with a non-string ``src``, fall out instead of raising.
_PROOF_IMAGE_JSONPATH = '$.** ? (@.type == "image" && @.attrs.src.type() == "string")'


# The queue filter values ``GET /events/detections`` accepts, ``all`` being no
# narrowing at all. Sibling of ``event_filters.VIEWS``: the router validates
# against it and answers 422 on anything else.
DETECTION_READINESS = frozenset({"all", "ready", "incomplete"})


def detection_ready_predicate() -> ColumnElement[bool]:
    """The publish floor of :func:`_publish_detection`, as one SQL predicate.

    A detection is *ready* when everything the analyst cannot supply
    from the review form's two picks is already on the row, leg for leg the
    checks :func:`_publish_detection` runs before it flips the status:

    1. a non-blank ``source_url``, there a ``strip()`` test, here non-NULL and
       holding a non-space character;
    2. ``event_coords`` present;
    3. a ``source`` media row, there a scan of the loaded collection, here an
       ``EXISTS``;
    4. :func:`_require_proof_image`, here :data:`_PROOF_IMAGE_JSONPATH`.

    The two remaining floor legs (a conflict, a ``capture_source`` tag) are the
    judgment the review supplies per row, so a detection missing them is still
    ready in this sense. That is the same line ``batchCompletionBlockers``
    (``frontend/src/lib/events.ts``) draws, and the three implementations are
    held to one verdict by ``tests/events/test_detections_readiness.py``.

    Every leg is strictly TRUE or FALSE (never NULL), so ``not_()`` of this is
    the exact complement and a row lands in ready or incomplete, never neither.
    """
    return and_(
        # ``NULL AND unknown`` is FALSE in SQL, so the NULL case can't leak
        # into the negation as unknown. ``[^[:space:]]`` is the SQL spelling of
        # Python's ``not source_url.strip()`` and of the frontend's
        # ``!source_url?.trim()``: blank means no non-space character.
        Event.source_url.isnot(None),
        Event.source_url.regexp_match("[^[:space:]]"),
        Event.event_coords.isnot(None),
        # ``.any()`` lowers to EXISTS, so a detection with several attachments is
        # not row-multiplied into the count.
        Event.media.any(Media.role == "source"),
        func.jsonb_path_exists(Event.proof, _PROOF_IMAGE_JSONPATH),
    )
