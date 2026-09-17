import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.models.event import TITLE_MAX_LENGTH
from app.models.media import MediaRole, MediaType
from app.schemas.user import AuthorRef
from app.services.sanitize import sanitize_tiptap_doc, tiptap_doc_text

# How long a collection's description may be, measured on its plain-text
# projection (``services/sanitize.tiptap_doc_text``) rather than on the
# document: the cap is how much a reader wrote, and the markup around it is not
# something an analyst counts. The profile bio's figure for the same class of
# body, kept as its own constant because the two are separate concepts: one
# says who an analyst is, the other says what one collection holds.
DESCRIPTION_MAX_LENGTH = 500

# How many events one create may put on a collection. The create page's picker
# sends what the analyst ticked, so this is a ceiling on the body rather than a
# rule about curation: a collection is a curated set, and the cap is what keeps
# a runaway request from opening one transaction over the whole catalogue.
MAX_CREATE_EVENTS = 500


class CollectionWrite(BaseModel):
    """The fields a collection carries, as a create or an update sends them.

    Both write bodies take the same pair, so opening a collection and editing
    one cannot drift apart on a cap or on what counts as blank. Both fields
    are required: a collection carries a name, and it says what it holds in a
    Tiptap document, the same class of body an event's ``proof`` is.
    """

    title: str = Field(min_length=1, max_length=TITLE_MAX_LENGTH)
    description: dict[str, Any]

    @field_validator("title")
    @classmethod
    def _required_text(cls, v: str) -> str:
        """Strip surrounding whitespace, and refuse what is left empty.

        The bio's normalisation (``schemas/user._normalise_optional``) without
        its empty-to-None branch, which belongs to an optional field: a title
        of spaces is a missing title, and the field is required, so it is a
        422 rather than a stored blank.
        """
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("must not be empty")
        return cleaned

    @field_validator("description")
    @classmethod
    def _sanitized_doc(cls, v: dict[str, Any]) -> dict[str, Any]:
        """Sanitise the document, then judge it on the text it carries.

        Three refusals, all 422 on the field, so the create and the update
        answer the same way. The document has to pass
        ``services/sanitize.sanitize_tiptap_doc`` with ``allow_images=False``:
        a description is prose about a shelf, there is no upload path behind
        it, and an image node is dropped rather than stored. What survives is
        flattened with ``services/sanitize.tiptap_doc_text``, and that
        projection is what the two remaining rules read: it must not be empty,
        on the same terms a title of spaces is refused, and it must not run
        past :data:`DESCRIPTION_MAX_LENGTH`.

        Measuring the cap on the projection rather than on the serialised
        document is what keeps bolding a word from costing an analyst
        characters they have already typed.
        """
        try:
            doc = sanitize_tiptap_doc(v, allow_images=False)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc
        text = tiptap_doc_text(doc)
        if not text:
            raise ValueError("must not be empty")
        if len(text) > DESCRIPTION_MAX_LENGTH:
            raise ValueError(f"must be at most {DESCRIPTION_MAX_LENGTH} characters")
        return doc


class CollectionCreate(CollectionWrite):
    """Body of ``POST /collections``: the title, the description, and the
    events the collection opens with.

    ``event_ids`` is optional and empty by default, so a collection still
    opens on its two fields alone. When it carries ids, the create and the
    shelving are one act: the service puts every one of them on the
    collection inside the same transaction, through the checks
    ``PUT /collections/{id}/events/{event_id}`` runs, so an ineligible or
    foreign id fails the whole create and no half-filled collection lands.

    The ids are de-duplicated in the order they arrived, because ticking one
    row twice is one membership, and capped at
    :data:`MAX_CREATE_EVENTS`. Items order themselves by when their events
    happened, so the order the ids arrive in carries nothing else.
    """

    event_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_CREATE_EVENTS)

    @field_validator("event_ids")
    @classmethod
    def _unique(cls, v: list[uuid.UUID]) -> list[uuid.UUID]:
        """Collapse repeats, keeping the first occurrence of each id."""
        return list(dict.fromkeys(v))


