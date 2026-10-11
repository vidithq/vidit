"""The frozen Tiptap-to-HTML converter of migration ``u9w1y3a5c7e9``."""

import importlib.util
from pathlib import Path

import pytest

from app.services.sanitize import extract_image_srcs, html_text, sanitize_html

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
