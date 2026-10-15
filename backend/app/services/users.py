"""Profile writes shared by an analyst's own account and an organization.

Setting an avatar is ordered: store the image, point the column at it, commit,
then sweep the old object (see :func:`app.services.storage.sweep_keys`).
"""

from __future__ import annotations

import uuid
from typing import Any, Protocol

from fastapi import UploadFile
from sqlalchemy.orm import Session

from app.schemas.user import UserUpdate
from app.services.storage import (
    avatar_key_of,
    get_storage,
    sweep_keys,
    upload_avatar_image,
)


class AvatarError(Exception):
    """The submitted file cannot become an avatar.

    Carries a stable ``code`` for the router, like
    :class:`app.services.evidence_intake.EvidenceIntakeError`.
    """

    code: str = "invalid_avatar"


AVATAR_ERROR_STATUS: dict[str, int] = {"invalid_avatar": 422}


class ProfileOwner(Protocol):
    """A row with a public profile: ``users`` or ``organizations``."""

    id: uuid.UUID
    bio: str | None
    avatar_url: str | None
    external_links: dict[str, Any]


def apply_profile_update(owner: ProfileOwner, body: UserUpdate) -> None:
    """Apply the fields ``body`` sets. ``external_links`` replaces the whole
    object, and per-platform nulls are dropped so the JSONB stays sparse."""
    update_data = body.model_dump(exclude_unset=True)
    if "bio" in update_data:
        owner.bio = update_data["bio"]
    if "external_links" in update_data:
        links = update_data["external_links"] or {}
        owner.external_links = {k: v for k, v in links.items() if v is not None}


def _sweep_replaced_avatar(url: str | None) -> None:
    """Delete the object a replaced ``avatar_url`` pointed at, if we minted it."""
    key = avatar_key_of(url)
    if key is None:
        return
    sweep_keys([key], context="avatar replaced")


async def set_avatar[Owner: ProfileOwner](db: Session, *, owner: Owner, file: UploadFile) -> Owner:
    """Store ``file`` as ``owner``'s profile picture and drop the previous one.

    Raises :class:`AvatarError` on an unaccepted, oversized, or undecodable file.
    """
    try:
        result = await upload_avatar_image(file, owner.id)
    except ValueError as exc:
        raise AvatarError(str(exc)) from exc

    previous = owner.avatar_url
    owner.avatar_url = result.url
    try:
        db.commit()
    except Exception:
        # The object landed before the row did: sweep it so no orphan stays.
        db.rollback()
        key = get_storage().key_from_url(result.url)
        if key is not None:
            sweep_keys([key], context="avatar commit failed")
        raise
    db.refresh(owner)
    _sweep_replaced_avatar(previous)
    return owner


def clear_avatar[Owner: ProfileOwner](db: Session, *, owner: Owner) -> Owner:
    """Drop ``owner``'s profile picture, column and stored object both."""
    previous = owner.avatar_url
    owner.avatar_url = None
    db.commit()
    db.refresh(owner)
    _sweep_replaced_avatar(previous)
    return owner