class CollectionUpdate(CollectionWrite):
    """Body of ``PATCH /collections/{id}``: the title and the description
    together, under the caps the create takes. Both are sent on every edit,
    so one request states what the collection is rather than leaving the two
    fields to be saved apart."""


class CollectionCoverTile(BaseModel):
    """One tile of the mosaic a collection wears, and what kind of file it is.

    ``url`` points at the media of one item the collection holds. ``media_type``
    is the media-kind domain ``models/media.MediaType`` defines, so a client
    picks the element that can render the file: most source media in the corpus
    are clips, and an ``<img>`` pointed at one paints an empty band.

    ``role`` is the media-role domain ``models/media.MediaRole`` defines, and it
    is what tells a client whether the picture has display derivatives. Only a
    ``source`` image is uploaded with them (``services/storage.upload_file``);
    ``services/storage.upload_proof_image`` passes ``produce_derivatives=False``,
    so a ``proof`` image has no ``_hero`` / ``_thumb`` sibling and a client that
    rewrites its url to one asks for an object that was never written.
    """

    url: str
    media_type: MediaType
    role: MediaRole


class CollectionRead(BaseModel):
    """One collection as every read surface renders it.

    ``title`` and ``description`` are the two fields the owner writes, both
    required: the name of the collection, and the Tiptap document saying what
    it holds. ``description_text`` is that document's plain-text projection
    (``services/sanitize.tiptap_doc_text``), the reading a surface with no room
    for rich text takes: the card's two-line clamp, a share card, a snippet.
    Both travel on every read, so a client renders the document where it can
    and reads the projection where it cannot, without flattening the tree
    itself.

    ``event_count``, ``first_date`` and ``last_date`` are computed at read
    time over the events the collection may show
    (``services/event_filters.collectable_events``), never stored: a row that
    closes, is taken down or is soft-deleted leaves the count and the range
    without a write to the membership table. ``first_date`` and ``last_date``
    are the smallest and largest ``event_date`` among those events, so both
    are null for a collection holding nothing and for one whose items all
    lack a date.

    ``cover`` is the mosaic the profile card wears: zero to four tiles, each
    the media of one item the collection holds, computed at read time and
    never stored (``services/collections.cover_tiles_for`` states the rule).
    The list is empty when nothing on the collection carries media a card may
    show, and the collection's own page shows no cover at all.

    Each tile's url, kind and role travel together rather than as a bare url,
    because most source media in the corpus are clips: a tile taken off a
    video item is an ``.mp4``, and a client handed the url alone renders it in
    an ``<img>`` and shows an empty band. The role says whether the picture has
    display derivatives, which a proof image has not.
    """

    id: uuid.UUID
    owner: AuthorRef
    title: str
    description: dict[str, Any]
    description_text: str
    cover: list[CollectionCoverTile]
    event_count: int
    first_date: date | None
    last_date: date | None
    created_at: datetime


class CollectionList(BaseModel):
    """One page of an analyst's collections, newest first.

    Offset-paged rather than cursor-paged, like the profile feed beside it
    (``GET /users/{username}/events``): the profile renders a pager over a
    small set, and ``total`` counts the collections the caller may see, so the
    pager never counts a row the list will not serve.
    """

    items: list[CollectionRead]
    total: int
    page: int
    per_page: int


class CollectionMembershipRead(BaseModel):
    """One of the caller's collections, and whether one event is already in it.

    The add-to-collection popover's row. Thinner than :class:`CollectionRead`:
    the popover names a collection, shows a checked state and says how much
    the collection already holds, so it carries no description, no mosaic and
    no date range.

    ``event_count`` is computed over the same predicate
    (``services/event_filters.collectable_events``) the collection reads use,
    so the number under a title in the popover is the number the collection's
    own page prints.
    """

    id: uuid.UUID
    title: str
    event_count: int
    in_collection: bool


class CollectionMembershipList(BaseModel):
    """Every collection the caller owns, as the popover reads them."""

    items: list[CollectionMembershipRead]
