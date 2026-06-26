"""Resolve a proven X handle to a session — the binding/claim matrix.

After :mod:`app.services.x_oauth` proves a normalized handle, this decides what
it means for the caller: **claim** a machine-assembled profile, **login** a
returning owner, **link** the handle to a logged-in account, or — when no
profile exists — signal **register**-with-X. Business logic + DB; the router
(:mod:`app.routers.auth_x`) owns cookies/redirects and commits.

The UNIQUE constraints on ``users.x_handle`` / ``users.username`` are the race
backstop: the friendly SELECT branches below can both pass under READ
COMMITTED, but only one INSERT/UPDATE wins, and the loser is mapped to a typed
conflict instead of a 500 (same discipline as :mod:`app.services.registration`).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.user import User
from app.services.handles import normalize_handle
from app.services.registration import UsernameAlreadyTakenError


class XBindingError(Exception):
    """Base for binding failures; carries a stable ``code`` for the router."""

    code: str = "x_binding_error"


class HandleConflictError(XBindingError):
    """The proven handle is already bound to a *different* account."""

    code = "x_handle_conflict"


class HandleAlreadySetError(XBindingError):
    """The logged-in caller already has a *different* handle bound."""

    code = "x_handle_already_set"


# Drives the audit event + the post-callback redirect target.
BindingKind = Literal["claim", "login", "link", "register"]


@dataclass(frozen=True)
class BindingOutcome:
    kind: BindingKind
    # None only for ``register`` (no account exists yet — the router hands off
    # to the register-with-X page carrying the verified handle).
    user: User | None
    handle: str  # normalized


def resolve_binding(db: Session, *, handle: str, caller: User | None) -> BindingOutcome:
    """Map ``(caller, proven handle)`` to a :class:`BindingOutcome`.

    Does not commit. Mutates ``claimed_at`` (claim) / ``x_handle`` (link) on the
    session row; the router commits. Raises :class:`XBindingError` for the
    conflict cases.
    """
    handle = normalize_handle(handle)
    existing = db.query(User).filter(User.x_handle == handle, User.deleted_at.is_(None)).first()

    # ── Anonymous caller ───────────────────────────────────────────────────
    if caller is None:
        if existing is None:
            return BindingOutcome(kind="register", user=None, handle=handle)
        if existing.claimed_at is None:
            # The gold path: an owner takes control of the work the machine
            # assembled under their handle.
            existing.claimed_at = datetime.now(UTC)
            return BindingOutcome(kind="claim", user=existing, handle=handle)
        # Already claimed → this is a returning owner signing in with X.
        return BindingOutcome(kind="login", user=existing, handle=handle)

    # ── Logged-in caller linking their handle ──────────────────────────────
    if caller.x_handle == handle:
        return BindingOutcome(kind="link", user=caller, handle=handle)  # idempotent
    if caller.x_handle is not None:
        raise HandleAlreadySetError("Your account is already linked to a different X handle.")
    if existing is not None and existing.id != caller.id:
        # Merging the invite account with a separate assembled profile of the
        # same handle is deferred — surface a clean conflict, write nothing.
        raise HandleConflictError("That X handle is already linked to another account.")

    caller.x_handle = handle
    if caller.claimed_at is None:
        caller.claimed_at = datetime.now(UTC)
    try:
        db.flush()
    except IntegrityError as exc:
        # Lost the UNIQUE race against a concurrent link of the same handle.
        db.rollback()
        raise HandleConflictError("That X handle is already linked to another account.") from exc
    return BindingOutcome(kind="link", user=caller, handle=handle)


def create_x_only_account(db: Session, *, handle: str, username: str) -> User:
    """Create an X-only claimed account from a proven handle + chosen username.

    No password, no email — login is always re-OAuth. Does not commit. Raises
    :class:`UsernameAlreadyTakenError` on a username collision (the form lets
    the user pick another), or :class:`HandleConflictError` if the handle got
    claimed between the OAuth callback and this submit.
    """
    handle = normalize_handle(handle)
    username = username.strip()

    # Friendly pre-checks — the UNIQUE constraints below are the race backstop.
    if (
        db.query(User).filter(User.x_handle == handle, User.deleted_at.is_(None)).first()
        is not None
    ):
        raise HandleConflictError("That X handle now belongs to an account. Try signing in with X.")
    if db.query(User).filter(User.username == username).first() is not None:
        raise UsernameAlreadyTakenError("That username is taken.")

    user = User(username=username, x_handle=handle, claimed_at=datetime.now(UTC))
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        # The handle was pre-checked just above, so a constraint violation here
        # is almost always the user-chosen username racing another register —
        # map to the field the user controls and can change on the form.
        db.rollback()
        raise UsernameAlreadyTakenError("That username is taken.") from exc
    db.refresh(user)
    return user
