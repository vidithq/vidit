"""End-to-end tests for ``GET /search``.

The "requests" group is a view over the events table (``status = 'requested'``, no
location); the located view filters ``location IS NOT NULL``, so the two never overlap.
Each test seeds rows with a unique token so matches stay bounded to its own data.
"""

from __future__ import annotations

import base64
import json
import uuid
from datetime import UTC, date, datetime

import pytest
from geoalchemy2.shape import from_shape
from shapely.geometry import Polygon

from app.models.collection import Collection, CollectionEvent
from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED, STATUS_REQUESTED, Event
from app.models.media import Media
from app.models.organization import Organization, OrganizationMember
from app.models.site import Site, SiteContour
from app.models.source import Source, SourceLink
from app.services.search import HIGHLIGHT_START, HIGHLIGHT_STOP
from tests._fixtures import client, collection_description, fake_sha256, make_event, source
from tests.conftest import login_as


@pytest.fixture
def caller(make_user):
    """Owner of the seeded rows; the unique username keeps it out of results."""
    return make_user("caller")


def _grouped(body: dict) -> dict[str, list[dict]]:
    """The hits of a response by kind, the events split into located rows and requests."""
    hits = body["hits"]

    def of(type_: str, *statuses: str) -> list[dict]:
        return [h for h in hits if h["type"] == type_ and (not statuses or h["status"] in statuses)]

    return {
        "geolocations": of("event", STATUS_GEOLOCATED, STATUS_DETECTED),
        "requests": of("event", STATUS_REQUESTED),
        "collections": of("collection"),
        "users": of("user"),
        "organizations": of("organization"),
        "sites": of("site"),
    }


def _unique_token() -> str:
    """A token unique enough to isolate a test from other rows in the dev DB."""
    return f"vidqterm{uuid.uuid4().hex[:10]}"


def test_search_is_anonymous():
    """No session required."""
    response = client.get("/api/v1/search?q=anything")
    assert response.status_code == 200


def test_empty_query_returns_an_empty_list():
    response = client.get("/api/v1/search?q=")
    assert response.status_code == 200
    assert response.json() == {
        "hits": [],
        "total": 0,
        "cursor": None,
        "suggestion": None,
        "query": "",
    }


def test_whitespace_only_query_returns_an_empty_list():
    response = client.get("/api/v1/search?q=%20%20%20")
    assert response.status_code == 200
    assert response.json()["hits"] == []


def test_invalid_type_returns_422():
    response = client.get("/api/v1/search?q=x&type=bogus")
    assert response.status_code == 422
    assert "type" in response.json()["detail"].lower()


def test_limit_outside_range_returns_422():
    response = client.get("/api/v1/search?q=x&limit=0")
    assert response.status_code == 422
    response = client.get("/api/v1/search?q=x&limit=51")
    assert response.status_code == 422


def test_search_matches_geolocation_by_title(db, caller):
    token = _unique_token()
    geo = make_event(db, author=caller, title=f"Spotted {token} convoy near checkpoint")
    db.add(
        Media(
            sha256=fake_sha256(),
            source_id=geo.sources[0].id,
            storage_url=f"http://localhost:8000/local-storage/geolocation_media/{geo.id}/x.jpg",
            kind="image",
        )
    )
    # The thumbnail pick prefers a source file (``services.thumbnails``), so proof stays off the hit.
    db.add(
        Media(
            sha256=fake_sha256(),
            event_id=geo.id,
            storage_url=f"http://localhost:8000/local-storage/geolocation_media/{geo.id}/p.jpg",
            kind="image",
        )
    )
    db.commit()
    geo_id = geo.id
    response = client.get(f"/api/v1/search?q={token}&type=event")
    assert response.status_code == 200
    body = _grouped(response.json())
    assert len(body["geolocations"]) == 1
    hit = body["geolocations"][0]
    assert hit["id"] == str(geo_id)
    assert token in hit["title"]
    assert f"{HIGHLIGHT_START}{token}{HIGHLIGHT_STOP}" in hit["title_highlight"]
    # Regression: the located group carries the picked thumbnail, as the list view does.
    assert [m["kind"] for m in hit["media"]] == ["image"]
    assert hit["media"][0]["storage_url"].endswith(f"{geo_id}/x.jpg")
    # An unflagged event reads false rather than omitting the key.
    assert hit["is_graphic"] is False


def test_search_proof_only_event_surfaces_proof_image_thumbnail(db, caller):
    """With no source media a proof image is the thumbnail; a proof video is never picked."""
    token = _unique_token()
    proof_only = make_event(db, author=caller, title=f"Proof-only {token} strike footage")
    video_only = make_event(
        db, author=caller, title=f"Video-proof {token} strike footage", lat=48.6, lng=34.6
    )
    db.add(
        Media(
            sha256=fake_sha256(),
            event_id=proof_only.id,
            storage_url=f"http://localhost:8000/local-storage/geolocation_media/{proof_only.id}/p.jpg",
            kind="image",
        )
    )
    # Defensive: a proof video should not exist but must never be picked.
    db.add(
        Media(
            sha256=fake_sha256(),
            event_id=video_only.id,
            storage_url=f"http://localhost:8000/local-storage/geolocation_media/{video_only.id}/p.mp4",
            kind="video",
        )
    )
    db.commit()
    ids = [proof_only.id, video_only.id]
    response = client.get(f"/api/v1/search?q={token}&type=event")
    assert response.status_code == 200
    hits = {h["id"]: h for h in _grouped(response.json())["geolocations"]}
    proof_hit = hits[str(ids[0])]
    assert [m["kind"] for m in proof_hit["media"]] == ["image"]
    assert proof_hit["media"][0]["storage_url"].endswith(f"{ids[0]}/p.jpg")
    assert hits[str(ids[1])]["media"] == []


def test_search_matches_a_request_by_source_title_and_url(db, caller):
    """A request matches on a source title (full text) and on a source URL (substring)."""
    token = _unique_token()
    context = Source(
        level="context",
        kind="unknown",
        links=[
            SourceLink(url="https://example.com/context-a"),
            SourceLink(url="https://example.com/context-b"),
        ],
    )
    request_id = make_event(
        db,
        author=caller,
        title="Plain title with no match",
        status=STATUS_REQUESTED,
        lat=None,
        lng=None,
        sources=[source(f"https://t.me/{token}/1", title=f"Night {token} footage"), context],
    ).id
    for q in (f"night {token}", f"t.me/{token}"):
        response = client.get("/api/v1/search", params={"q": q, "type": "event"})
        assert response.status_code == 200
        assert [h["id"] for h in _grouped(response.json())["requests"]] == [str(request_id)], q


def test_a_source_match_still_obeys_the_filters(db, caller, other_author, free_tag):
    """A hit on a source title or URL is narrowed by the filters like a title hit: the author,
    the tag on a source, and the source kind."""
    token = _unique_token()
    mine = make_event(
        db,
        author=caller,
        title="Mine",
        sources=[
            source(
                f"https://t.me/{token}/1", title=f"Thermal {token}", kind="drone", tags=[free_tag]
            )
        ],
    )
    theirs = make_event(
        db,
        author=other_author,
        title="Theirs",
        sources=[source(f"https://t.me/{token}/2", title=f"Thermal {token}", kind="smartphone")],
    )
    ids = [mine.id, theirs.id]

    def hits(**params) -> list[str]:
        response = client.get("/api/v1/search", params={"type": "event", **params})
        assert response.status_code == 200, response.text
        return sorted(h["id"] for h in _grouped(response.json())["geolocations"])

    assert hits(q=f"thermal {token}") == sorted(str(i) for i in ids)
    for q in (f"thermal {token}", f"t.me/{token}"):
        assert hits(q=q, author=caller.username) == [str(ids[0])], q
        assert hits(q=q, tag=free_tag.name) == [str(ids[0])], q
        assert hits(q=q, source_kind="smartphone") == [str(ids[1])], q


@pytest.mark.parametrize("status", [STATUS_GEOLOCATED, STATUS_REQUESTED])
def test_search_excludes_soft_deleted_events(db, caller, status):
    token = _unique_token()
    make_event(db, author=caller, title=f"Soft-deleted {token}", status=status, deleted=True)
    response = client.get(f"/api/v1/search?q={token}&type=event")
    assert response.status_code == 200
    assert response.json()["hits"] == []


