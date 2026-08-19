"""The mixed detection set the detections-queue readiness suites share.

One table of shapes, one expected verdict each, used by the SQL-vs-floor
agreement test (``test_detections_readiness.py``) and by the endpoint suite
(``test_detections.py``), so the filter and the queue can never be measured
against two different notions of "ready". The frontend mirror of the same
table lives in ``frontend/src/lib/events.test.ts``.
"""

from __future__ import annotations

from typing import Any

PROOF_WITH_IMAGE: dict[str, Any] = {
    "type": "doc",
    "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Cross-referenced."}]},
        {"type": "image", "attrs": {"src": "https://cdn.example.com/proof.jpg"}},
    ],
}

# An image nested two levels down: the Python floor walks ``content`` to any
# depth, and the SQL leg is a recursive descent, so both must find it.
PROOF_IMAGE_NESTED: dict[str, Any] = {
    "type": "doc",
    "content": [
        {
            "type": "bulletList",
            "content": [
                {
                    "type": "listItem",
                    "content": [{"type": "image", "attrs": {"src": "https://cdn/x.jpg"}}],
                }
            ],
        }
    ],
}

PROOF_TEXT_ONLY: dict[str, Any] = {
    "type": "doc",
    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "No imagery."}]}],
}

# An image node carrying no ``src``. The sanitiser lets one through (it only
# drops an image whose ``src`` is *unsafe*), so a persisted doc can hold it,
# and it is the shape the three implementations most easily disagree on: a
# node-type-only test calls it an image, a src-carrying test does not.
PROOF_IMAGE_WITHOUT_SRC: dict[str, Any] = {
    "type": "doc",
    "content": [{"type": "image"}],
}

# name -> (``_make_geo`` overrides on top of a plain detection, ready?)
READINESS_CASES: dict[str, tuple[dict[str, Any], bool]] = {
    "ready": ({"with_media": True, "proof": PROOF_WITH_IMAGE}, True),
    "ready_with_a_nested_proof_image": (
        {"with_media": True, "proof": PROOF_IMAGE_NESTED},
        True,
    ),
    "no_source_url": (
        {"with_media": True, "proof": PROOF_WITH_IMAGE, "source_url": None},
        False,
    ),
    "blank_source_url": (
        {"with_media": True, "proof": PROOF_WITH_IMAGE, "source_url": " \t\n "},
        False,
    ),
    "no_coordinates": (
        {"with_media": True, "proof": PROOF_WITH_IMAGE, "lat": None, "lng": None},
        False,
    ),
    "no_source_media": ({"with_media": False, "proof": PROOF_WITH_IMAGE}, False),
    "no_proof_image": ({"with_media": True, "proof": PROOF_TEXT_ONLY}, False),
    "proof_image_without_a_src": (
        {"with_media": True, "proof": PROOF_IMAGE_WITHOUT_SRC},
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
