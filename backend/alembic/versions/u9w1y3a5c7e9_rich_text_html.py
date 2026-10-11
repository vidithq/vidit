"""proof and collection description become sanitised html

Revision ID: u9w1y3a5c7e9
Revises: s7u9w1y3a5c7
Create Date: 2026-10-11 10:00:00.000000

An event's ``proof`` and a collection's ``description`` hold sanitised HTML in
a ``TEXT`` column, the format the editor reads and writes. This revision
converts every stored Tiptap (ProseMirror) document to that HTML:
``events.proof``, ``collections.description``, and the ``proof`` key of every
``event_versions.snapshot`` that carries one (a redacted snapshot is ``{}`` and
stays so).

The converter and the sanitiser config below are frozen copies, not imports:
the app's sanitiser evolves, and a migration must produce the same rows on
every run. The converter maps the editor's nodes and marks to the tags the
sanitiser allows. ``heading`` levels 1 and 2 become ``h2`` and levels 3 and up
become ``h3``. ``underline`` is dropped with its text kept. An unknown node
keeps its text. The result then passes the frozen sanitiser, so every row is in
the canonical form the app writes.

Image srcs were host-checked at write time against the deployment's settings,
which a migration cannot read reliably. The frozen image check keeps every src
any configuration admits (a relative path, or ``http`` / ``https``) and refuses
the rest; the frozen link check is ``safe_link_href``.

An empty document becomes ``""``, the empty body the app writes; both columns
stay ``NOT NULL``. ``collections.description_text`` already holds the plain-text
projection the HTML yields, so it is left as it is, and so is the search index
built over it.

The downgrade refuses: HTML does not map back to a Tiptap document without
loss. Restore from a backup taken before the upgrade instead.
"""

import json
import re
from html import escape
from typing import Any, Sequence, Union
from urllib.parse import urlparse

import nh3
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "u9w1y3a5c7e9"
down_revision: Union[str, None] = "s7u9w1y3a5c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TEXT_TAGS = frozenset(
    {
        "p",
        "h2",
        "h3",
        "strong",
        "em",
        "s",
        "code",
        "pre",
        "a",
        "ul",
        "ol",
        "li",
        "blockquote",
        "hr",
        "br",
    }
)
_ATTRIBUTES = {"a": {"href"}, "img": {"src", "alt"}}
_BARE_IMG = re.compile(r'<img(?![^>]*\ssrc=")[^>]*>')
_BARE_LINK = re.compile(r"<a>(.*?)</a>", re.DOTALL)

_BLOCK_TAGS = {
    "paragraph": "p",
    "blockquote": "blockquote",
    "bulletList": "ul",
    "orderedList": "ol",
    "listItem": "li",
}
_MARK_TAGS = {
    "bold": "strong",
    "strong": "strong",
    "italic": "em",
    "em": "em",
    "strike": "s",
    "s": "s",
    "code": "code",
}


def _safe_link_href(value: str) -> str | None:
    try:
        parsed = urlparse(value)
    except ValueError:
        return None
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        return None
    return value


def _safe_image_src(value: str) -> str | None:
    normalized = value.replace("\t", "").replace("\r", "").replace("\n", "").replace("\\", "/")
    if normalized[:2] == "//":
        return None
    if value.startswith("/"):
        return value
    try:
        scheme = urlparse(value).scheme.lower()
    except ValueError:
        return None
    return value if scheme in {"http", "https"} else None


def _attribute_filter(tag: str, attr: str, value: str) -> str | None:
    if tag == "a" and attr == "href":
        return _safe_link_href(value)
    if tag == "img" and attr == "src":
        return _safe_image_src(value)
    return value


def _sanitize(html: str, *, allow_images: bool) -> str:
    cleaned = nh3.clean(
        html,
        tags=_TEXT_TAGS | {"img"} if allow_images else _TEXT_TAGS,
        clean_content_tags={"script", "style"},
        attributes=_ATTRIBUTES,
        attribute_filter=_attribute_filter,
        link_rel=None,
        url_schemes={"http", "https"},
    )
    return _BARE_LINK.sub(r"\1", _BARE_IMG.sub("", cleaned))