def test_search_matches_request_by_title(db, caller):
    token = _unique_token()
    request = make_event(
        db,
        author=caller,
        title=f"Request {token} — please geolocate",
        status=STATUS_REQUESTED,
        lat=None,
        lng=None,
        with_media=True,
    )
    response = client.get(f"/api/v1/search?q={token}&type=event")
    assert response.status_code == 200
    body = _grouped(response.json())
    assert len(body["requests"]) == 1
    hit = body["requests"][0]
    assert hit["id"] == str(request.id)
    assert hit["status"] == STATUS_REQUESTED
    assert hit["is_graphic"] is False
    assert f"{HIGHLIGHT_START}{token}{HIGHLIGHT_STOP}" in hit["title_highlight"]


def test_search_hits_carry_the_graphic_flag(db, caller):
    """Both result groups report the graphic flag, true when any source is graphic."""
    token = _unique_token()
    make_event(
        db,
        author=caller,
        title=f"Graphic {token} aftermath",
        sources=[
            source("https://example.com/post-graphic"),
            source("https://example.com/post-graphic-2", is_graphic=True),
        ],
    )
    make_event(
        db,
        author=caller,
        title=f"Graphic {token} request",
        status=STATUS_REQUESTED,
        lat=None,
        lng=None,
        is_graphic=True,
    )
    response = client.get(f"/api/v1/search?q={token}")
    assert response.status_code == 200
    body = _grouped(response.json())
    assert [hit["is_graphic"] for hit in body["geolocations"]] == [True]
    assert [hit["is_graphic"] for hit in body["requests"]] == [True]


def test_search_matches_user_by_username(make_user):
    # Postgres' simple parser matches whole tokens, so the username is the bare token.
    token = _unique_token()
    user = make_user(username=token)
    response = client.get(f"/api/v1/search?q={token}&type=user")
    assert response.status_code == 200
    body = _grouped(response.json())
    assert len(body["users"]) == 1
    hit = body["users"][0]
    assert hit["id"] == str(user.id)
    assert token in hit["username_highlight"]
    assert hit["bio_highlight"] is None


def test_search_matches_user_by_bio_with_highlighted_snippet(make_user):
    token = _unique_token()
    user = make_user(
        bio=(
            f"Long bio with the {token} marker embedded in the middle of a "
            "longer sentence so the ts_headline fragment selector has "
            "something to cut around."
        ),
    )
    response = client.get(f"/api/v1/search?q={token}&type=user")
    assert response.status_code == 200
    hits = _grouped(response.json())["users"]
    assert any(h["id"] == str(user.id) for h in hits)
    hit = next(h for h in hits if h["id"] == str(user.id))
    assert hit["bio_highlight"] is not None
    assert f"{HIGHLIGHT_START}{token}{HIGHLIGHT_STOP}" in hit["bio_highlight"]


def test_search_excludes_soft_deleted_users(make_user):
    token = _unique_token()
    make_user(username=token, deleted_at=datetime.now(UTC))
    response = client.get(f"/api/v1/search?q={token}&type=user")
    assert _grouped(response.json())["users"] == []


@pytest.fixture
def seed_collection(db, caller):
    """Open a collection, optionally with one showable event on it; it goes with its owner.

    The item's title carries no test token, so it stays out of the geolocations group.
    """

    def _make(title, description, *, owner=None, empty=False, hidden=False):
        collection = Collection(
            owner_id=(owner or caller).id,
            title=title,
            hidden_at=datetime.now(UTC) if hidden else None,
            **collection_description(description),
        )
        db.add(collection)
        db.flush()
        collection_id = collection.id
        if not empty:
            item = make_event(db, author=owner or caller, title=f"Item {uuid.uuid4().hex[:8]}")
            db.add(CollectionEvent(collection_id=collection_id, event_id=item.id))
        db.commit()
        return collection_id

    return _make


def test_search_matches_collection_by_title(caller, seed_collection):
    """A title hit returns the full collection card payload."""
    token = _unique_token()
    collection_id = seed_collection(f"Sites around {token}", "What this one holds.")
    response = client.get(f"/api/v1/search?q={token}&type=collection")
    assert response.status_code == 200
    body = _grouped(response.json())
    assert [hit["id"] for hit in body["collections"]] == [str(collection_id)]
    hit = body["collections"][0]
    assert hit["owner"]["username"] == caller.username
    assert hit["event_count"] == 1
    assert hit["description_text"] == "What this one holds."


def test_search_matches_collection_by_description(caller, seed_collection):
    """The index covers the description's plain-text projection."""
    token = _unique_token()
    collection_id = seed_collection("A plain name", f"Everything about {token}.")
    response = client.get(f"/api/v1/search?q={token}&type=collection")
    assert [hit["id"] for hit in _grouped(response.json())["collections"]] == [str(collection_id)]


def test_search_matches_a_word_the_description_only_bolds(db, caller, seed_collection):
    """The index reads the projection, not the HTML, so marked runs are findable."""
    token = _unique_token()
    collection_id = seed_collection("A plain name", "Placeholder.")
    collection = db.query(Collection).filter(Collection.id == collection_id).one()
    collection.description = f"<p><strong>{token}</strong></p>"
    collection.description_text = token
    db.commit()

    response = client.get(f"/api/v1/search?q={token}&type=collection")
    assert [hit["id"] for hit in _grouped(response.json())["collections"]] == [str(collection_id)]


def test_search_excludes_hidden_collections(caller, seed_collection):
    """A withheld collection is out of search."""
    token = _unique_token()
    seed_collection(f"Withheld {token}", "Taken down.", hidden=True)
    response = client.get(f"/api/v1/search?q={token}&type=collection")
    assert _grouped(response.json())["collections"] == []


def test_search_excludes_empty_collections(caller, seed_collection):
    """A collection with nothing showable on it stays out, as on a profile."""
    token = _unique_token()
    seed_collection(f"Nothing on it {token}", "Still scaffolding.", empty=True)
    response = client.get(f"/api/v1/search?q={token}&type=collection")
    assert _grouped(response.json())["collections"] == []


def test_author_filter_narrows_collections_to_that_owner(db, caller, other_author, seed_collection):
    """``author`` narrows the collections to that owner rather than leaving them out."""
    token = _unique_token()
    mine = seed_collection(f"Mine {token}", "Owned by the caller.")
    seed_collection(f"Theirs {token}", "Owned by somebody else.", owner=other_author)
    response = client.get(f"/api/v1/search?q={token}&author={caller.username}")
    body = _grouped(response.json())
    assert [hit["id"] for hit in body["collections"]] == [str(mine)]


def test_an_event_filter_leaves_the_collections_out(caller, seed_collection):
    """A filter a collection has no reading of leaves the collections out; ``status`` narrows
    the events alone."""
    token = _unique_token()
    shelf = seed_collection(f"Shelf {token}", "One shelf.")
    response = client.get(f"/api/v1/search?q={token}&conflict=Yemen")
    assert _grouped(response.json())["collections"] == []
    response = client.get(f"/api/v1/search?q={token}&status=geolocated")
    assert [c["id"] for c in _grouped(response.json())["collections"]] == [str(shelf)]


def test_tag_filter_narrows_the_collections_group(db, free_tag, caller, seed_collection):
    """A collection's tags are its items' and their sources', so a tag keeps the collections
    holding one, in a search and in browse mode."""
    token = _unique_token()
    on_event = seed_collection(f"Event tag {token}", "One shelf.")
    on_source = seed_collection(f"Source tag {token}", "One shelf.")
    untagged = seed_collection(f"No tag {token}", "One shelf.")

    def item(collection_id):
        event_id = db.query(CollectionEvent.event_id).filter_by(collection_id=collection_id)
        return db.query(Event).filter(Event.id == event_id.scalar_subquery()).one()

    event_tagged, source_tagged = item(on_event), item(on_source)
    event_tagged.tags.append(free_tag)
    source_tagged.sources[0].tags.append(free_tag)
    db.commit()
    for q in (token, ""):
        body = _grouped(
            client.get(
                "/api/v1/search", params={"q": q, "type": "collection", "tag": free_tag.name}
            ).json()
        )
        ids = {c["id"] for c in body["collections"]}
        assert ids >= {str(on_event), str(on_source)}
        assert str(untagged) not in ids


