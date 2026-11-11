"""The direct create: a ``geolocated`` row born with its full evidence."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy.orm import Session

from app.cache import points_cache
from app.models.event import Event
from app.models.user import User
from app.services import geolocator_credit

from .coordinates import validate_coordinates
from .form import EventForm, commit_form, prepare_form, write_form
from .rules import _credit_geolocator


async def create_with_evidence(
    db: Session,
    *,
    current_user: User,
    form: EventForm,
    lat: float,
    lng: float,
    geolocator_invites: Sequence[str] = (),
) -> Event:
    """Create a ``geolocated`` event with its evidence (a direct geolocate).

    The creator is stamped ``geolocated_at`` and credited in ``event_geolocators``. Each of
    ``geolocator_invites`` is invited to share the credit in the same transaction
    (``geolocator_credit.invite_on_publish``).

    The full floor applies: subject coordinates, a ``direct`` or ``indirect`` source with its
    file (``sources.check_publish_floor``), a proof image (a ``placeholder://`` src resolved
    from ``proof_files``, see ``evidence_intake``), and a conflict.

    Raises :class:`EvidenceIntakeError` subclasses: bad coordinates, an unmet floor, invalid or
    image-less proof, a source list past its caps or naming an unknown upload or file, or a
    proof intake failure; ``SnapshotRejected`` for a pasted copy that is not a snapshot;
    ``GeolocatorCreditError`` for a refused invitation. Every check runs before the first
    upload; any later failure rolls back and sweeps what landed.
    """
    validate_coordinates(lat, lng)
    prepared = prepare_form(db, form, geo=None, uploader=current_user, publication=True)

    # ``proof`` lands via the intake below; the model default covers NOT NULL until then.
    geo = Event(owner_id=current_user.id, geolocated_at=datetime.now(UTC))
    write_form(db, geo, form, prepared, from_shape(Point(lng, lat), srid=4326))
    db.add(geo)
    db.flush()
    _credit_geolocator(db, geo, current_user)
    geolocator_credit.invite_on_publish(db, geo=geo, usernames=geolocator_invites)
    await commit_form(db, geo, form, prepared, sweep_context="event create rollback")
    points_cache.invalidate()
    return geo
