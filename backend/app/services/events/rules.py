"""The rules every write verb shares: the evidence floor and the source swap.

The floor a row clears to become ``geolocated`` (:func:`_require_submission_media`,
:func:`_require_proof_image`, :func:`_require_submission_floor`), the proof
sanitiser wrapper, the source-media swap (:class:`SourceSwap`), the tag and
conflict resolvers, and :func:`_credit_geolocator`, the one home of the
owner-among-geolocators invariant. The verbs import from here and never from
each other.
"""

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
    """Sanitise a proof body, ``None`` passing through untouched.

    The absent-proof branch, and nothing else: the mapping from the
    sanitiser's ``ValueError`` to a typed 400 is
    :func:`services.sanitize.sanitize_tiptap_doc_or_raise`, which a
    collection's description takes with its own error class.
    """
    if proof_data is None:
        return None
    return sanitize_tiptap_doc_or_raise(
        proof_data, error=InvalidProofError, allow_placeholders=allow_placeholders
    )


def _require_submission_floor(tags: list[Tag], conflicts: list[Conflict]) -> None:
    """Enforce the curated floor: one conflict + one ``capture_source`` tag.

    Half of the evidence floor a row must clear to become ``geolocated``. A
    human create runs it up front; a request / machine detection is born
    bare and runs it at the geolocate transition. Checked against resolved
    ``Conflict`` / ``Tag`` rows, so a bogus id payload fails like an empty
    one. Both domains ship an escape value (the ``Other`` conflict, the
    ``Other`` capture source), so the rule is always satisfiable.
    """
    if not conflicts:
        raise TagRequirementsError("A conflict is required")
    if "capture_source" not in {t.category for t in tags}:
        raise TagRequirementsError("A capture source tag is required")


def _require_submission_media(has_media: bool) -> None:
    """Enforce the source floor: one source media on the row.

    The sibling of :func:`_require_submission_floor`, shared by every write
    (create, request, geolocate): an event never exists without its footage.
    """
    if not has_media:
        raise MediaRequiredError("A source media file is required")


@dataclass(frozen=True)
class SourceSwap:
    """What a write does to an event's source media: what it drops, what survives.

    The one place the source-media rules live, for the two writes that carry the
    fields (:func:`geolocate` and :func:`save_version`): the removal list names
    stored rows, ``files`` carries the replacement, and the two together have to
    leave the event on exactly one ``source`` media.
    """

    removed: list[Media]
    survivors: int


def _plan_source_swap(geo: Event, *, remove_media_ids: list, files: list[UploadFile]) -> SourceSwap:
    """Read a write's source-media fields against the row, before any S3 work.

    Ids arrive as JSON strings from the form, so the comparison is on the string
    form. Raises :class:`TooManyFilesError` (422) when kept plus new would leave
    the event on more than one source media: the row an upload replaces has to
    be named for removal in the same call, which is also what the
    ``uq_media_source_per_event`` index enforces at the database.

    The caller checks ``survivors`` against the floor
    (:func:`_require_submission_media`) and applies the removals with
    :func:`_apply_source_removals`, so a refused write touches nothing.
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
    """Delete the source rows a write drops, and flush the deletes.

    The flush is the load-bearing half: delete-then-insert has to reach Postgres
    in that order, or the replacement source trips
    ``uq_media_source_per_event`` mid-flush. Call it before the intake attaches
    the new file. What happens to the S3 objects is the caller's own call: a
    pre-publication swap sweeps them, while a version keeps them, since the
    snapshot it just filed renders that media.
    """
    for media in swap.removed:
        db.delete(media)
    db.flush()


def _require_proof_image(proof_doc: dict | None) -> None:
    """Enforce the proof-image floor: the proof body embeds at least one image.

    The third leg of the evidence floor at ``geolocated``: a vouched location
    without a visual argument isn't reviewable. Counts both already-uploaded
    URLs (the edit flow) and ``placeholder://`` srcs about to resolve.
    """
    if proof_doc is None or not extract_image_srcs(proof_doc):
        raise ProofImageRequiredError("At least one proof image is required")


def _resolve_tags(db: Session, tag_ids: list) -> list[Tag]:
    return db.query(Tag).filter(Tag.id.in_(tag_ids)).all() if tag_ids else []


def _resolve_conflicts(db: Session, conflict_ids: list) -> list[Conflict]:
    return db.query(Conflict).filter(Conflict.id.in_(conflict_ids)).all() if conflict_ids else []


def _credit_geolocator(db: Session, geo: Event, user: User) -> None:
    """Make ``user`` the owner of record and record durable geolocation credit.

    The one place that upholds the invariant "a ``geolocated`` event's
    ``owner_id`` is always among its ``event_geolocators``" (asserted on the
    model, and the basis for the GDPR-erasure floor in
    ``admin.hard_delete_user``). Every geolocation-producing path routes through
    here instead of hand-pairing the two writes, so a future transition can't set
    the owner and forget the credit. Idempotent on the credit row by its
    composite PK.
    """
    geo.owner_id = user.id
    db.add(EventGeolocator(event_id=geo.id, user_id=user.id))