def test_browse_lists_the_authors_collections_newest_first(caller, seed_collection):
    """Empty query plus ``author`` browses that analyst's collections (the profile "Show more")."""
    token = _unique_token()
    older = seed_collection(f"Older {token}", "Shelved first.")
    newer = seed_collection(f"Newer {token}", "Shelved second.")
    response = client.get(f"/api/v1/search?type=collection&author={caller.username}")
    assert response.status_code == 200
    body = _grouped(response.json())
    assert [hit["id"] for hit in body["collections"]] == [str(newer), str(older)]
    assert body["collections"][0]["event_count"] == 1


def test_browse_excludes_hidden_and_empty_collections(caller, seed_collection):
    """Browse applies the same visibility and non-empty predicates as a typed query."""
    token = _unique_token()
    shown = seed_collection(f"Shown {token}", "Holds something.")
    seed_collection(f"Withheld {token}", "Taken down.", hidden=True)
    seed_collection(f"Bare {token}", "Still scaffolding.", empty=True)
    response = client.get(f"/api/v1/search?type=collection&author={caller.username}")
    body = _grouped(response.json())
    assert [hit["id"] for hit in body["collections"]] == [str(shown)]


def test_browse_without_an_author_leaves_the_group_empty(caller, seed_collection):
    """An empty query with no author (or a filter a collection has no reading of) answers with
    nothing."""
    token = _unique_token()
    seed_collection(f"Shelf {token}", "One shelf.")
    assert _grouped(client.get("/api/v1/search?type=collection").json())["collections"] == []
    filtered = _grouped(
        client.get(f"/api/v1/search?type=collection&author={caller.username}&media=video").json()
    )
    assert filtered["collections"] == []


def test_typed_query_still_narrows_within_an_author(caller, seed_collection):
    """The text predicate applies alongside ``author``."""
    token = _unique_token()
    wanted = seed_collection(f"Kupiansk {token}", "The eastern approach.")
    seed_collection(f"Kherson {token}", "The river bank.")
    response = client.get(
        f"/api/v1/search?q=Kupiansk {token}&type=collection&author={caller.username}"
    )
    body = _grouped(response.json())
    assert [hit["id"] for hit in body["collections"]] == [str(wanted)]


def test_collection_fts_query_uses_the_gin_index(db):
    """The ORM tsvector must match the migration's GIN index expression, or it silently seq-scans."""
    from sqlalchemy import func as safunc
    from sqlalchemy import text as satext

    from app.services import search as search_service

    tsquery = safunc.plainto_tsquery(search_service._TS_CONFIG, "depot")
    stmt = db.query(Collection.id).filter(search_service._collection_tsvector().op("@@")(tsquery))
    compiled = stmt.statement.compile(db.get_bind(), compile_kwargs={"literal_binds": True})
    db.execute(satext("SET enable_seqscan = off"))
    try:
        plan = "\n".join(row[0] for row in db.execute(satext(f"EXPLAIN {compiled}")))
    finally:
        db.execute(satext("RESET enable_seqscan"))
    assert "ix_collections_search_fts" in plan, plan


def test_search_type_all_returns_every_group(db, caller, make_user, seed_collection, seed_org):
    token = _unique_token()
    geo = make_event(db, author=caller, title=f"Geo {token} unique-token row")
    request = make_event(
        db,
        author=caller,
        title=f"Request {token} unique-token row",
        status=STATUS_REQUESTED,
        lat=None,
        lng=None,
        with_media=True,
    )
    user = make_user(username=token)
    org_id = seed_org(name=f"Org {token}")
    collection_id = seed_collection(f"Shelf {token}", "One shelf.")
    response = client.get(f"/api/v1/search?q={token}")
    assert response.status_code == 200
    raw = response.json()
    body = _grouped(raw)
    assert [h["id"] for h in body["geolocations"]] == [str(geo.id)]
    assert [h["id"] for h in body["requests"]] == [str(request.id)]
    assert [h["id"] for h in body["users"]] == [str(user.id)]
    assert [h["id"] for h in body["collections"]] == [str(collection_id)]
    assert [h["id"] for h in body["organizations"]] == [str(org_id)]
    assert raw["total"] == 5
    assert raw["query"] == token
    # The analyst the query names exactly leads the list.
    assert raw["hits"][0]["id"] == str(user.id)


def test_search_limit_caps_the_page(db, caller):
    """The limit survives the rank-then-hydrate pipeline."""
    token = _unique_token()
    for i in range(4):
        make_event(
            db,
            author=caller,
            title=f"Request {token} number {i}",
            status=STATUS_REQUESTED,
            lat=None,
            lng=None,
            with_media=True,
        )
    response = client.get(f"/api/v1/search?q={token}&type=event&limit=2")
    assert response.status_code == 200
    body = response.json()
    assert len(body["hits"]) == 2
    # ``total`` is the pre-LIMIT count, not len(array).
    assert body["total"] == 4


def _walk(params: str, limit: int) -> tuple[list[str], list[int]]:
    """Follow ``cursor`` to the end; return the hit ids in order and each page's total."""
    response = client.get(f"/api/v1/search?{params}&limit={limit}")
    assert response.status_code == 200
    body = response.json()
    ids = [h["id"] for h in body["hits"]]
    totals = [body["total"]]
    while body["cursor"] is not None:
        response = client.get(f"/api/v1/search?{params}&limit={limit}&cursor={body['cursor']}")
        assert response.status_code == 200
        body = response.json()
        assert body["hits"], "a cursor never leads to an empty page"
        ids += [h["id"] for h in body["hits"]]
        totals.append(body["total"])
    return ids, totals


def test_cursor_walks_every_ranked_match_once(db, caller):
    """Pages follow rank, then newest first, and never repeat or skip a row, ties included."""
    token = _unique_token()
    # Two rank levels: the token twice outranks it once; each level ties on rank.
    titles = [f"{token} {token} strike"] * 3 + [f"{token} strike"] * 4
    ids = [make_event(db, author=caller, title=title).id for title in titles]
    walked, totals = _walk(f"q={token}", limit=2)
    assert totals == [7] * 4
    assert sorted(walked) == sorted(str(i) for i in ids)
    # Within a rank level the newest comes first; seeding order is creation order.
    assert walked == [str(i) for i in reversed(ids[:3])] + [str(i) for i in reversed(ids[3:])]


def test_cursor_walks_one_order_across_types(db, caller, seed_collection, seed_site, seed_org):
    """Every type ranks on its own text with one ``ts_rank``, and ties fall to the newest, so a
    walk one hit at a time reads the same order as a single page."""
    token = _unique_token()
    geo = make_event(db, author=caller, title=f"{token} strike").id
    site = seed_site(f"{token} depot")
    collection = seed_collection(f"{token} shelf", "Plain words.")
    org = seed_org(name=f"{token} watch")
    page = client.get(f"/api/v1/search?q={token}&limit=50").json()
    one_page = [h["id"] for h in page["hits"]]
    assert sorted(one_page) == sorted(str(i) for i in (geo, site, collection, org))
    walked, totals = _walk(f"q={token}", limit=1)
    assert walked == one_page
    assert totals == [4] * 4


def test_cursor_walks_a_filtered_browse(db, caller):
    """With an empty query the walk is newest first over the filtered view."""
    ids = [make_event(db, author=caller, title=f"Browse {i}").id for i in range(5)]
    walked, totals = _walk(f"author={caller.username}&type=event", limit=2)
    assert totals == [5] * 3
    assert walked == [str(i) for i in reversed(ids)]


def test_cursor_is_none_on_a_single_page(db, caller):
    token = _unique_token()
    geo = make_event(db, author=caller, title=f"Lone {token}").id
    body = client.get(f"/api/v1/search?q={token}&limit=1").json()
    assert [h["id"] for h in body["hits"]] == [str(geo)]
    assert body["cursor"] is None


