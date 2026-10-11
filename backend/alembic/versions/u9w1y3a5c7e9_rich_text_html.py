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
become ``h3``. A newline inside a text node becomes ``br`` outside a code
block, where HTML would collapse it. An unknown node or mark keeps its text.
The result then passes the frozen sanitiser, so every row is in the canonical
form the app writes.

Image srcs were host-checked at write time against the deployment's settings,
which a migration cannot read reliably. The frozen image check keeps every src
any configuration admits (a relative path, or ``http`` / ``https``) and refuses
the rest; the frozen link check is ``safe_link_href``.

A document with no text and no image becomes ``""``, the empty body the app
writes; both columns stay ``NOT NULL``. ``collections.description_text`` and
the search index over it are left as they are; the stored projection can differ
from the HTML's in blank lines.

The downgrade refuses: HTML does not map back to a Tiptap document without
loss. Restore from a backup taken before the upgrade instead.
"""

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

_TAGS = frozenset(
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
        "img",
    }
)
_ATTRIBUTES: dict[str, set[str]] = {"*": set(), "a": {"href"}, "img": {"src", "alt"}}
_BARE_IMG = re.compile(r'<img(?:\s(?!src=)[a-z-]+="[^"]*")*>')
_BARE_LINK = re.compile(r"<a>(.*?)</a>", re.DOTALL)

_BLOCK_TAGS = {
    "paragraph": "p",
    "blockquote": "blockquote",
    "bulletList": "ul",
    "orderedList": "ol",
    "listItem": "li",
}
_MARK_TAGS = {"bold": "strong", "italic": "em", "strike": "s", "code": "code"}


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


def _sanitize(html: str) -> str:
    cleaned = nh3.clean(
        html,
        tags=_TAGS,
        clean_content_tags={"script", "style"},
        attributes=_ATTRIBUTES,
        attribute_filter=_attribute_filter,
        link_rel=None,
        url_schemes={"http", "https"},
    )
    cleaned = _BARE_LINK.sub(r"\1", _BARE_IMG.sub("", cleaned)).replace("\ufffc", "")
    # A body with no text and no image is the empty body.
    text = re.sub(r"<[^>]*>", "", cleaned).replace("&nbsp;", " ")
    if "<img " not in cleaned and not text.strip():
        return ""
    return cleaned


# A field of the wrong type reads as absent, so one malformed row cannot abort
# the upgrade.
def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _str(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _text_html(node: dict[str, Any], *, in_code: bool) -> str:
    html = escape(_str(node.get("text")), quote=False)
    if not in_code:
        # Outside ``pre`` HTML collapses a newline into a space, so it becomes a break.
        html = html.replace("\n", "<br>")
    # The first mark is the outermost tag.
    for mark in map(_dict, reversed(_list(node.get("marks")))):
        mark_type = _str(mark.get("type"))
        if mark_type == "link":
            href = escape(_str(_dict(mark.get("attrs")).get("href")))
            html = f'<a href="{href}">{html}</a>'
        elif mark_type in _MARK_TAGS:
            tag = _MARK_TAGS[mark_type]
            html = f"<{tag}>{html}</{tag}>"
    return html


def _node_html(node: Any, *, in_code: bool = False) -> str:
    node = _dict(node)
    node_type = _str(node.get("type"))
    if node_type == "text":
        return _text_html(node, in_code=in_code)
    in_code = in_code or node_type == "codeBlock"
    inner = "".join(_node_html(c, in_code=in_code) for c in _list(node.get("content")))
    attrs = _dict(node.get("attrs"))
    if node_type in _BLOCK_TAGS:
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


def tiptap_to_html(doc: Any) -> str:
    """The sanitised HTML of a stored Tiptap document; ``""`` for an empty one."""
    return _sanitize(_node_html(doc))


def upgrade() -> None:
    bind = op.get_bind()

    proofs = bind.execute(sa.text("SELECT id, proof FROM events")).all()
    op.alter_column("events", "proof", type_=sa.Text(), postgresql_using="''")
    rows = [{"id": row_id, "html": tiptap_to_html(proof)} for row_id, proof in proofs]
    if rows:
        bind.execute(sa.text("UPDATE events SET proof = :html WHERE id = :id"), rows)

    descriptions = bind.execute(sa.text("SELECT id, description FROM collections")).all()
    op.alter_column("collections", "description", type_=sa.Text(), postgresql_using="''")
    rows = [{"id": row_id, "html": tiptap_to_html(doc)} for row_id, doc in descriptions]
    if rows:
        bind.execute(sa.text("UPDATE collections SET description = :html WHERE id = :id"), rows)

    snapshots = bind.execute(
        sa.text(
            "SELECT id, snapshot->'proof' FROM event_versions "
            "WHERE jsonb_typeof(snapshot->'proof') = 'object'"
        )
    ).all()
    rows = [{"id": row_id, "html": tiptap_to_html(proof)} for row_id, proof in snapshots]
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
