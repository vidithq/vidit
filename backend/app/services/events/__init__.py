"""Event lifecycle orchestration over the unified event model.

`routers/events/*` parse the multipart forms into clean Python types and
hand them to the functions here, which own every business rule, the S3 upload
loop, proof-image intake, the DB commit, and the post-commit S3 sweep on
rollback. The write verbs map one-to-one onto the lifecycle:
:func:`create_with_evidence` births a ``geolocated`` row, :func:`create_request`
a ``requested`` one, :func:`geolocate` is the one generalized transition to
``geolocated`` (fulfil a request, vouch a detection), :func:`save_version` corrects a
published row and files the superseded state as a version, and :func:`close`
is the terminal withdraw / reject / retract, available in every live state.

Errors are typed `EventError` subclasses with stable `.code`
strings, translated to HTTP via the same `{code, message}` envelope as
`RegistrationError` / `AdminError`. Status mapping lives in
`routers/events/_common.py` (`_EVENT_ERROR_STATUS`), kept in sync
when adding a code.

One module per write verb, over three shared modules the verbs read:

* ``errors``: the typed failures and their codes, a leaf every other module
  raises from.
* ``coordinates``: the bounds check plus the optional PostGIS point the forms
  build from a half-typed pair.
* ``source_links``: the secondary links, normalized, paired with their archived
  copies, written as ordered child rows.
* ``rules``: the evidence floor, the source-media swap, the tag / conflict
  resolvers, the geolocation credit, and the SQL projection of the floor the
  detections queue filters on.
* ``create``, ``geolocate``, ``revise``, ``batch``, ``close``: the write verbs,
  one module each (``revise`` holds :func:`save_version`, ``batch`` the per-row
  detection completion).

Callers import the public surface from this package; the module layout is an
internal detail.
"""

from __future__ import annotations

from .batch import ROW_INTERNAL_ERROR_CODE, DetectionCompletion, complete_detections
from .close import close
from .coordinates import validate_coordinates
from .create import create_request, create_with_evidence
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
from .geolocate import geolocate
from .revise import save_version
from .rules import DETECTION_READINESS, SourceSwap, detection_ready_predicate
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
    "InvalidCoordinatesError",
    "InvalidProofError",
    "NothingChangedError",
    "ProofImageRequiredError",
    "SourceSwap",
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
    "truncate_secondary_source_urls",
    "validate_coordinates",
]