def _raw_cursor(parts: list) -> str:
    return base64.urlsafe_b64encode(json.dumps(parts).encode()).decode().rstrip("=")


@pytest.mark.parametrize(
    "cursor",
    [
        "garbage",
        _raw_cursor(["0.1"]),
        _raw_cursor(["nan", "2026-05-01T00:00:00+00:00", str(uuid.UUID(int=1))]),
        _raw_cursor(["high", "2026-05-01T00:00:00+00:00", str(uuid.UUID(int=1))]),
    ],
)
def test_malformed_cursor_returns_422(cursor):
    response = client.get(f"/api/v1/search?q=x&type=event&cursor={cursor}")
    assert response.status_code == 422
    assert response.json()["detail"] == "cursor is malformed"


def test_search_strips_planted_sentinel_bytes_from_bio(make_user):
    """A bio planting STX/ETX must not break the highlight's marker parity.

    The SQL wraps every ``ts_headline`` document in ``translate(col, chr(2) || chr(3), '')``.
    """
    token = _unique_token()
    user = make_user(bio=f"hostile \x02fake-start\x03 prefix then real {token} match")
    response = client.get(f"/api/v1/search?q={token}&type=user")
    assert response.status_code == 200
    hit = next(h for h in _grouped(response.json())["users"] if h["id"] == str(user.id))
    bio_hl = hit["bio_highlight"]
    assert bio_hl is not None
    assert bio_hl.count(HIGHLIGHT_START) == bio_hl.count(HIGHLIGHT_STOP)
    assert f"{HIGHLIGHT_START}{token}{HIGHLIGHT_STOP}" in bio_hl
    # Only the marker bytes are stripped, not the user's words.
    assert "fake-start" in bio_hl


def test_search_strips_planted_sentinel_bytes_from_title(db, caller):
    """The same sentinel stripping applies to geolocation and request titles."""
    token = _unique_token()
    geo_id = make_event(db, author=caller, title=f"planted \x02bad\x03 then {token} fragment").id
    response = client.get(f"/api/v1/search?q={token}&type=event")
    assert response.status_code == 200
    hit = next(h for h in _grouped(response.json())["geolocations"] if h["id"] == str(geo_id))
    th = hit["title_highlight"]
    assert th.count(HIGHLIGHT_START) == th.count(HIGHLIGHT_STOP)
    assert f"{HIGHLIGHT_START}{token}{HIGHLIGHT_STOP}" in th


@pytest.fixture
def other_author(make_user):
    return make_user("otherauth")


def test_author_filter_scopes_event_groups_and_empties_users(db, caller, other_author):
    token = _unique_token()
    mine = make_event(db, author=caller, title=f"Strike {token} east").id
    make_event(db, author=other_author, title=f"Strike {token} west")
    response = client.get(f"/api/v1/search?q={token}&author={caller.username}")
    assert response.status_code == 200
    body = _grouped(response.json())
    assert [h["id"] for h in body["geolocations"]] == [str(mine)]
    # Otherwise the caller's username would match itself.
    assert body["users"] == []


def test_author_with_empty_query_browses_the_authors_view(db, caller, other_author):
    token = _unique_token()
    older = make_event(db, author=caller, title=f"First {token}").id
    newer = make_event(db, author=caller, title=f"Second {token}").id
    noise = make_event(db, author=other_author, title=f"Noise {token}").id
    request_id = make_event(
        db, author=caller, title=f"Where is {token}", status=STATUS_REQUESTED, lat=None, lng=None
    ).id
    response = client.get(f"/api/v1/search?author={caller.username}")
    assert response.status_code == 200
    body = _grouped(response.json())
    geo_ids = [h["id"] for h in body["geolocations"]]
    assert geo_ids.index(str(newer)) < geo_ids.index(str(older))
    assert str(noise) not in geo_ids
    # Without an FTS predicate the plain title is the highlight.
    newest = next(h for h in body["geolocations"] if h["id"] == str(newer))
    assert newest["title_highlight"] == newest["title"]
    assert HIGHLIGHT_START not in newest["title_highlight"]
    # The requested view rides the same scope.
    assert str(request_id) in [h["id"] for h in body["requests"]]


def test_author_unknown_returns_an_empty_list():
    response = client.get("/api/v1/search?author=no-such-analyst-here")
    assert response.status_code == 200
    assert response.json()["hits"] == []


def test_author_rejects_malformed_username():
    response = client.get("/api/v1/search?q=x&author=bad%20name%21")
    assert response.status_code == 422


def test_conflict_filter_scopes_search(db, conflict, caller):
    token = _unique_token()
    tagged = make_event(db, author=caller, title=f"Tagged {token}", conflicts=[conflict]).id
    make_event(db, author=caller, title=f"Untagged {token}")
    response = client.get(f"/api/v1/search?q={token}&conflict={conflict.name}")
    assert response.status_code == 200
    body = _grouped(response.json())
    assert [h["id"] for h in body["geolocations"]] == [str(tagged)]
    assert body["users"] == []


def test_event_date_filter_scopes_search_and_browses(db, caller):
    token = _unique_token()
    inside = make_event(db, author=caller, title=f"Inside {token}").id
    outside = make_event(db, author=caller, title=f"Outside {token}").id
    db.query(Event).filter(Event.id == outside).update({"occurred_date": date(2020, 1, 1)})
    db.commit()
    response = client.get(f"/api/v1/search?q={token}&occurred_date_from=2026-01-01")
    ids = [h["id"] for h in _grouped(response.json())["geolocations"]]
    assert str(inside) in ids and str(outside) not in ids
    # The date window alone is an active filter in browse mode.
    response = client.get(f"/api/v1/search?author={caller.username}&occurred_date_from=2026-01-01")
    ids = [h["id"] for h in _grouped(response.json())["geolocations"]]
    assert str(inside) in ids and str(outside) not in ids


def test_status_filter_scopes_search(db, caller):
    """`?status=` narrows the event groups; an unknown value 422s."""
    token = _unique_token()
    make_event(db, author=caller, title=f"Located {token}")
    detected = make_event(db, author=caller, title=f"Detected {token}").id
    db.query(Event).filter(Event.id == detected).update(
        {
            "status": STATUS_DETECTED,
            "version_no": 0,
            "detected_at": datetime.now(UTC),
            "geolocated_at": None,
        }
    )
    db.commit()
    response = client.get(f"/api/v1/search?q={token}&status=detected")
    assert response.status_code == 200
    body = _grouped(response.json())
    assert [h["id"] for h in body["geolocations"]] == [str(detected)]
    assert body["users"] == []

    response = client.get(f"/api/v1/search?q={token}&status=hallucinated")
    assert response.status_code == 422


def test_garbage_date_filter_returns_422():
    response = client.get("/api/v1/search?q=x&occurred_date_from=not-a-date")
    assert response.status_code == 422


def test_garbage_media_filter_returns_422():
    response = client.get("/api/v1/search?q=x&media=hologram")
    assert response.status_code == 422


def test_author_suggestions_substring_prefix_first(db, caller, other_author):
    """Substring match, prefix matches first. Only analysts owning a live event are suggested,
    which keeps the anonymous endpoint from being an account-enumeration oracle."""
    make_event(db, author=caller, title=f"Suggestable {_unique_token()}")
    fragment = caller.username[:6]  # "caller" prefix shared by the fixture pool
    response = client.get(f"/api/v1/search/authors?q={fragment}")
    assert response.status_code == 200
    authors = response.json()["authors"]
    assert caller.username in authors
    assert other_author.username not in authors
    mid = caller.username[2:8]
    response = client.get(f"/api/v1/search/authors?q={mid}")
    assert caller.username in response.json()["authors"]
    # The enumeration guard holds even on an exact username probe.
    response = client.get(f"/api/v1/search/authors?q={other_author.username}")
    assert response.json()["authors"] == []


def test_author_suggestions_exclude_soft_deleted(db, caller):
    from datetime import UTC as _UTC
    from datetime import datetime as _dt

    make_event(db, author=caller, title=f"Deleted owner {_unique_token()}")
    caller.deleted_at = _dt.now(_UTC)
    db.commit()
    response = client.get(f"/api/v1/search/authors?q={caller.username}")
    assert response.status_code == 200
    assert caller.username not in response.json()["authors"]


