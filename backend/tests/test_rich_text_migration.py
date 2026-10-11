"""The frozen Tiptap-to-HTML converter of migration ``u9w1y3a5c7e9``."""

import importlib.util
import os
import subprocess
import sys
import uuid
from pathlib import Path

import psycopg2
import pytest
from psycopg2.extras import Json

from app.config import settings
from app.services.sanitize import extract_image_srcs, html_text, sanitize_html
from tests.conftest import _admin_conn, _db_name, _swap_db

_PATH = Path(__file__).parents[1] / "alembic" / "versions" / "u9w1y3a5c7e9_rich_text_html.py"
_spec = importlib.util.spec_from_file_location("rich_text_migration", _PATH)
assert _spec is not None and _spec.loader is not None
migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(migration)
tiptap_to_html = migration.tiptap_to_html


def _text(text: str, *marks: dict) -> dict:
    node: dict = {"type": "text", "text": text}
    if marks:
        node["marks"] = list(marks)
    return node


def _p(*content: dict) -> dict:
    return {"type": "paragraph", "content": list(content)}


def _doc(*content: dict) -> dict:
    return {"type": "doc", "content": list(content)}


def test_empty_doc_becomes_an_empty_string():
    assert tiptap_to_html({"type": "doc", "content": []}) == ""
    assert tiptap_to_html({"type": "doc"}) == ""


def test_machine_proof_shape():
    doc = _doc(
        _p(_text("Strike on the depot")),
        _p(_text("a & <b>")),
        {"type": "image", "attrs": {"src": "https://cdn.example.com/proof/a.png"}},
    )
    assert tiptap_to_html(doc) == (
        '<p>Strike on the depot</p><p>a &amp; &lt;b&gt;</p><img src="https://cdn.example.com/proof/a.png">'
    )


def test_marks_map_to_their_tags_and_underline_drops():
    doc = _doc(
        _p(
            _text("b", {"type": "bold"}),
            _text("i", {"type": "italic"}),
            _text("s", {"type": "strike"}),
            _text("c", {"type": "code"}),
            _text("u", {"type": "underline"}),
            _text("both", {"type": "bold"}, {"type": "italic"}),
        )
    )
    assert tiptap_to_html(doc) == (
        "<p><strong>b</strong><em>i</em><s>s</s><code>c</code>u<strong><em>both</em></strong></p>"
    )


def test_links_keep_a_safe_href_and_lose_an_unsafe_one():
    doc = _doc(
        _p(
            _text("ok", {"type": "link", "attrs": {"href": "https://x.example/?a=1&b=2"}}),
            _text(" "),
            _text("bad", {"type": "link", "attrs": {"href": "javascript:alert(1)"}}),
        )
    )
    assert tiptap_to_html(doc) == '<p><a href="https://x.example/?a=1&amp;b=2">ok</a> bad</p>'


@pytest.mark.parametrize(("level", "tag"), [(1, "h2"), (2, "h2"), (3, "h3"), (4, "h3"), (6, "h3")])
def test_heading_levels_fold_into_h2_and_h3(level, tag):
    doc = _doc({"type": "heading", "attrs": {"level": level}, "content": [_text("T")]})
    assert tiptap_to_html(doc) == f"<{tag}>T</{tag}>"


def test_block_nodes():
    doc = _doc(
        {"type": "bulletList", "content": [{"type": "listItem", "content": [_p(_text("a"))]}]},
        {
            "type": "orderedList",
            "attrs": {"start": 3},
            "content": [{"type": "listItem", "content": [_p(_text("b"))]}],
        },
        {"type": "blockquote", "content": [_p(_text("q"))]},
        {"type": "codeBlock", "attrs": {"language": None}, "content": [_text("x <\n  y")]},
        {"type": "horizontalRule"},
        _p(_text("line"), {"type": "hardBreak"}, _text("next")),
    )
    assert tiptap_to_html(doc) == (
        "<ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol>"
        "<blockquote><p>q</p></blockquote><pre><code>x &lt;\n  y</code></pre><hr>"
        "<p>line<br>next</p>"
    )


def test_unknown_nodes_keep_their_text():
    doc = _doc({"type": "table", "content": [{"type": "tableCell", "content": [_p(_text("c"))]}]})
    assert tiptap_to_html(doc) == "<p>c</p>"


def test_images_keep_alt_and_lose_unsafe_srcs():
    doc = _doc(
        {"type": "image", "attrs": {"src": "/media/a.png", "alt": "frame", "title": None}},
        {"type": "image", "attrs": {"src": "javascript:alert(1)"}},
        {"type": "image", "attrs": {"src": "//evil.example/p.gif"}},
        {"type": "image", "attrs": {}},
    )
    assert tiptap_to_html(doc) == '<img src="/media/a.png" alt="frame">'


