"""Rules every write verb shares: the proof floor, the conflict floor, geolocator credit."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models.conflict import Conflict
from app.models.event import Event, EventGeolocator
from app.models.tag import Tag
from app.models.user import User
from app.services.sanitize import extract_image_srcs, sanitize_html

from .errors import ConflictRequiredError, InvalidProofError, ProofImageRequiredError


def _sanitize_proof(proof_data: str | None) -> str | None:
    """Sanitise a proof body, ``placeholder://`` srcs admitted; ``None`` passes through."""
    if proof_data is None:
        return None
    try:
        return sanitize_html(proof_data, allow_placeholders=True)
    except ValueError as exc:
        raise InvalidProofError(str(exc)) from exc


def _require_conflict(conflicts: list[Conflict]) -> None:
    """Require one conflict on a publication.

    A create runs it up front; a request or detection runs it at the publish. Checked on
    resolved rows, so bogus ids fail like an empty list. The ``Other`` value keeps the rule
    satisfiable.
    """
    if not conflicts:
        raise ConflictRequiredError("A conflict is required")


def _require_proof_image(proof: str | None) -> None:
    """Require at least one image in the proof, uploaded or ``placeholder://``."""
    if proof is None or not extract_image_srcs(proof):
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
    db.flush()
    credit = db.get(EventGeolocator, (geo.id, user.id))
    if credit is None:
        credit = EventGeolocator(event_id=geo.id, user_id=user.id)
        db.add(credit)
    credit.state = "active"
    credit.joined_at = datetime.now(UTC)
