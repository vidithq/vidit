"""Detection shapes with one expected readiness verdict each.

Shared by ``test_detections_readiness.py`` and ``test_detections.py``. The frontend
mirror of this table is ``frontend/src/lib/events.test.ts``.
"""

from __future__ import annotations

from typing import Any

from app.models.event import STATUS_DETECTED, Event
from tests.events._helpers import _make_geo

PROOF_WITH_IMAGE = '<p>Cross-referenced.</p><img src="https://cdn.example.com/proof.jpg">'

# Nested one list level down: the Python floor and the SQL pattern must both find it.
PROOF_IMAGE_NESTED = '<ul><li><p>a</p><img alt="frame" src="https://cdn/x.jpg"></li></ul>'

PROOF_TEXT_ONLY = "<p>No imagery.</p>"

# The sanitiser drops a src-less image, but a row written past it can hold one, and text
# can name the tag. The three implementations most easily disagree on these.
PROOF_IMAGE_WITHOUT_SRC = '<img alt="src=&quot;x&quot;"><p>&lt;img src="y"&gt;</p>'
# `` src="`` spelled inside another attribute's value.
PROOF_IMAGE_WITH_SRC_IN_A_VALUE = '<img alt="x src=">'

DETECTED_FROM_URL = "https://x.com/a/status/1"

# name -> (``make_detection`` overrides, ready?). ``level`` sets every source's level; the
# other keys are ``_make_geo`` overrides.
READINESS_CASES: dict[str, tuple[dict[str, Any], bool]] = {
    "ready": ({"with_media": True, "proof": PROOF_WITH_IMAGE}, True),
    "ready_with_a_nested_proof_image": (
        {"with_media": True, "proof": PROOF_IMAGE_NESTED},
        True,
    ),
    "ready_on_an_indirect_source": (
        {"with_media": True, "proof": PROOF_WITH_IMAGE, "level": "indirect"},
        True,
    ),
    "ready_beside_a_source_without_a_file": (
        {
            "with_media": True,
            "proof": PROOF_WITH_IMAGE,
            "secondary_source_urls": ["https://t.me/c/2"],
        },
        True,
    ),
    "a_source_without_a_url": (
        {"with_media": True, "proof": PROOF_WITH_IMAGE, "source_url": None},
        False,
    ),
    "no_source": (
        {"with_media": False, "proof": PROOF_WITH_IMAGE, "source_url": None},
        False,
    ),
    "no_source_file": ({"with_media": False, "proof": PROOF_WITH_IMAGE}, False),
    "only_a_context_source_has_the_file": (
        {"with_media": True, "proof": PROOF_WITH_IMAGE, "level": "context"},
        False,
    ),
    "no_coordinates": (
        {"with_media": True, "proof": PROOF_WITH_IMAGE, "lat": None, "lng": None},
        False,
    ),
    "no_proof_image": ({"with_media": True, "proof": PROOF_TEXT_ONLY}, False),
    "proof_image_without_a_src": (
        {"with_media": True, "proof": PROOF_IMAGE_WITHOUT_SRC},
        False,
    ),
    "proof_image_with_src_inside_a_value": (
        {"with_media": True, "proof": PROOF_IMAGE_WITH_SRC_IN_A_VALUE},
        False,
    ),
    "missing_everything_but_the_title": (
        {
            "with_media": False,
            "proof": PROOF_TEXT_ONLY,
            "source_url": None,
            "lat": None,
            "lng": None,
        },
        False,
    ),
}

READY_CASE_NAMES = frozenset(name for name, (_, ready) in READINESS_CASES.items() if ready)
INCOMPLETE_CASE_NAMES = frozenset(READINESS_CASES) - READY_CASE_NAMES


def make_detection(db, author, overrides: dict[str, Any]) -> Event:
    """A machine detection as the import leaves it: no sensor, no conflict."""
    kwargs = {"source_url": DETECTED_FROM_URL, "sensor": None, **overrides}
    level = kwargs.pop("level", None)
    geo = _make_geo(
        db, author=author, status=STATUS_DETECTED, detected_from_url=DETECTED_FROM_URL, **kwargs
    )
    if level is not None:
        for source in geo.sources:
            source.level = level
        db.commit()
        db.refresh(geo)
    return geo
