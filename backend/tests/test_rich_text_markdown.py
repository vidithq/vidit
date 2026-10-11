import json
from pathlib import Path

import pytest

from app.services.rich_text_markdown import (
    _BLOCKS,
    _INLINE_NODES,
    _MARK_ORDER,
    tiptap_doc_markdown,
)
from app.services.sanitize import ALLOWED_MARKS, ALLOWED_NODES

# Shared with `frontend/src/lib/richText.test.ts`, which parses each `markdown` back with
# Tiptap's CommonMark parser and expects `doc`.
_FIXTURES = json.loads((Path(__file__).parent / "data" / "rich_text_markdown.json").read_text())


@pytest.mark.parametrize("case", _FIXTURES, ids=[case["name"] for case in _FIXTURES])
def test_projection_matches_the_shared_fixture(case):
    assert tiptap_doc_markdown(case["doc"]) == case["markdown"]


def test_every_contract_type_has_a_projection():
    assert set(ALLOWED_NODES) == set(_BLOCKS) | _INLINE_NODES
    assert set(ALLOWED_MARKS) == set(_MARK_ORDER)


def test_edge_spaces_of_a_marked_run_sit_outside_its_delimiters():
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "see"},
                    {"type": "text", "text": " bold ", "marks": [{"type": "bold"}]},
                    {"type": "text", "text": "after"},
                ],
            }
        ],
    }
    assert tiptap_doc_markdown(doc) == "see **bold** after"


def test_heading_without_a_contract_level_projects_at_the_first_level():
    doc = {
        "type": "doc",
        "content": [{"type": "heading", "content": [{"type": "text", "text": "x"}]}],
    }
    assert tiptap_doc_markdown(doc) == "## x"


@pytest.mark.parametrize("doc", [None, "text", {"type": "doc"}, {"type": "doc", "content": []}])
def test_no_content_projects_to_an_empty_string(doc):
    assert tiptap_doc_markdown(doc) == ""
