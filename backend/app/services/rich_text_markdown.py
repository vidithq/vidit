"""Read-only Markdown projection of a sanitized Tiptap document.

The API serves it beside the JSON (``EventRead.proof_markdown``,
``CollectionRead.description_markdown``) for readers that do not speak the
Tiptap schema: exports, scripts, language models. Output is CommonMark, plus
GFM ``~~strike~~`` and inline ``<u>`` for underline. Text is escaped so that it
reads back as the same document; ``frontend/src/lib/richText.test.ts``
parses the shared fixtures with Tiptap's Markdown parser to prove it.
"""

import re
from collections.abc import Callable
from typing import Any

from app.services.sanitize import HEADING_LEVELS

# Outermost first: a link wraps emphasis, a code span sits innermost.
_MARK_ORDER = ("link", "bold", "italic", "strike", "underline", "code")
_MARK_DELIMITERS = {
    "bold": ("**", "**"),
    "italic": ("*", "*"),
    "strike": ("~~", "~~"),
    "underline": ("<u>", "</u>"),
}
_INLINE_NODES = frozenset({"text", "hardBreak"})
_MAX_ORDERED_START = 999_999_999  # CommonMark caps a list marker at nine digits

_ALWAYS_ESCAPED = re.compile(r"([\\`*\[\]<~])")
_ENTITY = re.compile(r"&(?=#?[0-9A-Za-z]+;)")
_LINE_START = re.compile(r"^([#>+=-]|\d+(?=[.)]))")
_BACKTICK_RUN = re.compile(r"`+")


def _escape_text(text: str, *, line_start: bool) -> str:
    text = text.replace("\n", " ")
    if line_start:
        text = text.lstrip(" \t")
    out = _ALWAYS_ESCAPED.sub(r"\\\1", text)
    out = _ENTITY.sub(r"\\&", out)
    # An underscore inside a word is never emphasis, so only the others need a backslash.
    out = re.sub(r"(?<![0-9A-Za-z])_|_(?![0-9A-Za-z])", r"\\_", out)
    if out.endswith("!"):
        out = out[:-1] + "\\!"  # a following link would read as an image
    if line_start:
        match = _LINE_START.match(out)
        if match:
            end = match.end()
            out = out[:end] + "\\" + out[end:] if match.group(1)[0].isdigit() else "\\" + out
    return out


def _code_span(text: str) -> str:
    longest = max((len(run) for run in _BACKTICK_RUN.findall(text)), default=0)
    fence = "`" * (longest + 1)
    pad = " " if text.startswith(("`", " ")) or text.endswith(("`", " ")) else ""
    return f"{fence}{pad}{text}{pad}{fence}"


def _link_destination(href: str) -> str:
    escaped = href.replace("\\", "\\\\")
    if re.search(r"[\s()<>]", escaped):
        return "<" + escaped.replace("<", "\\<").replace(">", "\\>") + ">"
    return escaped


def _mark_key(mark: dict[str, Any]) -> tuple[str, str]:
    href = (mark.get("attrs") or {}).get("href", "")
    return (mark["type"], href if mark["type"] == "link" else "")


def _open(mark: tuple[str, str]) -> str:
    return "[" if mark[0] == "link" else _MARK_DELIMITERS[mark[0]][0]


def _close(mark: tuple[str, str]) -> str:
    if mark[0] == "link":
        return f"]({_link_destination(mark[1])})"
    return _MARK_DELIMITERS[mark[0]][1]


def _inline(nodes: list[Any]) -> str:
    """Inline content, with marks opened and closed across adjacent text runs."""
    out: list[str] = []
    stack: list[tuple[str, str]] = []
    pending_space = ""
    line_start = True

    def close_to(depth: int) -> None:
        while len(stack) > depth:
            out.append(_close(stack.pop()))

    items = [n for n in nodes if isinstance(n, dict) and n.get("type") in _INLINE_NODES]
    while items and items[0].get("type") == "hardBreak":
        items.pop(0)
    while items and items[-1].get("type") == "hardBreak":
        items.pop()

    for node in items:
        if node["type"] == "hardBreak":
            close_to(0)
            out.append("\\\n")
            pending_space, line_start = "", True
            continue
        text = node.get("text") or ""
        marks = sorted(
            (_mark_key(m) for m in node.get("marks") or [] if m.get("type") in _MARK_ORDER),
            key=lambda key: _MARK_ORDER.index(key[0]),
        )
        is_code = bool(marks) and marks[-1][0] == "code"
        if not is_code:
            text = text.replace("\n", " ")
            if not text.strip(" "):
                # Spaces alone carry no visible mark; they wait for the next transition.
                pending_space += text
                continue
        keep = 0
        while keep < len(stack) and keep < len(marks) and stack[keep] == marks[keep]:
            keep += 1
        close_to(keep)
        # Emphasis delimiters must touch text, so edge spaces sit outside the ones that open here.
        opening = [mark for mark in marks[keep:] if mark[0] != "code"]
        body = text if is_code or not opening else text.lstrip(" ")
        out.append(pending_space + text[: len(text) - len(body)])
        pending_space = ""
        if not is_code:
            pending_space = body[len(body.rstrip(" ")) :]
            body = body.rstrip(" ")
        for mark in opening:
            out.append(_open(mark))
            stack.append(mark)
        if is_code:
            out.append(_code_span(body))
        else:
            out.append(_escape_text(body, line_start=line_start and not stack))
        line_start = False
    close_to(0)
    return "".join(out).strip(" ")


