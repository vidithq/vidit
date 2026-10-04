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
a shared module imports at most ``errors``, ``errors`` imports no sibling, and
no verb module imports another.

* ``errors``, ``coordinates``, ``source_links``, ``rules``: shared.
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
    CoordinatesRequiredError,
    EventError,
    EventNotFoundError,
    EventStateError,
    InvalidCoordinatesError,
    InvalidProofError,
    NothingChangedError,
    ProofImageRequiredError,
    SourceUrlRequiredError,
    TagRequirementsError,
    TooManySourceLinksError,
)
from .geolocation import geolocate
from .readiness import DETECTION_READINESS, detection_ready_predicate
from .request import ImportProvenance, create_request, stamp_provenance, update_request
from .revision import save_version
from .source_links import (
    build_source_link_rows,
    normalize_secondary_source_urls,
    pair_secondary_snapshots,
    replace_source_links,
    truncate_secondary_source_urls,
)

__all__ = [
    "DETECTION_READINESS",
    "ROW_INTERNAL_ERROR_CODE",
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
    "SourceUrlRequiredError",
    "TagRequirementsError",
    "TooManySourceLinksError",
    "build_source_link_rows",
    "close",
    "complete_detections",
    "create_request",
    "create_with_evidence",
    "detection_ready_predicate",
    "geolocate",
    "normalize_secondary_source_urls",
    "pair_secondary_snapshots",
    "replace_source_links",
    "save_version",
    "stamp_provenance",
    "truncate_secondary_source_urls",
    "update_request",
    "validate_coordinates",
]
