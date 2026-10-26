import uuid
from datetime import UTC, datetime
from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.models.media import MediaKind
from app.models.source import (
    DOCUMENT_SOURCE_KINDS,
    SOURCE_TITLE_MAX_LENGTH,
    SOURCE_URL_MAX_LENGTH,
    ArchiveProvider,
    SourceKind,
    SourceLevel,
)
from app.schemas.media import MediaRead
from app.schemas.tag import TagRead
from app.services.imagery import ImageryKind, ProviderGroup, SourceWarningCode

SourceUrl = Annotated[str, StringConstraints(max_length=SOURCE_URL_MAX_LENGTH)]


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


# An instant without an offset reads as UTC, as the forms send it.
UtcDatetime = Annotated[datetime, AfterValidator(_as_utc)]

# Bound on the lists a request may carry before the service counts them. The service owns the
# product caps (``models/source.MAX_SOURCES_PER_EVENT``, ``MAX_LINKS_PER_SOURCE``) and answers
# past them with a typed 400; this ceiling only stops an oversized payload at the parser.
LIST_PARSE_CEILING = 100


class CoordsRead(BaseModel):
    """One WGS84 point on the wire, nested so a payload can carry several points."""

    lat: float
    lng: float


class CoordsCreate(BaseModel):
    """One WGS84 point as a write takes it; the service checks the ranges."""

    lat: float
    lng: float


class SourceLinkCreate(BaseModel):
    """One URL of a source as the event form posts it."""

    model_config = ConfigDict(extra="forbid")

    url: SourceUrl
    # When the media was posted at this URL (UTC).
    posted_at: UtcDatetime | None = None
    # The archived copy (``services/source_archive.validate_snapshot``). A paste equal to the
    # stored copy keeps its ``archived_at``.
    snapshot_url: SourceUrl | None = None


class SourceCreate(BaseModel):
    """One source block of an event form.

    A write posts the event's whole list and the stored sources follow it. ``id`` names a
    stored source of this event to update in place; a source without one is created, and a
    stored source the list leaves out is deleted.

    The file is one of ``upload_id`` (a staged file from ``POST /uploads``) and ``media_id``
    (a stored file of this event: this source's own keeps it, another source's is copied onto
    this one as a new media row on the same stored object). Neither means no file.
    """

    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID | None = None
    title: Annotated[
        str, StringConstraints(strip_whitespace=True, max_length=SOURCE_TITLE_MAX_LENGTH)
    ] = ""
    level: SourceLevel
    kind: SourceKind
    captured_at: UtcDatetime | None = None
    capture_position: CoordsCreate | None = None
    # Ratchets on a stored source: a posted false keeps a flagged source flagged.
    is_graphic: bool = False
    links: list[SourceLinkCreate] = Field(default_factory=list, max_length=LIST_PARSE_CEILING)
    tag_ids: list[uuid.UUID] = Field(default_factory=list, max_length=LIST_PARSE_CEILING)
    upload_id: uuid.UUID | None = None
    media_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _one_file(self) -> "SourceCreate":
        if self.upload_id is not None and self.media_id is not None:
            raise ValueError("A source carries one file: send upload_id or media_id, not both")
        return self

    @model_validator(mode="after")
    def _no_document_position(self) -> "SourceCreate":
        if self.kind in DOCUMENT_SOURCE_KINDS:
            self.capture_position = None
        return self


class ArchivedLinkRead(BaseModel):
    """One link's archived copy."""

    url: str
    # Derived from the snapshot URL's host.
    provider: ArchiveProvider
    archived_at: datetime


class SourceLinkRead(BaseModel):
    url: str
    posted_at: datetime | None
    # NULL until an analyst records a copy.
    archived: ArchivedLinkRead | None


class SourceWarning(BaseModel):
    """What keeps a reader from reopening a satellite or aircraft image (``services/imagery``).
    Never blocks a write."""

    model_config = ConfigDict(from_attributes=True)

    code: SourceWarningCode
    message: str
    # The link it is about; NULL for the whole source.
    url: str | None


class SourceRead(BaseModel):
    """One source of an event, in the event's derived source order."""

    id: uuid.UUID
    title: str
    level: SourceLevel
    kind: SourceKind
    captured_at: datetime | None
    capture_position: CoordsRead | None
    is_graphic: bool
    # Ordered by ``posted_at``.
    links: list[SourceLinkRead]
    tags: list[TagRead]
    # NULL for a URL-only source.
    media: MediaRead | None
    # Empty unless the kind is ``satellite`` or ``aircraft``.
    warnings: list[SourceWarning]


class UploadRead(BaseModel):
    """A staged source file, referenced by a source's ``upload_id`` until ``expires_at``."""

    id: uuid.UUID
    kind: MediaKind
    sha256: str
    original_filename: str | None
    # Where the stored file renders, so the form can preview it.
    storage_url: str
    expires_at: datetime


class UploadFromLink(BaseModel):
    """A post link to stage a file from, for ``POST /uploads/from-link``."""

    model_config = ConfigDict(extra="forbid")

    url: SourceUrl
    # Which of the post's files, in post order.
    index: int = Field(default=0, ge=0)


class LinkUploadRead(UploadRead):
    """A file staged from a post link."""

    # The kind of every file the post holds, in post order; ``index`` picks one.
    post_media: list[MediaKind]


class SourceCheckLink(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: SourceUrl
    snapshot_url: SourceUrl | None = None


class SourceCheck(BaseModel):
    """A source as the form holds it, for ``POST /sources/check``."""

    model_config = ConfigDict(extra="forbid")

    # The check covers these kinds alone.
    kind: ImageryKind
    captured_at: UtcDatetime | None = None
    links: list[SourceCheckLink] = Field(default_factory=list, max_length=LIST_PARSE_CEILING)


class ImageryProviderRef(BaseModel):
    """An imagery provider of ``services/imagery.PROVIDERS``, by id and name."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str


class ImageryProviderRead(ImageryProviderRef):
    """One imagery provider of ``services/imagery.PROVIDERS``."""

    group: ProviderGroup
    # ``""`` for a provider that cannot be reopened.
    credit: str
    # How a reader reopens the image, or why no reader can.
    help: str


class SourceLinkCheckRead(BaseModel):
    url: str
    # NULL for an unlisted link.
    provider: ImageryProviderRead | None


class SourceCheckRead(BaseModel):
    """The provider each link opens and the warnings the source would carry."""

    links: list[SourceLinkCheckRead]
    warnings: list[SourceWarning]
