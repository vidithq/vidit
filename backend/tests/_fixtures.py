"""Shared test helpers: the shared ``client``, the user reaper, the ``make_event``,
``make_detection`` and ``source`` row factories, the audit row read, upload bytes, the X-export
file every archive test writes, direct reads / writes of the local storage root, and small HTTP
and ingest stubs.

The JPEG is real image bytes (the EXIF strip pre-decodes via Pillow, which
rejects a stub). It is embedded as hex so collection needs no Pillow.
"""

from __future__ import annotations

import io
import json
import secrets
import uuid
import zipfile
from collections.abc import Callable, Iterable
from datetime import UTC, date, datetime, time, timedelta
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
from fastapi import UploadFile
from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.config import settings
from app.main import app
from app.models.approval import EventApproval
from app.models.audit_log import AuditLog
from app.models.conflict import Conflict
from app.models.content_report import ContentReport
from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
    EventDetection,
    EventGeolocator,
)
from app.models.invite_code import InviteCode
from app.models.media import Media
from app.models.notification import NotificationDelivery
from app.models.organization import Organization
from app.models.pending_registration import PendingRegistration
from app.models.source import Source, SourceLink
from app.models.tag import Tag
from app.models.user import User
from app.services.sanitize import html_from_text, html_text
from app.services.storage import get_storage
from app.services.tweet_ingest import Detection, resolve_threads
from app.services.tweet_ingest.records import TweetRecord

# Shared by every module; the root conftest clears its cookie jar around each test.
client = TestClient(app)

BOT_USER_ID = "999000"
DETECTION_URL = "https://x.com/a/status/1"


def reap_users(db, user_ids: Iterable[uuid.UUID]) -> None:
    """Delete fixture users and every row that would block or outlive them. Commits.

    Only ``events.owner_id`` blocks a user delete; the rest are rows a test leaves behind:
    approvals ``ck_event_approvals_reviewer`` would refuse to keep without a reviewer,
    orphaned reports and deliveries that would count in the next test's queue or cap.
    """
    ids = list(user_ids)
    db.rollback()
    if ids:
        db.query(EventGeolocator).filter(EventGeolocator.user_id.in_(ids)).delete(
            synchronize_session=False
        )
        db.query(Event).filter(Event.owner_id.in_(ids)).delete(synchronize_session=False)
        db.query(Event).filter(Event.requested_by_id.in_(ids)).delete(synchronize_session=False)
        db.query(EventApproval).filter(
            EventApproval.reviewer_id.in_(ids), EventApproval.organization_id.is_(None)
        ).delete(synchronize_session=False)
        db.query(AuditLog).filter(AuditLog.actor_id.in_(ids)).delete(synchronize_session=False)
        codes = db.query(InviteCode.id).filter(InviteCode.created_by_id.in_(ids))
        db.query(PendingRegistration).filter(PendingRegistration.invite_code_id.in_(codes)).delete(
            synchronize_session=False
        )
        db.query(InviteCode).filter(
            (InviteCode.created_by_id.in_(ids)) | (InviteCode.used_by_id.in_(ids))
        ).delete(synchronize_session=False)
        db.query(Organization).filter(Organization.created_by_id.in_(ids)).delete(
            synchronize_session=False
        )
        db.query(User).filter(User.id.in_(ids)).delete(synchronize_session=False)
    db.query(ContentReport).filter(
        ContentReport.event_id.is_(None),
        ContentReport.collection_id.is_(None),
        ContentReport.site_id.is_(None),
    ).delete(synchronize_session=False)
    db.query(NotificationDelivery).filter(NotificationDelivery.notification_id.is_(None)).delete(
        synchronize_session=False
    )
    db.commit()