def test_author_suggestions_empty_and_invalid_q():
    assert client.get("/api/v1/search/authors?q=").json()["authors"] == []
    assert client.get("/api/v1/search/authors?q=bad%20name%21").status_code == 422


def test_author_filter_is_exact_on_search(db, caller):
    """`?author=` on /search matches exactly, never a fragment sweep."""
    token = _unique_token()
    geo = make_event(db, author=caller, title=f"Exact {token}").id
    fragment = caller.username[:6]
    response = client.get(f"/api/v1/search?q={token}&author={fragment}")
    assert response.status_code == 200
    assert _grouped(response.json())["geolocations"] == []
    response = client.get(f"/api/v1/search?q={token}&author={caller.username.upper()}")
    assert [h["id"] for h in _grouped(response.json())["geolocations"]] == [str(geo)]


def test_a_handle_in_the_query_matches_the_analysts_credited_events(db, caller, other_author):
    """Regression: an analyst's handle found their profile but none of their work, and a handle
    beside another word matched nothing at all."""
    token = _unique_token()
    mine = make_event(db, author=caller, title=f"Strike {token} east").id
    untitled = make_event(db, author=caller, title="Convoy at the bridge").id
    make_event(db, author=other_author, title=f"Strike {token} west")
    body = _grouped(
        client.get("/api/v1/search", params={"q": f"@{caller.username.upper()}"}).json()
    )
    assert {h["id"] for h in body["geolocations"]} == {str(mine), str(untitled)}
    assert [u["username"] for u in body["users"]] == [caller.username]

    body = _grouped(client.get("/api/v1/search", params={"q": f"{token} {caller.username}"}).json())
    assert [h["id"] for h in body["geolocations"]] == [str(mine)]
    assert f"{HIGHLIGHT_START}{token}{HIGHLIGHT_STOP}" in body["geolocations"][0]["title_highlight"]
    assert [u["username"] for u in body["users"]] == [caller.username]


def test_browse_mode_strips_planted_sentinel_bytes_from_title(db, caller):
    """Browse mode (plain title as highlight) strips planted STX/ETX like the ts_headline branch."""
    token = _unique_token()
    geo = make_event(
        db, author=caller, title=f"Planted {HIGHLIGHT_START}fake{HIGHLIGHT_STOP} {token}"
    ).id
    response = client.get(f"/api/v1/search?author={caller.username}")
    assert response.status_code == 200
    hit = next(h for h in _grouped(response.json())["geolocations"] if h["id"] == str(geo))
    assert HIGHLIGHT_START not in hit["title_highlight"]
    assert HIGHLIGHT_STOP not in hit["title_highlight"]


def _geo_ids(**params) -> list[str]:
    response = client.get("/api/v1/search", params={"type": "event", "limit": 50, **params})
    assert response.status_code == 200, response.text
    return [h["id"] for h in _grouped(response.json())["geolocations"]]


def test_the_query_takes_phrases_or_and_exclusions(db, caller):
    """Quotes ask for a phrase, `OR` for either word and `-word` excludes an event whose title
    or source title holds the word: the syntax of a web search engine."""
    token = _unique_token()
    other = _unique_token()
    centre = make_event(db, author=caller, title=f"Strike on {token} city centre").id
    apart = make_event(db, author=caller, title=f"{token} shelled, smoke over the city").id
    drone = make_event(db, author=caller, title=f"Drone over {token} city").id
    sourced = make_event(
        db,
        author=caller,
        title=f"{token} convoy",
        sources=[source("https://example.com/post-a", title="FPV drone footage")],
    ).id
    spelled = make_event(db, author=caller, title=f"Artillery in {other}").id
    ids = [centre, apart, drone, sourced, spelled]
    assert set(_geo_ids(q=f'"{token} city"')) == {str(centre), str(drone)}
    assert set(_geo_ids(q=f"{token} -drone")) == {str(centre), str(apart)}
    assert set(_geo_ids(q=f"{token} OR {other}")) == {str(i) for i in ids}


def test_the_last_word_matches_as_a_prefix_while_typing(db, caller, seed_collection):
    """A word still being typed finds the events, the analyst and the collection it begins, and
    a whole word ranks above a longer word it only begins."""
    token = _unique_token()
    longer = make_event(db, author=caller, title=f"Shelling near {token}ka").id
    whole = make_event(db, author=caller, title=f"Shelling near {token}").id
    collection_id = seed_collection(f"Front of {token}ka", "What this one holds.")
    body = _grouped(client.get("/api/v1/search", params={"q": f"shelling {token[:-2]}"}).json())
    assert {h["id"] for h in body["geolocations"]} == {str(whole), str(longer)}
    body = _grouped(client.get("/api/v1/search", params={"q": token}).json())
    assert [h["id"] for h in body["geolocations"]] == [str(whole), str(longer)]
    assert [c["id"] for c in body["collections"]] == [str(collection_id)]
    users = client.get("/api/v1/search", params={"q": caller.username[:-3], "type": "user"})
    assert [u["username"] for u in _grouped(users.json())["users"]] == [caller.username]
    for q in (f'"{token[:-2]}"', f"{token[:-2]} -x", token[:2]):
        assert _geo_ids(q=q) == [], q


def test_accents_fold_on_both_sides(db, caller):
    """`cafe` finds `Café` and `Hézbollah` finds `Hezbollah`, in titles, bios and highlights."""
    token = _unique_token()
    cafe = make_event(db, author=caller, title=f"Strike on the Café {token}").id
    hezbollah = make_event(db, author=caller, title=f"Hezbollah position {token}").id
    caller.bio = f"Géolocalisation {token}"
    db.commit()
    body = _grouped(client.get("/api/v1/search", params={"q": f"cafe {token}"}).json())
    assert [h["id"] for h in body["geolocations"]] == [str(cafe)]
    assert f"{HIGHLIGHT_START}Café{HIGHLIGHT_STOP}" in body["geolocations"][0]["title_highlight"]
    assert _geo_ids(q=f"Hézbollah {token}") == [str(hezbollah)]
    users = _grouped(client.get("/api/v1/search", params={"q": f"geolocalisation {token}"}).json())
    assert [u["username"] for u in users["users"]] == [caller.username]


def test_a_search_that_finds_nothing_suggests_the_closest_spelling(db, caller, make_user):
    """A transliteration or a typo the catalogue does not hold is respelled to its closest word,
    a handle as its analyst spells it, and only when the respelling finds results."""
    place = f"Novohrodivka{uuid.uuid4().hex[:4]}"
    make_event(db, author=caller, title=f"Strike near {place}")
    handle = f"KharkivWatch{uuid.uuid4().hex[:4]}"
    make_user(username=handle)

    def suggestion(q: str, **params) -> str | None:
        response = client.get("/api/v1/search", params={"q": q, **params})
        assert response.status_code == 200, response.text
        return response.json()["suggestion"]

    typo = place.replace("hrod", "grod")
    assert suggestion(f"strike {typo}") == f"strike {place[0]}{place[1:].lower()}"
    assert suggestion(f'"{typo}" -drone') == f'"{place}" -drone'
    assert suggestion(handle.replace("Watch", "Wach")) == handle
    assert suggestion(place) is None
    assert suggestion(typo, author=caller.username) is None
    assert suggestion("qqqzzzxxjj") is None


def test_a_short_query_skips_source_urls(db, caller):
    """Regression: a single letter matched every URL holding it. A URL matches a word of 4
    characters or more, so a pasted link still finds the events that cite it."""
    token = _unique_token()
    url = f"https://t.me/{token}/42"
    geo = make_event(db, author=caller, title="Convoy at the bridge", source_url=url).id
    assert str(geo) not in _geo_ids(q=token[:3])
    assert _geo_ids(q=token[-6:]) == [str(geo)]
    assert _geo_ids(q=url) == [str(geo)]