def test_descriptions_drop_images():
    doc = _doc(_p(_text("words")), {"type": "image", "attrs": {"src": "/a.png"}})
    assert tiptap_to_html(doc, allow_images=False) == "<p>words</p>"


def test_output_is_canonical_and_projects_like_the_document():
    doc = _doc(
        {"type": "heading", "attrs": {"level": 2}, "content": [_text("Title")]},
        _p(_text("a "), _text("b", {"type": "bold"}), {"type": "hardBreak"}, _text("c")),
        {"type": "bulletList", "content": [{"type": "listItem", "content": [_p(_text("d"))]}]},
        {"type": "image", "attrs": {"src": "/a.png"}},
    )
    html = tiptap_to_html(doc)
    assert sanitize_html(html) == html
    assert html_text(html) == "Title\na b\nc\nd"
    assert extract_image_srcs(html) == ["/a.png"]


def test_newlines_inside_text_become_breaks_outside_code():
    doc = _doc(
        _p(_text("a\n\nb")),
        {"type": "codeBlock", "content": [_text("c\nd")]},
    )
    assert tiptap_to_html(doc) == "<p>a<br><br>b</p><pre><code>c\nd</code></pre>"


@pytest.mark.parametrize(
    "doc",
    [
        _doc(_p()),
        _doc(_p(_text("  "))),
        _doc(_p(_text("\ufffc"))),
        _doc({"type": "horizontalRule"}),
    ],
)
def test_a_document_without_text_or_image_becomes_empty(doc):
    assert tiptap_to_html(doc) == ""


def _alembic_upgrade(url: str, revision: str) -> None:
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", revision],
        env={**os.environ, "DATABASE_URL": url},
        check=True,
        capture_output=True,
    )


@pytest.fixture
def pre_html_db():
    """A throwaway database migrated to the revision before ``u9w1y3a5c7e9``."""
    name = f"{_db_name(settings.database_url)}_rich_text"
    url = _swap_db(settings.database_url, name)
    admin = _admin_conn(settings.database_url)
    try:
        with admin.cursor() as cur:
            cur.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            cur.execute(f'CREATE DATABASE "{name}"')
        with psycopg2.connect(url) as conn, conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS postgis")
        _alembic_upgrade(url, migration.down_revision)
        yield url
    finally:
        with admin.cursor() as cur:
            cur.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        admin.close()


def test_upgrade_converts_stored_documents(pre_html_db):
    proof = _doc(
        {"type": "heading", "attrs": {"level": 1}, "content": [_text("T")]},
        _p(
            _text("a "),
            _text("b", {"type": "bold"}),
            _text("l", {"type": "link", "attrs": {"href": "https://x.example/"}}),
            {"type": "hardBreak"},
            _text("c"),
        ),
        {"type": "image", "attrs": {"src": "/media/a.png", "alt": "x"}},
    )
    proof_html = (
        '<h2>T</h2><p>a <strong>b</strong><a href="https://x.example/">l</a><br>c</p>'
        '<img src="/media/a.png" alt="x">'
    )
    user, event, collection, version, redacted = (str(uuid.uuid4()) for _ in range(5))
    with psycopg2.connect(pre_html_db) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO users (id, username, is_active, created_at) VALUES (%s, 'u', true, now())",
            (user,),
        )
        cur.execute(
            "INSERT INTO events (id, owner_id, title, proof, status, created_at, updated_at) "
            "VALUES (%s, %s, 't', %s, 'detected', now(), now())",
            (event, user, Json(proof)),
        )
        cur.execute(
            "INSERT INTO collections (id, owner_id, title, description, description_text, "
            "created_at, updated_at) VALUES (%s, %s, 'c', %s, 'words', now(), now())",
            (collection, user, Json(_doc(_p(_text("words"))))),
        )
        cur.execute(
            "INSERT INTO event_versions (id, event_id, version_no, snapshot, created_at) "
            "VALUES (%s, %s, 1, %s, now()), (%s, %s, 2, '{}', now())",
            (version, event, Json({"title": "t", "proof": proof}), redacted, event),
        )

    _alembic_upgrade(pre_html_db, migration.revision)

    with psycopg2.connect(pre_html_db) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT table_name, data_type FROM information_schema.columns "
            "WHERE (table_name, column_name) IN (('events', 'proof'), ('collections', 'description'))"
        )
        assert dict(cur.fetchall()) == {"events": "text", "collections": "text"}
        cur.execute("SELECT proof FROM events")
        assert cur.fetchone() == (proof_html,)
        cur.execute("SELECT description, description_text FROM collections")
        assert cur.fetchone() == ("<p>words</p>", "words")
        cur.execute("SELECT version_no, snapshot FROM event_versions ORDER BY version_no")
        assert cur.fetchall() == [(1, {"title": "t", "proof": proof_html}), (2, {})]


def test_downgrade_refuses():
    with pytest.raises(NotImplementedError):
        migration.downgrade()
