"""The event form every write verb takes, and the steps they share: check it, write it, commit."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, time

from fastapi import UploadFile
from geoalchemy2.elements import WKBElement
from sqlalchemy.orm import Session

from app.models.conflict import Conflict
from app.models.event import Event
from app.models.tag import Tag
from app.models.user import User
from app.schemas.source import SourceCreate
from app.services.evidence_intake import attach_evidence_and_commit

from .rules import (
    _require_conflict,
    _require_proof_image,
    _resolve_conflicts,
    _resolve_tags,
    _sanitize_proof,
)
from .sources import PlannedSource, apply_sources, check_publish_floor, plan_sources, planned_floor


@dataclass(frozen=True)
class EventForm:
    """The fields every event write posts, parsed."""

    title: str
    proof_data: str | None
    occurred_date: date | None
    occurred_time: time | None
    tag_ids: list[uuid.UUID]
    conflict_ids: list[uuid.UUID]
    sources: list[SourceCreate]
    proof_files: list[UploadFile]


@dataclass(frozen=True)
class PreparedForm:
    proof: str | None
    tags: list[Tag]
    conflicts: list[Conflict]
    sources: list[PlannedSource]


def prepare_form(
    db: Session, form: EventForm, *, geo: Event | None, uploader: User, publication: bool
) -> PreparedForm:
    """Run every check of ``form`` before anything is written, ``geo`` being the event it
    replaces (None on a create).

    ``publication`` adds the floors a publish holds: a proof image, in the posted proof or else
    the stored one, and a conflict.
    """
    proof = _sanitize_proof(form.proof_data)
    if publication:
        _require_proof_image(proof if proof is not None or geo is None else geo.proof)
    tags = _resolve_tags(db, form.tag_ids)
    conflicts = _resolve_conflicts(db, form.conflict_ids)
    if publication:
        _require_conflict(conflicts)
    planned = plan_sources(db, geo=geo, specs=form.sources, uploader=uploader)
    check_publish_floor(planned_floor(planned))
    return PreparedForm(proof=proof, tags=tags, conflicts=conflicts, sources=planned)


def write_form(
    db: Session,
    geo: Event,
    form: EventForm,
    prepared: PreparedForm,
    coords: WKBElement | None,
) -> None:
    # The collection assignments lazy-load, which would flush a half-edited row.
    with db.no_autoflush:
        geo.title = form.title
        geo.coords = coords
        geo.occurred_date = form.occurred_date
        geo.occurred_time = form.occurred_time
        geo.tags = prepared.tags
        geo.conflicts = prepared.conflicts


async def commit_form(
    db: Session, geo: Event, form: EventForm, prepared: PreparedForm, *, sweep_context: str
) -> Event:
    """Write the sources onto the flushed ``geo``, then attach the proof images and commit."""
    removed = apply_sources(db, geo, prepared.sources)
    await attach_evidence_and_commit(
        db,
        event=geo,
        proof_html=prepared.proof,
        proof_files=form.proof_files,
        sweep_context=sweep_context,
        removed=removed,
    )
    db.refresh(geo)
    return geo
