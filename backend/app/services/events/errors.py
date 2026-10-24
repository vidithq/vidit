"""The typed failures of the event lifecycle, each with a stable ``code``.

Leaf module: imports no sibling. The router maps each ``code`` to a status in
``_EVENT_ERROR_STATUS`` (``routers/events/_common.py``).
"""

from __future__ import annotations

from app.services.evidence_intake import EvidenceIntakeError


class EventError(EvidenceIntakeError):
    """Base for event errors; the router catches one base for these and intake failures."""

    code: str = "event_error"


class InvalidCoordinatesError(EventError):
    """Coordinates fall outside the valid ranges (absent ones raise
    :class:`CoordinatesRequiredError`). Maps to 400."""

    code = "invalid_coordinates"


class CoordinatesRequiredError(EventError):
    """The transition requires coordinates and the row has none (a detection may
    be born without a point). Maps to 400."""

    code = "coordinates_required"


class InvalidProofError(EventError):
    code = "invalid_proof"


class ConflictRequiredError(EventError):
    """A publication names no conflict. Maps to 400."""

    code = "conflict_required"


class ProofImageRequiredError(EventError):
    code = "proof_image_required"


class SourceRequiredError(EventError):
    """The event holds no ``direct`` or ``indirect`` source; ``context`` sources alone do not
    support it. Maps to 400."""

    code = "source_required"


class SourceFileRequiredError(EventError):
    """No ``direct`` or ``indirect`` source carries a file. Maps to 400."""

    code = "source_file_required"


class SourceLinkRequiredError(EventError):
    """A source carries no URL. Maps to 400."""

    code = "source_link_required"


class InvalidSourceUrlError(EventError):
    """A source URL is not an ``http(s)`` link with a host. Maps to 400."""

    code = "invalid_source_url"


class TooManySourcesError(EventError):
    """More than ``models/source.MAX_SOURCES_PER_EVENT`` sources. Maps to 400."""

    code = "too_many_sources"


class TooManySourceLinksError(EventError):
    """More than ``models/source.MAX_LINKS_PER_SOURCE`` URLs on one source, counted after
    blanks and repeats are dropped. Maps to 400."""

    code = "too_many_source_links"


class SourceNotFoundError(EventError):
    """A source's ``id`` names no source of this event, or appears twice. Maps to 400."""

    code = "source_not_found"


class SourceMediaNotFoundError(EventError):
    """A source's ``media_id`` names no file of a readable source. Maps to 400."""

    code = "source_media_not_found"


class EventNotFoundError(EventError):
    """The targeted row is gone (hard- or soft-deleted).

    Only the batch completion raises it, as one row's per-row code. The 404 in
    ``_EVENT_ERROR_STATUS`` is defensive, for a future single-row caller.
    """

    code = "event_not_found"


class EventStateError(EventError):
    """The event's state forbids the transition: geolocate on a row that is not
    ``requested`` / ``detected``, close on a ``closed`` row, :func:`save_version`
    on a row that is not ``geolocated``, :func:`update_request` on a row that is
    no longer ``requested``. Maps to 409.
    """

    code = "invalid_state"


class NothingChangedError(EventError):
    """The edit moves no versioned field, so it would file a version identical to
    the live row. A note alone does not lift this. Maps to 409."""

    code = "nothing_changed"
