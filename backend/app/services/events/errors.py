"""Typed event failures, each carrying the stable ``code`` the routers map.

Leaf module of the package: the rule and verb modules raise from here and
nothing here imports back, so no pair of submodules can cycle through them.
Status mapping lives in ``routers/events/_common.py`` (``_EVENT_ERROR_STATUS``),
kept in sync when adding a code.
"""

from __future__ import annotations

from app.services.evidence_intake import EvidenceIntakeError


class EventError(EvidenceIntakeError):
    """Base for event-specific friendly errors.

    Subclass of :class:`EvidenceIntakeError` so the router catches one base
    for both shared file/media failures and the event-specific rules
    below. Carries a ``code`` the router maps to an HTTP status without
    string-matching exception text.
    """

    code: str = "event_error"


class InvalidCoordinatesError(EventError):
    """Coordinates were supplied but fall outside the valid lat / lng ranges.

    About malformed input, not absent input: a transition that needs
    coordinates the row does not carry raises
    :class:`CoordinatesRequiredError` instead. Maps to 400.
    """

    code = "invalid_coordinates"


class CoordinatesRequiredError(EventError):
    """The transition requires coordinates and the row carries none.

    A machine detection may be born without a point (the import found
    no location in the thread), so the requirement bites at the promotion, the
    same shape as :class:`SourceUrlRequiredError`. Maps to 400.
    """

    code = "coordinates_required"


class InvalidProofError(EventError):
    code = "invalid_proof"


class TagRequirementsError(EventError):
    code = "tag_requirements_not_met"


class ProofImageRequiredError(EventError):
    code = "proof_image_required"


class SourceUrlRequiredError(EventError):
    """The geolocate promotion requires a source URL.

    A machine detection may be born without one (the imported tweet
    declared no source), so the requirement bites at the transition: a
    ``geolocated`` row always carries its footage source (the same invariant
    ``ck_events_source_url_status`` pins at the DB). Maps to 400.
    """

    code = "source_url_required"


class TooManySourceLinksError(EventError):
    """More secondary source links than :data:`MAX_SECONDARY_SOURCE_LINKS`.

    Counted after normalization, so blanks and duplicates the client sent don't
    push a legitimate submission over the cap. Maps to 400.
    """

    code = "too_many_source_links"


class EventNotFoundError(EventError):
    """The targeted row is gone (hard-deleted, or soft-deleted by an admin).

    Only the batch completion raises it: the single-row paths resolve the event
    in the router, which owns their 404. In a batch it is one row's outcome, not
    the call's, so it travels as a typed per-row code and never reaches the
    envelope. The 404 it carries in ``_EVENT_ERROR_STATUS`` is defensive, there
    so a future single-row caller of the same helper gets the right status
    instead of a 500.
    """

    code = "event_not_found"


class EventStateError(EventError):
    """The event's lifecycle state forbids the requested transition.

    Raised when a geolocate targets a row that isn't ``requested`` /
    ``detected`` (a ``geolocated`` row is past that transition, ``closed`` is
    terminal), when a close targets an already ``closed`` row, or when a
    :func:`save_version` targets a row that is not ``geolocated`` (there is no version to
    supersede before publication, and a retracted row is not corrected). Maps to
    409: the request is well-formed but conflicts with the row's current state.
    """

    code = "invalid_state"


class NothingChangedError(EventError):
    """The edit would file a version carrying the state the live row carries.

    A version spends a number in a public address space and prints a row in the
    history, so an edit that moves no versioned field is refused rather than
    recorded: the record must not claim a correction that did not happen. The
    note is not a versioned field, so a note on its own does not lift this.
    Maps to 409, like the other "the row's state forbids this" verdicts.
    """

    code = "nothing_changed"
