"""Event lifecycle orchestration over the unified event model.

One module per verb over shared modules. A verb module imports shared modules,
a shared module imports only other shared modules, ``errors`` imports no sibling, and
no verb module imports another.

* ``errors``, ``coordinates``, ``sources``, ``rules``: shared.
* ``readiness``: the batch publish floor as one SQL predicate.
* ``create``, ``request``, ``revision``, ``batch``, ``closure``: one per verb.
"""

from __future__ import annotations

from .batch import complete_detections
from .closure import close
from .coordinates import validate_coordinates
from .create import create_with_evidence
from .errors import EventStateError, InvalidCoordinatesError
from .readiness import DetectionReadiness, detection_ready_predicate
from .request import (
    ImportProvenance,
    stamp_provenance,
    submit_request,
    update_request,
)
from .revision import save_version

__all__ = [
    "DetectionReadiness",
    "EventStateError",
    "ImportProvenance",
    "InvalidCoordinatesError",
    "close",
    "complete_detections",
    "create_with_evidence",
    "detection_ready_predicate",
    "save_version",
    "stamp_provenance",
    "submit_request",
    "update_request",
    "validate_coordinates",
]