@pytest.fixture
def seed_org(db):
    """Create an organization; ``members`` are live users joined as members."""
    made: list[uuid.UUID] = []

    def _make(*, name: str, slug: str | None = None, bio: str | None = None, members=()):
        org = Organization(slug=slug or f"o{uuid.uuid4().hex[:12]}", name=name, bio=bio)
        db.add(org)
        db.flush()
        for user in members:
            db.add(
                OrganizationMember(
                    organization_id=org.id,
                    user_id=user.id,
                    state="active",
                    role="member",
                    joined_at=datetime.now(UTC),
                )
            )
        db.commit()
        made.append(org.id)
        return org.id

    yield _make
    db.expire_all()
    db.query(Organization).filter(Organization.id.in_(made)).delete(synchronize_session=False)
    db.commit()


def _org_hits(token: str, **params) -> dict:
    response = client.get("/api/v1/search", params={"q": token, "type": "organization", **params})
    assert response.status_code == 200
    raw = response.json()
    return {**_grouped(raw), "total": raw["total"]}


def test_search_matches_organization_by_name(caller, soft_deleted_user, seed_org):
    token = _unique_token()
    org_id = seed_org(name=f"Open {token} Collective", members=[caller, soft_deleted_user])
    body = _org_hits(token)
    assert len(body["organizations"]) == 1
    hit = body["organizations"][0]
    assert hit["id"] == str(org_id)
    assert f"{HIGHLIGHT_START}{token}{HIGHLIGHT_STOP}" in hit["name_highlight"]
    assert hit["bio_highlight"] is None
    # The soft-deleted member is not counted.
    assert hit["member_count"] == 1
    # The other groups stay empty on this scope.
    assert body["users"] == [] and body["geolocations"] == []


def test_search_matches_organization_by_slug(seed_org):
    token = _unique_token()
    org_id = seed_org(name="Unrelated name", slug=token)
    body = _org_hits(token)
    assert [h["id"] for h in body["organizations"]] == [str(org_id)]
    assert body["organizations"][0]["slug"] == token


def test_search_matches_organization_by_bio_with_highlighted_snippet(seed_org):
    token = _unique_token()
    org_id = seed_org(
        name="Some collective",
        bio=f"A group that tracks {token} sightings across the region every week.",
    )
    hit = _org_hits(token)["organizations"][0]
    assert hit["id"] == str(org_id)
    assert f"{HIGHLIGHT_START}{token}{HIGHLIGHT_STOP}" in hit["bio_highlight"]


def test_organization_hit_carries_public_fields_only(db, caller, seed_org):
    token = _unique_token()
    org_id = seed_org(name=f"Org {token}")
    org = db.get(Organization, org_id)
    org.x_handle = f"x{uuid.uuid4().hex[:8]}"
    org.created_by_id = caller.id
    org.approval_request_audience = "nobody"
    db.commit()
    hit = _org_hits(token)["organizations"][0]
    assert set(hit) == {
        "type",
        "id",
        "slug",
        "name",
        "name_highlight",
        "bio",
        "bio_highlight",
        "avatar_url",
        "member_count",
    }


def test_organization_search_caps_the_page_and_totals_before_the_cap(seed_org):
    token = _unique_token()
    for i in range(3):
        seed_org(name=f"Org {token} number {i}")
    body = _org_hits(token, limit=2)
    assert len(body["organizations"]) == 2
    assert body["total"] == 3


def test_an_event_filter_leaves_the_organizations_out(seed_org):
    token = _unique_token()
    seed_org(name=f"Org {token}")
    assert _org_hits(token, conflict="Yemen")["organizations"] == []
    assert len(_org_hits(token, status="geolocated")["organizations"]) == 1


def test_a_deleted_organization_leaves_search(db, caller, admin_user, seed_org):
    token = _unique_token()
    org_id = seed_org(name=f"Org {token}", members=[caller])
    slug = db.get(Organization, org_id).slug
    assert _org_hits(token)["total"] == 1
    deleted = client.delete(
        f"/api/v1/admin/organizations/{slug}", headers=login_as(client, admin_user)
    )
    assert deleted.status_code == 204
    assert _org_hits(token)["organizations"] == []


def test_organization_fts_query_uses_the_gin_index(db):
    """The SQL tsvector must match the migration's GIN index expression, or it seq-scans."""
    from sqlalchemy import text as satext

    from app.services import search as search_service

    db.execute(satext("SET enable_seqscan = off"))
    try:
        plan = "\n".join(
            row[0]
            for row in db.execute(
                satext(
                    "EXPLAIN SELECT id FROM organizations WHERE "
                    f"{search_service._ORGANIZATION_TSVECTOR} @@ plainto_tsquery('simple', 'depot')"
                )
            )
        )
    finally:
        db.execute(satext("RESET enable_seqscan"))
    assert "ix_organizations_search_fts" in plan, plan


@pytest.fixture
def seed_site(db, caller):
    """Create a site with one live source carrying a contour, its file and a removed source on
    request; it goes with its owner."""

    def _make(
        name: str,
        *,
        owner=None,
        kind: str = "airbase",
        source_title: str = "",
        note: str | None = None,
        removed_title: str = "",
        hidden: bool = False,
        image: bool = False,
    ) -> uuid.UUID:
        site = Site(
            owner_id=(owner or caller).id,
            name=name,
            kind=kind,
            hidden_at=datetime.now(UTC) if hidden else None,
        )
        db.add(site)
        db.flush()
        captured = datetime(2025, 1, 1, 10, 0, tzinfo=UTC)
        live = Source(
            site_id=site.id,
            kind="satellite",
            level="context",
            title=source_title,
            note=note,
            captured_at=captured,
        )
        db.add(live)
        db.flush()
        if image:
            db.add(
                Media(
                    sha256=fake_sha256(),
                    source_id=live.id,
                    storage_url=f"http://localhost:8000/sites/{site.id}.jpg",
                    kind="image",
                )
            )
        if removed_title:
            db.add(
                Source(
                    site_id=site.id,
                    kind="satellite",
                    level="context",
                    title=removed_title,
                    captured_at=captured,
                    removed_at=datetime.now(UTC),
                )
            )
        db.flush()
        square = Polygon([(30.0, 10.0), (30.01, 10.0), (30.01, 10.01), (30.0, 10.01)])
        db.add(SiteContour(site_id=site.id, source_id=live.id, zone=from_shape(square, srid=4326)))
        db.commit()
        return site.id

    return _make


def _site_ids(**params) -> list[str]:
    response = client.get("/api/v1/search", params={"type": "site", **params})
    assert response.status_code == 200
    return [hit["id"] for hit in _grouped(response.json())["sites"]]


def test_search_matches_a_site_by_name(caller, seed_site):
    token = _unique_token()
    site_id = seed_site(f"Northern {token} airfield", kind="depot", image=True)
    response = client.get(f"/api/v1/search?q={token}&type=site")
    assert response.status_code == 200
    body = _grouped(response.json())
    hit = body["sites"][0]
    assert set(hit) == {
        "type",
        "id",
        "name",
        "name_highlight",
        "kind",
        "owner",
        "last_source",
        "media",
    }
    assert hit["id"] == str(site_id)
    assert hit["kind"] == "depot"
    assert hit["owner"]["username"] == caller.username
    assert hit["last_source"]["captured_at"].startswith("2025-01-01")
    assert [m["storage_url"] for m in hit["media"]] == [
        f"http://localhost:8000/sites/{site_id}.jpg"
    ]
    assert f"{HIGHLIGHT_START}{token}{HIGHLIGHT_STOP}" in hit["name_highlight"]
    assert body["geolocations"] == [] and body["organizations"] == []


def test_a_site_without_a_file_carries_no_image(seed_site):
    token = _unique_token()
    seed_site(f"Bare {token}")
    hit = _grouped(client.get(f"/api/v1/search?q={token}").json())["sites"][0]
    assert hit["media"] == []


def test_search_matches_a_site_by_its_live_sources_title_and_note(seed_site):
    token = _unique_token()
    by_title = seed_site("Unrelated name", source_title=f"Capture of the {token} apron")
    by_note = seed_site("Another name", note=f"Two hangars at {token} are gone.")
    by_removed = seed_site("Third name", removed_title=f"Old capture of {token}")
    found = _site_ids(q=token)
    assert set(found) == {str(by_title), str(by_note)}
    assert str(by_removed) not in found


