"""Own-account writes for the authenticated analyst.

The profile picture lives here rather than in the router because setting one
is three steps that have to happen in order: store the image, point the
column at it, then delete the object the column used to point at. The sweep
runs after the commit, the same commit-then-sweep ordering every other delete
path follows (see :func:`app.services.storage.sweep_keys`).
"""

from __future__ import annotations

from fastapi import UploadFile
from sqlalchemy.orm import Session

from app.models.user import User
from app.services.storage import (
    avatar_key_of,
    get_storage,
    sweep_keys,
    upload_avatar_image,
)


class AvatarError(Exception):
    """The submitted file cannot become an avatar.

    Carries a stable ``code`` so the router maps it to a status without
    matching on prose, the same contract as
    :class:`app.services.evidence_intake.EvidenceIntakeError`.
    """

    code: str = "invalid_avatar"


AVATAR_ERROR_STATUS: dict[str, int] = {"invalid_avatar": 422}


def _sweep_replaced_avatar(url: str | None) -> None:
    """Delete the object a replaced ``avatar_url`` pointed at, if we minted it."""
    key = avatar_key_of(url)
    if key is None:
        return
    sweep_keys([key], context="avatar replaced")


async def set_avatar(db: Session, *, user: User, file: UploadFile) -> User:
    """Store ``file`` as ``user``'s profile picture and drop the previous one.

    Raises :class:`AvatarError` when the file is not an image this codebase
    accepts, is over the image size ceiling, or cannot be decoded.
    """
    try:
        result = await upload_avatar_image(file, user.id)
    except ValueError as exc:
        raise AvatarError(str(exc)) from exc

    previous = user.avatar_url
    user.avatar_url = result.url
    try:
        db.commit()
    except Exception:
        # The object landed before the row did. Roll back, then sweep it so a
        # failed write never leaves an addressable image with nothing pointing
        # at it.
        db.rollback()
        key = get_storage().key_from_url(result.url)
        if key is not None:
            sweep_keys([key], context="avatar commit failed")
        raise
    db.refresh(user)
    _sweep_replaced_avatar(previous)
    return user


def clear_avatar(db: Session, *, user: User) -> User:
    """Drop ``user``'s profile picture, column and stored object both."""
    previous = user.avatar_url
    user.avatar_url = None
    db.commit()
    db.refresh(user)
    _sweep_replaced_avatar(previous)
    return user
