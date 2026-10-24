"""Event lifecycle orchestration over the unified event model.

`routers/events/*` parse the forms and call the write verbs here, which own
every business rule, the S3 upload loop, the DB commit, and the post-commit S3
sweep on rollback. Verbs: :func:`create_with_evidence` (``geolocated``),
:func:`create_request` (``requested``), :func:`update_request`,
:func:`geolocate` (fulfil a request or vouch a detection), :func:`save_version`
(correct a published row, filing the superseded state), :func:`close`
(withdraw / reject / retract, any live state).

Errors are `EventError` subclasses with stable `.code` strings. Add each new
code to `_EVENT_ERROR_STATUS` in `routers/events/_common.py`.

One module per verb over shared modules. A verb module imports shared modules,
a shared module imports only other shared modules, ``errors`` imports no sibling, and
no verb module imports another.

* ``errors``, ``coordinates``, ``sources``, ``rules``: shared.
* ``readiness``: the batch publish floor as one SQL predicate.
* ``create``, ``request``, ``geolocation``, ``revision``, ``batch``,
  ``closure``: one per verb.
"""

from __future__ import annotations

from .batch import ROW_INTERNAL_ERROR_CODE, DetectionCompletion, complete_detections
from .closure import close
from .coordinates import validate_coordinates
from .create import create_with_evidence
from .errors import (
    ConflictRequiredError,
    CoordinatesRequiredError,
    EventError,
    EventNotFoundError,
    EventStateError,
    InvalidCoordinatesError,
    InvalidProofError,
    NothingChangedError,
    ProofImageRequiredError,
    SourceFileRequiredError,
    SourceLinkRequiredError,
    SourceMediaNotFoundError,
    SourceNotFoundError,
    SourceRequiredError,
    TooManySourceLinksError,
    TooManySourcesError,
)
from .geolocation import geolocate
from .readiness import DETECTION_READINESS, detection_ready_predicate
from .request import ImportProvenance, create_request, stamp_provenance, update_request
from .revision import save_version

__all__ = [
    "DETECTION_READINESS",
    "ROW_INTERNAL_ERROR_CODE",
    "ConflictRequiredError",
    "CoordinatesRequiredError",
    "DetectionCompletion",
    "EventError",
    "EventNotFoundError",
    "EventStateError",
    "ImportProvenance",
    "InvalidCoordinatesError",
    "InvalidProofError",
    "NothingChangedError",
    "ProofImageRequiredError",
    "SourceFileRequiredError",
    "SourceLinkRequiredError",
    "SourceMediaNotFoundError",
    "SourceNotFoundError",
    "SourceRequiredError",
    "TooManySourceLinksError",
    "TooManySourcesError",
    "close",
    "complete_detections",
    "create_request",
    "create_with_evidence",
    "detection_ready_predicate",
    "geolocate",
    "save_version",
    "stamp_provenance",
    "update_request",
    "validate_coordinates",
]