def test_a_site_name_match_ranks_above_a_source_match(seed_site):
    token = _unique_token()
    by_source = seed_site("Plain name", source_title=f"Capture of {token}")
    by_name = seed_site(f"Base {token}")
    assert _site_ids(q=token) == [str(by_name), str(by_source)]


def test_site_search_folds_accents_and_reads_the_last_word_as_a_prefix(seed_site):
    token = _unique_token()
    site_id = seed_site(f"Dépôt {token}")
    assert _site_ids(q=f"depot {token}") == [str(site_id)]
    assert _site_ids(q=f"DÉPÔT {token}") == [str(site_id)]
    assert _site_ids(q=token[:-3]) == [str(site_id)]
    assert _site_ids(q=f"{token} dep") == [str(site_id)]


def test_site_search_takes_phrases_or_and_exclusions(seed_site):
    token = _unique_token()
    north = seed_site(f"{token} north depot")
    south = seed_site(f"{token} south radar")
    assert _site_ids(q=f"{token} -north") == [str(south)]
    assert _site_ids(q=f'"{token} south"') == [str(south)]
    assert set(_site_ids(q=f"{token} north OR {token} south")) == {str(north), str(south)}


def test_hidden_sites_stay_out_of_search(caller, soft_deleted_user, seed_site):
    token = _unique_token()
    seed_site(f"Withheld {token}", hidden=True)
    seed_site(f"Orphaned {token}", owner=soft_deleted_user)
    visible = seed_site(f"Visible {token}")
    assert _site_ids(q=token) == [str(visible)]
    signed_in = client.get(
        "/api/v1/search",
        params={"q": token, "type": "site"},
        headers=login_as(client, caller),
    ).json()
    assert [hit["id"] for hit in signed_in["hits"]] == [str(visible)]
    assert signed_in["total"] == 1


@pytest.mark.parametrize(
    ("types", "groups"),
    [
        (("event",), {"geolocations"}),
        (("collection",), {"collections"}),
        (("site",), {"sites"}),
        (("site", "event"), {"sites", "geolocations"}),
        ((), {"geolocations", "collections", "sites"}),
    ],
    ids=["event", "collection", "site", "site-and-event", "every-type"],
)
def test_type_narrows_the_hits(db, caller, seed_collection, seed_site, types, groups):
    token = _unique_token()
    seeded = {
        "collections": [str(seed_collection(f"Shelf {token}", "One shelf."))],
        "sites": [str(seed_site(f"Site {token}"))],
        "geolocations": [str(make_event(db, author=caller, title=f"Event {token}").id)],
    }
    query = "".join(f"&type={type_}" for type_ in types)
    body = _grouped(client.get(f"/api/v1/search?q={token}{query}").json())
    assert {group: [hit["id"] for hit in hits] for group, hits in body.items()} == {
        group: seeded.get(group, []) if group in groups else [] for group in body
    }


def test_the_filters_narrow_the_sites_they_apply_to(caller, other_author, seed_site):
    """``author`` keeps the sites that analyst owns, also on an empty query; ``status`` narrows
    the events alone; any other event filter leaves the sites out."""
    token = _unique_token()
    mine = seed_site(f"Site {token}")
    seed_site(f"Their site {token}", owner=other_author)
    assert _site_ids(q=token, author=caller.username) == [str(mine)]
    assert str(mine) in _site_ids(author=caller.username)
    assert len(_site_ids(q=token, status="geolocated")) == 2
    assert _site_ids(q=token, conflict="Yemen") == []


def test_site_search_caps_the_page_and_totals_before_the_cap(seed_site):
    token = _unique_token()
    for i in range(3):
        seed_site(f"Site {token} number {i}")
    body = client.get(f"/api/v1/search?q={token}&type=site&limit=2").json()
    assert len(body["hits"]) == 2
    assert body["total"] == 3


def test_site_search_strips_planted_sentinel_bytes_from_the_name(seed_site):
    token = _unique_token()
    seed_site(f"Planted \x02{token}\x03 name")
    hit = _grouped(client.get(f"/api/v1/search?q={token}&type=site").json())["sites"][0]
    assert hit["name_highlight"].count(HIGHLIGHT_START) == 1
    assert f"{HIGHLIGHT_START}{token}{HIGHLIGHT_STOP}" in hit["name_highlight"]