def _text_html(node: dict[str, Any]) -> str:
    text = node.get("text")
    if not isinstance(text, str):
        return ""
    html = escape(text, quote=False)
    marks = node.get("marks")
    if not isinstance(marks, list):
        return html
    # The first mark is the outermost tag.
    for mark in reversed(marks):
        if not isinstance(mark, dict):
            continue
        mark_type = mark.get("type")
        if mark_type == "link":
            attrs = mark.get("attrs")
            href = attrs.get("href") if isinstance(attrs, dict) else None
            if isinstance(href, str):
                html = f'<a href="{escape(href)}">{html}</a>'
        elif isinstance(mark_type, str) and mark_type in _MARK_TAGS:
            tag = _MARK_TAGS[mark_type]
            html = f"<{tag}>{html}</{tag}>"
    return html


def _node_html(node: Any) -> str:
    if not isinstance(node, dict):
        return ""
    node_type = node.get("type")
    if node_type == "text":
        return _text_html(node)
    content = node.get("content")
    inner = "".join(_node_html(c) for c in content) if isinstance(content, list) else ""
    attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
    if isinstance(node_type, str) and node_type in _BLOCK_TAGS:
        tag = _BLOCK_TAGS[node_type]
        return f"<{tag}>{inner}</{tag}>"
    if node_type == "heading":
        level = attrs.get("level")
        tag = "h3" if isinstance(level, int) and level >= 3 else "h2"
        return f"<{tag}>{inner}</{tag}>"
    if node_type == "codeBlock":
        return f"<pre><code>{inner}</code></pre>"
    if node_type == "horizontalRule":
        return "<hr>"
    if node_type == "hardBreak":
        return "<br>"
    if node_type == "image":
        src = attrs.get("src")
        if not isinstance(src, str):
            return ""
        alt = attrs.get("alt")
        alt_attr = f' alt="{escape(alt)}"' if isinstance(alt, str) and alt else ""
        return f'<img src="{escape(src)}"{alt_attr}>'
    # ``doc`` and any unknown node: the children, text kept.
    return inner


def tiptap_to_html(doc: Any, *, allow_images: bool = True) -> str:
    """The sanitised HTML of a stored Tiptap document; ``""`` for an empty one."""
    return _sanitize(_node_html(doc), allow_images=allow_images)


def _load(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


def upgrade() -> None:
    bind = op.get_bind()

    proofs = bind.execute(sa.text("SELECT id, proof FROM events")).all()
    op.alter_column("events", "proof", type_=sa.Text(), postgresql_using="''")
    rows = [{"id": row_id, "html": tiptap_to_html(_load(proof))} for row_id, proof in proofs]
    if rows:
        bind.execute(sa.text("UPDATE events SET proof = :html WHERE id = :id"), rows)

    descriptions = bind.execute(sa.text("SELECT id, description FROM collections")).all()
    op.alter_column("collections", "description", type_=sa.Text(), postgresql_using="''")
    rows = [
        {"id": row_id, "html": tiptap_to_html(_load(description), allow_images=False)}
        for row_id, description in descriptions
    ]
    if rows:
        bind.execute(sa.text("UPDATE collections SET description = :html WHERE id = :id"), rows)

    snapshots = bind.execute(
        sa.text(
            "SELECT id, snapshot->'proof' FROM event_versions "
            "WHERE jsonb_typeof(snapshot->'proof') = 'object'"
        )
    ).all()
    rows = [{"id": row_id, "html": tiptap_to_html(_load(proof))} for row_id, proof in snapshots]
    if rows:
        bind.execute(
            sa.text(
                "UPDATE event_versions "
                "SET snapshot = jsonb_set(snapshot, '{proof}', to_jsonb(CAST(:html AS text))) "
                "WHERE id = :id"
            ),
            rows,
        )


def downgrade() -> None:
    raise NotImplementedError(
        "u9w1y3a5c7e9 is irreversible: HTML proofs and descriptions do not map back to "
        "Tiptap documents. Restore the database from a backup taken before the upgrade."
    )