def make_event(
    db,
    *,
    author: User,
    # ``None`` models a detection without a subject point (``ck_events_coords_status``).
    lat: float | None = 48.5,
    lng: float | None = 34.5,
    title: str | None = None,
    # ``None`` takes the model's empty-body default, which fails the proof-image floor.
    proof: str | None = None,
    occurred_date: date | None = date(2026, 5, 1),
    occurred_time: time | None = None,
    source_posted_at: datetime | None = None,
    deleted: bool = False,
    tags: list[Tag] | None = None,
    conflicts: list[Conflict] | None = None,
    status: str = STATUS_GEOLOCATED,
    # The lifecycle stamp of ``status``; now by default.
    at: datetime | None = None,
    # Bare literal: the column is typed ``BeforeClosedStatus``, the constant ``EventStatus``.
    before_closed_status: str = "requested",
    detected_from_url: str | None = None,
    # The URL of the one ``direct`` source; ``None`` (and no media) models a source-less row.
    source_url: str | None = "https://example.com/source",
    # Each its own ``direct`` source, as the migration and the imports write them.
    secondary_source_urls: list[str] | None = None,
    # Replaces the sources the URL arguments build.
    sources: list[Source] | None = None,
    # Sets every source's level.
    level: str = "direct",
    with_media: bool = False,
    proof_images: int = 0,
    is_graphic: bool = False,
    hidden: bool = False,
    kind: str = "smartphone",
) -> Event:
    """One event row owned by ``author``, a published geolocation by default, stamped as the
    lifecycle CHECKs require."""
    now = datetime.now(UTC)
    geo = Event(
        owner_id=author.id,
        title=title or f"Geo {uuid.uuid4().hex[:8]}",
        coords=(
            from_shape(Point(lng, lat), srid=4326) if lat is not None and lng is not None else None
        ),
        occurred_date=occurred_date,
        occurred_time=occurred_time,
        status=status,
    )
    if sources is None:
        sources = []
        if source_url is not None or with_media:
            sources.append(
                Source(
                    level=level,
                    kind=kind,
                    is_graphic=is_graphic,
                    created_at=now,
                    links=(
                        [
                            SourceLink(
                                url=source_url,
                                posted_at=source_posted_at
                                or datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
                            )
                        ]
                        if source_url is not None
                        else []
                    ),
                    media=_media() if with_media else None,
                )
            )
        for offset, url in enumerate(secondary_source_urls or [], start=1):
            sources.append(
                Source(
                    level=level,
                    kind="unknown",
                    created_at=now + timedelta(microseconds=offset),
                    links=[SourceLink(url=url)],
                )
            )
    geo.sources = sources
    if proof is not None:
        geo.proof = proof
    stamp = at or now
    if status == STATUS_GEOLOCATED:
        geo.geolocated_at = stamp
    elif status == STATUS_DETECTED:
        geo.detected_at = stamp
    elif status == STATUS_REQUESTED:
        geo.requested_at = stamp
    elif status == STATUS_CLOSED:
        geo.closed_at = stamp
        geo.before_closed_status = before_closed_status
    if detected_from_url is not None:
        geo.detection = EventDetection(from_url=detected_from_url)
    if deleted:
        geo.deleted_at = now
    if hidden:
        geo.hidden_at = now
    if tags:
        geo.tags = tags
    if conflicts:
        geo.conflicts = conflicts
    if proof_images:
        geo.media = [_media() for _ in range(proof_images)]
    db.add(geo)
    db.commit()
    db.refresh(geo)
    return geo


def make_detection(db, author: User, **kw: Any) -> Event:
    """A machine detection as the import leaves it: one ``unknown`` source on the post it came
    from, no conflict. ``kw`` are :func:`make_event` overrides."""
    kw.setdefault("source_url", DETECTION_URL)
    kw.setdefault("kind", "unknown")
    kw.setdefault("detected_from_url", DETECTION_URL)
    return make_event(db, author=author, status=STATUS_DETECTED, **kw)


def source(
    url: str | None = None, *, level: str = "direct", kind: str = "unknown", **kw: Any
) -> Source:
    """One source with ``url`` as its only link (none when ``None``); ``kw`` are columns."""
    return Source(
        level=level, kind=kind, links=[SourceLink(url=url)] if url is not None else [], **kw
    )


def audit_row(db, actor: User, action: str) -> AuditLog | None:
    """The ``action`` row ``actor`` wrote, ``None`` when there is none; raises on a second."""
    return (
        db.query(AuditLog)
        .filter(AuditLog.actor_id == actor.id, AuditLog.action == action)
        .one_or_none()
    )


def _media() -> Media:
    return Media(sha256=fake_sha256(), storage_url="s3://x/m.jpg", kind="image")


def error_code(response) -> str:
    return response.json()["detail"]["code"]


def storage_key(url: str) -> str:
    key = get_storage().key_from_url(url)
    assert key is not None
    return key


