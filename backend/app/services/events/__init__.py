"""Event lifecycle orchestration over the unified event model.

`routers/events/*` parse the multipart forms into clean Python types and
hand them to the functions here, which own every business rule, the S3 upload
loop, proof-image intake, the DB commit, and the post-commit S3 sweep on
rollback. The write verbs map one-to-one onto the lifecycle:
:func:`create_with_evidence` births a ``geolocated`` row, :func:`create_request`
a ``requested`` one, :func:`update_request` corrects an open request in place,
:func:`geolocate` is the one generalized transition to
``geolocated`` (fulfil a request, vouch a detection), :func:`save_version` corrects a
published row and files the superseded state as a version, and :func:`close`
is the terminal withdraw / reject / retract, available in every live state.

Errors are typed `EventError` subclasses with stable `.code`
strings, translated to HTTP via the same `{code, message}` envelope as
`RegistrationError` / `AdminError`. Status mapping lives in
`routers/events/_common.py` (`_EVENT_ERROR_STATUS`), kept in sync
when adding a code.

One module per write verb, over five shared modules. Dependencies run one way:
a verb module imports shared modules, a shared module imports at most
``errors``, ``errors`` imports no sibling module, and no verb module imports
another.

* ``errors``: the typed failures and their codes, a leaf module.
* ``coordinates``: the bounds check and the optional point a form pair builds.
* ``source_links``: the secondary links, normalized, paired with their archived
  copies, and written as ordered rows.
* ``rules``: the evidence floor, the proof sanitiser wrapper, the source-media
  swap, the tag and conflict resolvers, and the geolocation credit.
* ``readiness``: the batch publish floor as one SQL predicate, for the
  detections queue.
* ``create``: :func:`create_with_evidence`.
* ``request``: :func:`create_request`, :func:`update_request`, and the import
  provenance a machine-opened request carries.
* ``geolocation``: :func:`geolocate`.
* ``revision``: :func:`save_version`.
* ``batch``: :func:`complete_detections` and its per-row promotion.
* ``closure``: :func:`close`.

Callers import from this package, which re-exports the public surface below.
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
