"""Rules every write verb shares: the evidence floor, the source swap, geolocator credit."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import UploadFile
from sqlalchemy.orm import Session

from app.models.conflict import Conflict
from app.models.event import Event, EventGeolocator
from app.models.media import Media
from app.models.tag import Tag
from app.models.user import User
from app.services.evidence_intake import MediaRequiredError, TooManyFilesError
from app.services.sanitize import extract_image_srcs, sanitize_tiptap_doc_or_raise

from .errors import InvalidProofError, ProofImageRequiredError, TagRequirementsError


def _sanitize_proof(proof_data: dict | None, *, allow_placeholders: bool = False) -> dict | None:
    """Sanitise a proof body; ``None`` passes through. The typed 400 comes from
    :func:`services.sanitize.sanitize_tiptap_doc_or_raise`."""
    if proof_data is None:
        return None
    return sanitize_tiptap_doc_or_raise(
        proof_data, error=InvalidProofError, allow_placeholders=allow_placeholders
    )


def _require_submission_floor(tags: list[Tag], conflicts: list[Conflict]) -> None:
    """Require one conflict and one ``capture_source`` tag.

    A create runs it up front; a request or detection runs it at geolocate.
    Checked on resolved rows, so bogus ids fail like an empty list. The
    ``Other`` values keep the rule satisfiable.
    """
    if not conflicts:
        raise TagRequirementsError("A conflict is required")
    if "capture_source" not in {t.category for t in tags}:
        raise TagRequirementsError("A capture source tag is required")


def _require_submission_media(has_media: bool) -> None:
    """Require a source media on the row, for every write."""
    if not has_media:
        raise MediaRequiredError("A source media file is required")


@dataclass(frozen=True)
class SourceSwap:
    """The source media a write drops and how many survive (:func:`geolocate`,
    :func:`save_version`); the result must be exactly one ``source`` media."""

    removed: list[Media]
    survivors: int


def _plan_source_swap(geo: Event, *, remove_media_ids: list, files: list[UploadFile]) -> SourceSwap:
    """Plan a write's source-media changes before any S3 work.

    Ids arrive as strings, so compare on the string form. Raises
    :class:`TooManyFilesError` (422) when kept plus new exceeds one, as
    ``uq_media_source_per_event`` enforces in the DB. The caller checks
    ``survivors`` against the floor, so a refused write touches nothing.
    """
    removing = {str(x) for x in remove_media_ids}
    sources = [m for m in geo.media if m.role == "source"]
    kept = [m for m in sources if str(m.id) not in removing]
    if len(kept) + len(files) > 1:
        raise TooManyFilesError(
            "An event carries a single source media; remove the current one to replace it"
        )
    return SourceSwap(
        removed=[m for m in sources if str(m.id) in removing],
        survivors=len(kept) + len(files),
    )


def _apply_source_removals(db: Session, swap: SourceSwap) -> None:
    """Delete the dropped source rows and flush.

    Delete must reach Postgres before the insert, or the replacement trips
    ``uq_media_source_per_event``. Call before the intake attaches the new file.
    S3 objects are the caller's: a pre-publication swap sweeps them, a version
    keeps them (its snapshot renders that media).
    """
    for media in swap.removed:
        db.delete(media)
    db.flush()


def _require_proof_image(proof_doc: dict | None) -> None:
    """Require at least one image in the proof, uploaded or ``placeholder://``."""
    if proof_doc is None or not extract_image_srcs(proof_doc):
        raise ProofImageRequiredError("At least one proof image is required")


def _resolve_tags(db: Session, tag_ids: list) -> list[Tag]:
    return db.query(Tag).filter(Tag.id.in_(tag_ids)).all() if tag_ids else []


def _resolve_conflicts(db: Session, conflict_ids: list) -> list[Conflict]:
    return db.query(Conflict).filter(Conflict.id.in_(conflict_ids)).all() if conflict_ids else []


def _credit_geolocator(db: Session, geo: Event, user: User) -> None:
    """Make ``user`` the owner and credit them as geolocator.

    Upholds "a ``geolocated`` event's ``owner_id`` is among its
    ``event_geolocators``" (the basis of the GDPR-erasure floor in
    ``admin.hard_delete_user``). Every geolocating path goes through here.
    """
    geo.owner_id = user.id
    db.add(EventGeolocator(event_id=geo.id, user_id=user.id))