def zip_bytes(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


def upload_file(name: str, content: bytes, content_type: str) -> UploadFile:
    return UploadFile(
        filename=name, file=io.BytesIO(content), headers={"content-type": content_type}
    )


def single_detection(thread: list[TweetRecord]) -> Detection:
    """The single detection a one-coordinate thread resolves to."""
    [detection] = resolve_threads([thread]).detections
    return detection


def syndication_client(
    bodies: dict[str, dict[str, Any]],
    route: Callable[[httpx.Request], httpx.Response | None] | None = None,
) -> httpx.Client:
    """A syndication transport serving ``bodies`` by post id, 404 elsewhere; ``route`` answers
    first when it returns a response."""

    def handler(req: httpx.Request) -> httpx.Response:
        if route is not None and (answer := route(req)) is not None:
            return answer
        body = bodies.get(req.url.params.get("id", ""))
        return httpx.Response(200, json=body) if body is not None else httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler))


def write_client(
    posted: list[dict[str, object]], liked: list[dict[str, object]], reply_id: str = "777"
) -> httpx.Client:
    """The bot's X write client: ``posted`` captures replies (answered ``reply_id``), ``liked``
    the likes calls."""

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("/likes"):
            liked.append(json.loads(req.content))
            return httpx.Response(200, json={"data": {"liked": True}})
        posted.append(json.loads(req.content))
        return httpx.Response(201, json={"data": {"id": reply_id}})

    return httpx.Client(transport=httpx.MockTransport(handler))


def fake_sha256() -> str:
    """A random hex digest for a ``Media`` row whose bytes the test never stores."""
    return secrets.token_hex(32)


def stored_path(key: str) -> Path:
    """Where ``LocalStorage`` puts ``key``, read at call time so a repointed ``local_storage_dir`` is followed."""
    return Path(settings.local_storage_dir) / key


def stored_bytes(key: str) -> bytes:
    """What storage holds at ``key``; raises ``FileNotFoundError`` on a miss.

    The production protocol has no whole-object read (archives stream via ``get_to_path``).
    """
    return stored_path(key).read_bytes()


def store_bytes(data: bytes, key: str) -> None:
    """Stage ``data`` at ``key`` on the local root, skipping the upload path."""
    path = stored_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def stored_keys() -> set[str]:
    """Every key the local storage root holds (emptied before each test, see ``conftest``)."""
    root = Path(settings.local_storage_dir)
    return {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}


def write_archive_js(dest: Path, entries: list[dict[str, Any]]) -> None:
    """Write ``tweets.js`` under ``dest`` from raw X-export tweet dicts."""
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "tweets.js").write_text(
        "window.YTD.tweets.part0 = " + json.dumps([{"tweet": e} for e in entries]),
        encoding="utf-8",
    )


# 1×1 red JPEG, no EXIF, no ICC.
_TINY_JPEG_HEX = (
    "ffd8ffe000104a46494600010100000100010000ffdb0043000201010101010201010102020202020403020202020504040304060506060605060606070908060709070606080b08090a0a0a0a0a06080b0c0b0a0c090a0a0a"
    "ffdb004301020202020202050303050a0706070a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a"
    "ffc00011080001000103012200021101031101"
    "ffc4001f0000010501010101010100000000000000000102030405060708090a0b"
    "ffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9fa"
    "ffc4001f0100030101010101010101010000000000000102030405060708090a0b"
    "ffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9fa"
    "ffda000c03010002110311003f00f8be8a28afe533fdfc3f"
    "ffd9"
)

TINY_JPEG: bytes = bytes.fromhex(_TINY_JPEG_HEX)

# Stand-in mp4 bytes: ingest stores videos without decoding them.
TINY_MP4: bytes = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isomFAKE"


def tweet_record(**kw: Any) -> TweetRecord:
    """A ``TweetRecord`` with defaults for the fields a test does not care about."""
    base: dict[str, Any] = {
        "tweet_id": "1",
        "handle": "analyst",
        "text": "",
        "created_at": "2025-11-12T14:33:00Z",
    }
    base.update(kw)
    return TweetRecord(**base)


def collection_description(text: str = "What this shelf holds.") -> dict[str, Any]:
    """The HTML description and its plain-text projection a ``collections`` row stores.

    Spread it into the constructor: ``Collection(..., **collection_description("…"))``.
    """
    html = html_from_text(text)
    return {"description": html, "description_text": html_text(html)}


def gif_bytes(frames: int, size: tuple[int, int] = (8, 8)) -> bytes:
    """An animated GIF whose frame ``i`` is solid red ``40 * i``, so each frame reads apart."""
    from PIL import Image

    images = [Image.new("RGB", size, (40 * i, 0, 0)) for i in range(frames)]
    out = BytesIO()
    images[0].save(out, format="GIF", save_all=True, append_images=images[1:], duration=100)
    return out.getvalue()