def _prefix_lines(text: str, first: str, rest: str) -> str:
    lines = text.split("\n")
    return "\n".join(
        (first if i == 0 else rest) + line if line or i == 0 else line
        for i, line in enumerate(lines)
    )


def _blocks(nodes: Any) -> str:
    if not isinstance(nodes, list):
        return ""
    rendered = [_block(node) for node in nodes if isinstance(node, dict)]
    return "\n\n".join(block for block in rendered if block)


def _list(node: dict[str, Any], marker: Callable[[int], str]) -> str:
    items = []
    for index, item in enumerate(node.get("content") or []):
        if not isinstance(item, dict):
            continue
        prefix = marker(index)
        body = _blocks(item.get("content"))
        items.append(_prefix_lines(body, prefix, " " * len(prefix)))
    return "\n".join(items)


def _ordered_list(node: dict[str, Any]) -> str:
    start = (node.get("attrs") or {}).get("start")
    if not isinstance(start, int) or isinstance(start, bool):
        start = 1
    start = min(max(start, 0), _MAX_ORDERED_START)
    return _list(node, lambda index: f"{min(start + index, _MAX_ORDERED_START)}. ")


def _code_block(node: dict[str, Any]) -> str:
    text = "".join(
        child.get("text") or "" for child in node.get("content") or [] if isinstance(child, dict)
    )
    longest = max(
        (len(run) for run in re.findall(r"^ {0,3}(`{3,})", text, re.MULTILINE)), default=2
    )
    fence = "`" * (longest + 1)
    language = (node.get("attrs") or {}).get("language")
    info = language if isinstance(language, str) and re.fullmatch(r"[\w+#.-]+", language) else ""
    return f"{fence}{info}\n{text}\n{fence}" if text else f"{fence}{info}\n{fence}"


def _image(node: dict[str, Any]) -> str:
    attrs = node.get("attrs") or {}
    src = attrs.get("src")
    if not isinstance(src, str):
        return ""
    alt = attrs.get("alt")
    alt_text = _escape_text(alt, line_start=False) if isinstance(alt, str) else ""
    title = attrs.get("title")
    title_part = ""
    if isinstance(title, str) and title:
        escaped_title = title.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ")
        title_part = f' "{escaped_title}"'
    return f"![{alt_text}]({_link_destination(src)}{title_part})"


def _blockquote(node: dict[str, Any]) -> str:
    lines = _blocks(node.get("content")).split("\n")
    return "\n".join(f"> {line}" if line else ">" for line in lines)


def _heading(node: dict[str, Any]) -> str:
    level = (node.get("attrs") or {}).get("level")
    if level not in HEADING_LEVELS:
        level = HEADING_LEVELS[0]
    content = [
        {"type": "text", "text": " "} if isinstance(c, dict) and c.get("type") == "hardBreak" else c
        for c in node.get("content") or []
    ]
    # A space then a run of `#` at the end would read as the optional closing sequence.
    text = re.sub(r"(?<= )(#+)$", r"\\\1", _inline(content))
    return f"{'#' * level} {text}" if text else ""


_BLOCKS: dict[str, Callable[[dict[str, Any]], str]] = {
    "doc": lambda node: _blocks(node.get("content")),
    "paragraph": lambda node: _inline(node.get("content") or []),
    "heading": _heading,
    "blockquote": _blockquote,
    "bulletList": lambda node: _list(node, lambda _index: "- "),
    "orderedList": _ordered_list,
    "listItem": lambda node: _blocks(node.get("content")),
    "codeBlock": _code_block,
    "horizontalRule": lambda _node: "---",
    "image": _image,
}


def _block(node: dict[str, Any]) -> str:
    render = _BLOCKS.get(node.get("type") or "")
    return render(node) if render else _blocks(node.get("content"))


def tiptap_doc_markdown(doc: Any) -> str:
    """The Markdown projection of a sanitized Tiptap document; ``""`` when it holds no content."""
    if not isinstance(doc, dict):
        return ""
    return _block(doc)
