"""The publish floor of a batch completion, projected into SQL for the queue.

A change to a floor leg in ``batch._publish_detection`` is a change here.
"""

from __future__ import annotations

from sqlalchemy import ColumnElement, and_

from app.models.event import Event
from app.models.source import EVIDENCE_LEVELS, Source

# Proof-image leg as a regex over the stored HTML, the same verdict as
# :func:`sanitize.extract_image_srcs` on a canonical body: ``<img`` there is
# always markup (text escapes ``<``), and every attribute is a `` name="value"``
# token whose value escapes ``"``, so walking the tokens finds a real ``src``
# and never one spelled inside a value. ``placeholder://`` srcs never persist,
# so no prefix test is needed.
_PROOF_IMAGE_PATTERN = r'<img(\s[a-z-]+="[^"]*")*\ssrc="'


# Queue filter values of ``GET /events/detections`` (422 on anything else);
# ``all`` does not narrow. Sibling of ``event_filters.VIEWS``.
# Mirrored by frontend lib/events.ts DetectionReadiness; change both.
DETECTION_READINESS = frozenset({"all", "ready", "incomplete"})


def detection_ready_predicate() -> ColumnElement[bool]:
    """The publish floor of :func:`_publish_detection`, as one SQL predicate.

    Ready means everything the review form cannot supply is on the row:

    1. ``coords`` present;
    2. a ``direct`` or ``indirect`` source with a file (``EXISTS``);
    3. no source without a URL;
    4. a proof image (:data:`_PROOF_IMAGE_PATTERN`).

    The conflict and sensor legs are supplied per row by the review, so they
    are not checked here. `batchCompletionBlockers`
    (``frontend/src/lib/events.ts``) draws the same line; keep the three in
    step (``tests/events/test_detections_readiness.py``).

    Every leg is TRUE or FALSE, never NULL, so ``not_()`` is the exact complement.
    """
    return and_(
        Event.coords.isnot(None),
        # ``.any()`` lowers to EXISTS, so several sources do not multiply rows.
        Event.sources.any(and_(Source.level.in_(EVIDENCE_LEVELS), Source.media.has())),
        ~Event.sources.any(~Source.links.any()),
        Event.proof.regexp_match(_PROOF_IMAGE_PATTERN),
    )
