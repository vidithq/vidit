"""The publish floor of a batch completion, projected into SQL for the queue.

A change to a floor leg in ``batch._publish_detection`` is a change here.
"""

from __future__ import annotations

from sqlalchemy import ColumnElement, and_, func

from app.models.event import Event
from app.models.media import Media

# Proof-image leg as a jsonpath: any node typed ``image`` with a string
# ``attrs.src``, the same verdict as :func:`sanitize.extract_image_srcs`.
# ``placeholder://`` srcs never persist, so no prefix test is needed. ``lax``
# mode makes a node without ``attrs`` or with a non-string ``src`` fall out
# instead of raising.
_PROOF_IMAGE_JSONPATH = '$.** ? (@.type == "image" && @.attrs.src.type() == "string")'


# Queue filter values of ``GET /events/detections`` (422 on anything else);
# ``all`` does not narrow. Sibling of ``event_filters.VIEWS``.
DETECTION_READINESS = frozenset({"all", "ready", "incomplete"})


def detection_ready_predicate() -> ColumnElement[bool]:
    """The publish floor of :func:`_publish_detection`, as one SQL predicate.

    Ready means everything the review form cannot supply is on the row:

    1. a non-blank ``source_url`` (non-NULL, has a non-space character);
    2. ``event_coords`` present;
    3. a ``source`` media row (``EXISTS``);
    4. a proof image (:data:`_PROOF_IMAGE_JSONPATH`).

    The conflict and ``capture_source`` tag legs are supplied per row by the
    review, so they are not checked here. `batchCompletionBlockers`
    (``frontend/src/lib/events.ts``) draws the same line; keep the three in
    step (``tests/events/test_detections_readiness.py``).

    Every leg is TRUE or FALSE, never NULL, so ``not_()`` is the exact complement.
    """
    return and_(
        # ``NULL AND unknown`` is FALSE, so NULL never leaks into the negation.
        # ``[^[:space:]]`` mirrors Python's ``strip()`` and the frontend's ``trim()``.
        Event.source_url.isnot(None),
        Event.source_url.regexp_match("[^[:space:]]"),
        Event.event_coords.isnot(None),
        # ``.any()`` lowers to EXISTS, so several attachments do not multiply rows.
        Event.media.any(Media.role == "source"),
        func.jsonb_path_exists(Event.proof, _PROOF_IMAGE_JSONPATH),
    )