def _sections(**params) -> dict:
    response = client.get("/api/v1/search/sections", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_sections_hold_the_top_hits_of_each_type_in_a_fixed_order(
    db, caller, seed_collection, seed_site, seed_org
):
    """Each section is the first page ``GET /search`` returns for its type alone, cursor
    included, and the sections follow the type order whatever the ranks."""
    token = _unique_token()
    geos = [make_event(db, author=caller, title=f"{token} strike {i}").id for i in range(4)]
    site = seed_site(f"{token} {token} depot")
    collection = seed_collection(f"{token} shelf", "Plain words.")
    org = seed_org(name=f"{token} watch")
    body = _sections(q=token, limit=3)
    assert [s["type"] for s in body["sections"]] == [
        "event",
        "site",
        "collection",
        "organization",
    ]
    for section in body["sections"]:
        alone = client.get(
            "/api/v1/search", params={"q": token, "type": section["type"], "limit": 3}
        ).json()
        assert section["hits"] == alone["hits"]
        assert section["total"] == alone["total"]
        assert section["cursor"] == alone["cursor"]
    events, *_ = body["sections"]
    assert len(events["hits"]) == 3
    assert events["total"] == 4
    rest = client.get(
        "/api/v1/search",
        params={"q": token, "type": "event", "limit": 3, "cursor": events["cursor"]},
    ).json()
    walked = [h["id"] for h in events["hits"] + rest["hits"]]
    assert sorted(walked) == sorted(str(i) for i in geos)
    assert [s["hits"][0]["id"] for s in body["sections"][1:]] == [
        str(site),
        str(collection),
        str(org),
    ]
    assert all(s["cursor"] is None for s in body["sections"][1:])
    assert body["query"] == token
    assert body["suggestion"] is None


def test_sections_keep_the_requests_with_the_events(db, caller):
    token = _unique_token()
    make_event(
        db, author=caller, title=f"Request {token}", status=STATUS_REQUESTED, lat=None, lng=None
    )
    make_event(db, author=caller, title=f"Geo {token}")
    (events,) = _sections(q=token)["sections"]
    assert events["type"] == "event"
    assert sorted(h["status"] for h in events["hits"]) == [STATUS_GEOLOCATED, STATUS_REQUESTED]


def test_sections_follow_the_types_and_the_filters_each_type_answers(
    db, caller, other_author, seed_collection, seed_site, seed_org
):
    token = _unique_token()
    mine = make_event(db, author=caller, title=f"{token} strike").id
    make_event(db, author=other_author, title=f"{token} strike")
    my_site = seed_site(f"{token} depot")
    seed_site(f"{token} depot", owner=other_author)
    seed_collection(f"{token} shelf", "Plain words.", owner=other_author)
    seed_org(name=f"{token} watch")
    picked = _sections(q=token, type=["site", "organization"])
    assert [s["type"] for s in picked["sections"]] == ["site", "organization"]

    # ``author`` narrows the events and the sites, keeps the collections it owns (none
    # here), and leaves the organizations out, so their sections go.
    authored = _sections(q=token, author=caller.username)
    assert [s["type"] for s in authored["sections"]] == ["event", "site"]
    assert [h["id"] for h in authored["sections"][0]["hits"]] == [str(mine)]
    assert [h["id"] for h in authored["sections"][1]["hits"]] == [str(my_site)]

    # ``status`` narrows the events alone.
    requested = _sections(q=token, status="requested")
    assert [s["type"] for s in requested["sections"]] == ["site", "collection", "organization"]

    # Any other event filter leaves every other type out.
    conflict = _sections(q=token, conflict="Yemen")
    assert conflict["sections"] == []


def test_sections_leave_out_what_search_never_lists(
    db, caller, make_user, seed_collection, seed_site
):
    token = _unique_token()
    make_event(db, author=caller, title=f"Withheld {token}", hidden=True)
    make_user(username=f"{token}gone", deleted_at=datetime.now(UTC))
    seed_site(f"{token} depot", hidden=True)
    seed_collection(f"{token} shelf", "Plain words.", hidden=True)
    seed_collection(f"{token} empty shelf", "Plain words.", empty=True)
    assert _sections(q=token)["sections"] == []


def test_sections_are_empty_without_a_query_or_a_filter():
    assert _sections(q="") == {"sections": [], "suggestion": None, "query": ""}


def test_sections_suggest_a_spelling_when_no_section_holds_a_hit(db, caller):
    place = f"Novohrodivka{uuid.uuid4().hex[:4]}"
    make_event(db, author=caller, title=f"Strike near {place}")
    typo = place.replace("hrod", "grod")
    assert _sections(q=typo)["suggestion"] == f"{place[0]}{place[1:].lower()}"
    # The Show field's status narrows the respelling's check, and keeps the suggestion.
    assert _sections(q=typo, status="geolocated")["suggestion"] is not None
    assert _sections(q=typo, status="requested")["suggestion"] is None
    assert _sections(q=place)["suggestion"] is None


@pytest.mark.parametrize("params", [{"type": "bogus"}, {"limit": 0}, {"limit": 11}])
def test_sections_refuse_a_value_outside_its_domain(params):
    response = client.get("/api/v1/search/sections", params={"q": "x", **params})
    assert response.status_code == 422


def test_has_coords_narrows_the_events_and_leaves_the_other_types_out(
    db, caller, seed_collection, seed_site
):
    """The located rows always carry a point, so ``has_coords=false`` keeps the blind requests.
    No other type answers it, so the sites and collections go, in both search reads."""
    token = _unique_token()
    located = make_event(db, author=caller, title=f"Located {token}").id
    guessed = make_event(db, author=caller, title=f"Guessed {token}", status=STATUS_REQUESTED).id
    blind = make_event(
        db, author=caller, title=f"Blind {token}", status=STATUS_REQUESTED, lat=None, lng=None
    ).id
    seed_site(f"{token} depot")
    seed_collection(f"{token} shelf", "Plain words.")

    def hits(**params) -> list[tuple[str, str]]:
        response = client.get("/api/v1/search", params={"q": token, **params})
        assert response.status_code == 200, response.text
        return sorted((h["type"], h["id"]) for h in response.json()["hits"])

    assert {type_ for type_, _ in hits()} == {"event", "site", "collection"}
    assert hits(has_coords="false") == [("event", str(blind))]
    assert hits(has_coords="true") == sorted([("event", str(located)), ("event", str(guessed))])

    sections = _sections(q=token, has_coords="false")["sections"]
    assert [s["type"] for s in sections] == ["event"]
    assert [h["id"] for h in sections[0]["hits"]] == [str(blind)]

    # Alone, it is an active filter: the empty query browses.
    browsed = client.get(
        "/api/v1/search", params={"has_coords": "false", "type": "event", "limit": 50}
    ).json()
    assert str(blind) in [h["id"] for h in browsed["hits"]]
    assert str(located) not in [h["id"] for h in browsed["hits"]]


def _dates(**params) -> dict:
    response = client.get("/api/v1/search/dates", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _days(*pairs: tuple[str, int]) -> list[dict]:
    return [{"date": day, "count": count} for day, count in pairs]


@pytest.fixture
def dated_events(db, caller):
    """Four events matching one token on known days, and one matching another token."""
    token, other = _unique_token(), _unique_token()
    seeded = {
        "a": make_event(db, author=caller, title=f"Strike {token} a").id,
        "b": make_event(db, author=caller, title=f"Strike {token} b").id,
        "c": make_event(db, author=caller, title=f"Strike {token} c").id,
        "r": make_event(
            db,
            author=caller,
            title=f"Where is {token}",
            status=STATUS_REQUESTED,
            lat=None,
            lng=None,
        ).id,
        "other": make_event(db, author=caller, title=f"Strike {other}").id,
    }
    days = {
        # 23:30 UTC stays on the 11th: the submitted day is the UTC day.
        "a": (date(2024, 1, 10), datetime(2024, 1, 11, 23, 30, tzinfo=UTC)),
        "b": (date(2024, 1, 10), datetime(2024, 2, 1, 8, 0, tzinfo=UTC)),
        "c": (None, datetime(2024, 2, 1, 9, 0, tzinfo=UTC)),
        "r": (date(2024, 3, 5), datetime(2024, 3, 6, 12, 0, tzinfo=UTC)),
        "other": (date(2024, 1, 10), datetime(2024, 1, 11, 12, 0, tzinfo=UTC)),
    }
    for key, (occurred, created) in days.items():
        db.query(Event).filter(Event.id == seeded[key]).update(
            {"occurred_date": occurred, "created_at": created}
        )
    db.commit()
    return token, other


def test_search_dates_count_the_listed_events_per_day(dated_events):
    token, other = dated_events
    assert _dates(q=token) == {
        "occurred_date": _days(("2024-01-10", 2), ("2024-03-05", 1)),
        "submitted": _days(("2024-01-11", 1), ("2024-02-01", 2), ("2024-03-06", 1)),
        "total": 4,
    }
    assert _dates(q=other) == {
        "occurred_date": _days(("2024-01-10", 1)),
        "submitted": _days(("2024-01-11", 1)),
        "total": 1,
    }
    assert _dates(q=token, status="requested") == {
        "occurred_date": _days(("2024-03-05", 1)),
        "submitted": _days(("2024-03-06", 1)),
        "total": 1,
    }


def test_search_dates_total_keeps_both_windows(dated_events):
    """``total`` counts the listed events under every filter: unlike the axes, it keeps each
    window, and an event without an occurred date falls out of an event date window."""
    token, _ = dated_events
    assert _dates(q=token, occurred_date_from="2024-01-01")["total"] == 3
    assert _dates(q=token, submitted_from="2024-02-01")["total"] == 3
    assert (
        _dates(q=token, occurred_date_from="2024-01-01", submitted_from="2024-02-01")["total"] == 2
    )


def test_search_dates_drop_each_axis_own_window(dated_events):
    """Each axis ignores its own window and keeps every other filter, the other window too."""
    token, _ = dated_events
    everything = _dates(q=token)

    by_occurrence = _dates(q=token, occurred_date_from="2024-03-01")
    assert by_occurrence["occurred_date"] == everything["occurred_date"]
    assert by_occurrence["submitted"] == _days(("2024-03-06", 1))

    by_submission = _dates(q=token, submitted_from="2024-02-01")
    assert by_submission["submitted"] == everything["submitted"]
    assert by_submission["occurred_date"] == _days(("2024-01-10", 1), ("2024-03-05", 1))


def test_search_dates_follow_the_types(dated_events):
    token, _ = dated_events
    assert _dates(q=token, type="site") == {"occurred_date": [], "submitted": [], "total": 0}
    assert _dates(q=token, type=["site", "event"]) == _dates(q=token)
    assert client.get("/api/v1/search/dates", params={"type": "bogus"}).status_code == 422
    assert client.get("/api/v1/search/dates", params={"status": "bogus"}).status_code == 422


def test_search_dates_without_a_query_or_a_filter_count_every_searchable_event(db, caller):
    def counts() -> tuple[dict[str, int], dict[str, int]]:
        body = _dates()
        return (
            {d["date"]: d["count"] for d in body["occurred_date"]},
            {d["date"]: d["count"] for d in body["submitted"]},
        )

    occurred_before, submitted_before = counts()
    geo = make_event(db, author=caller, title=f"Strike {_unique_token()}").id
    withheld = make_event(db, author=caller, title=f"Withheld {_unique_token()}").id
    db.query(Event).filter(Event.id == geo).update(
        {"occurred_date": date(1901, 2, 3), "created_at": datetime(1901, 2, 4, tzinfo=UTC)}
    )
    db.query(Event).filter(Event.id == withheld).update(
        {
            "occurred_date": date(1901, 2, 3),
            "created_at": datetime(1901, 2, 4, tzinfo=UTC),
            "hidden_at": datetime.now(UTC),
        }
    )
    db.commit()
    occurred_after, submitted_after = counts()
    assert occurred_after.get("1901-02-03", 0) - occurred_before.get("1901-02-03", 0) == 1
    assert submitted_after.get("1901-02-04", 0) - submitted_before.get("1901-02-04", 0) == 1
