"""Leaf module: imports no sibling. The form sentence of each source code is mirrored by ``frontend/src/lib/sources.ts::SOURCE_ERROR_MESSAGES``; change both."""

from __future__ import annotations

from app.services.evidence_intake import EvidenceIntakeError


class EventError(EvidenceIntakeError):
    code: str = "event_error"


class InvalidCoordinatesError(EventError):
    code = "invalid_coordinates"


class CoordinatesRequiredError(EventError):
    """The transition requires coordinates and the row has none (a detection may
    be born without a point)."""

    code = "coordinates_required"


class InvalidProofError(EventError):
    code = "invalid_proof"


class ConflictRequiredError(EventError):
    code = "conflict_required"


class ProofImageRequiredError(EventError):
    code = "proof_image_required"


class SourceRequiredError(EventError):
    """The event holds no ``direct`` or ``indirect`` source; ``context`` sources alone do not
    support it."""

    code = "source_required"


class SourceFileRequiredError(EventError):
    code = "source_file_required"


class SourceLinkRequiredError(EventError):
    code = "source_link_required"


class InvalidSourceUrlError(EventError):
    """A source URL is not an ``http(s)`` link with a host."""

    code = "invalid_source_url"


class TooManySourcesError(EventError):
    code = "too_many_sources"


class TooManySourceLinksError(EventError):
    """More than ``models/source.MAX_LINKS_PER_SOURCE`` URLs on one source, counted after
    blanks and repeats are dropped."""

    code = "too_many_source_links"


class SourceNotFoundError(EventError):
    """A source's ``id`` names no source of this event, or appears twice."""

    code = "source_not_found"


class SourceMediaNotFoundError(EventError):
    code = "source_media_not_found"


class EventNotFoundError(EventError):
    """The targeted row is gone (hard- or soft-deleted)."""

    code = "event_not_found"
    status_code = 404


class EventStateError(EventError):
    code = "invalid_state"
    status_code = 409


class VersionMismatchError(EventError):
    code = "version_mismatch"
    status_code = 409


class NothingChangedError(EventError):
    """A note alone does not lift this."""

    code = "nothing_changed"
    status_code = 409
