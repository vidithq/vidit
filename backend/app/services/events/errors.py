"""The typed failures of the event lifecycle, each with a stable ``code``.

Leaf module: imports no sibling. The form sentence of each source code is mirrored by ``frontend/src/lib/sources.ts::SOURCE_ERROR_MESSAGES``; change both.
"""

from __future__ import annotations

from app.services.evidence_intake import EvidenceIntakeError


class EventError(EvidenceIntakeError):
    """Base for event errors; the router catches one base for these and intake failures."""

    code: str = "event_error"
    status_code = 400


class InvalidCoordinatesError(EventError):
    """Coordinates fall outside the valid ranges (absent ones raise
    :class:`CoordinatesRequiredError`)."""

    code = "invalid_coordinates"
    status_code = 400


class CoordinatesRequiredError(EventError):
    """The transition requires coordinates and the row has none (a detection may
    be born without a point)."""

    code = "coordinates_required"
    status_code = 400


class InvalidProofError(EventError):
    code = "invalid_proof"
    status_code = 400


class ConflictRequiredError(EventError):
    """A publication names no conflict."""

    code = "conflict_required"
    status_code = 400


class ProofImageRequiredError(EventError):
    code = "proof_image_required"
    status_code = 400


class SourceRequiredError(EventError):
    """The event holds no ``direct`` or ``indirect`` source; ``context`` sources alone do not
    support it."""

    code = "source_required"
    status_code = 400


class SourceFileRequiredError(EventError):
    """No ``direct`` or ``indirect`` source carries a file."""

    code = "source_file_required"
    status_code = 400


class SourceLinkRequiredError(EventError):
    """A source carries no URL."""

    code = "source_link_required"
    status_code = 400


class InvalidSourceUrlError(EventError):
    """A source URL is not an ``http(s)`` link with a host."""

    code = "invalid_source_url"
    status_code = 400


class TooManySourcesError(EventError):
    """More than ``models/source.MAX_SOURCES_PER_EVENT`` sources."""

    code = "too_many_sources"
    status_code = 400


class TooManySourceLinksError(EventError):
    """More than ``models/source.MAX_LINKS_PER_SOURCE`` URLs on one source, counted after
    blanks and repeats are dropped."""

    code = "too_many_source_links"
    status_code = 400


class SourceNotFoundError(EventError):
    """A source's ``id`` names no source of this event, or appears twice."""

    code = "source_not_found"
    status_code = 400


class SourceMediaNotFoundError(EventError):
    """A source's ``media_id`` names no file of a readable source."""

    code = "source_media_not_found"
    status_code = 400


class EventNotFoundError(EventError):
    """The targeted row is gone (hard- or soft-deleted).

    Only the batch completion raises it, as one row's per-row code. Its 404 is defensive, for a
    future single-row caller.
    """

    code = "event_not_found"
    status_code = 404


class EventStateError(EventError):
    """The event's state forbids the transition: :func:`save_version` on a
    ``closed`` row, close on a ``closed`` row, :func:`update_request` on a row
    that is no longer ``requested``, a batch publish of a row that is no longer
    ``detected``.
    """

    code = "invalid_state"
    status_code = 409


class VersionMismatchError(EventError):
    """The write names the version its form was loaded at, and the row has moved past it (a
    racing publish or edit landed first)."""

    code = "version_mismatch"
    status_code = 409


class NothingChangedError(EventError):
    """The edit moves no versioned field, so it would file a version identical to
    the live row. A note alone does not lift this."""

    code = "nothing_changed"
    status_code = 409
