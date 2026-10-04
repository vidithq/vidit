"""Server-side validation for Tiptap (ProseMirror) JSON documents.

An attacker can bypass the editor and POST raw JSON (javascript: URLs,
tracking-pixel image hosts, off-domain links), so `sanitize_tiptap_doc` walks
the tree against an allowlist of nodes, marks, and attrs and drops the rest.
Depth and node-count caps bound recursion and storage cost.

The allowlists and URL predicates mirror the front end
(`lib/proof.tsx`, `ProofEditor.tsx`); a security fix to either side needs the other.
"""

from typing import Any
from urllib.parse import urlparse

from app.config import settings
from app.services.storage import LOCAL_STORAGE_URL_PREFIX

# Src scheme for a not-yet-uploaded proof image (``placeholder://<filename>``,
# the file rides in the same multipart request). Intake resolves it before
# storing, so no persisted doc carries one. Mirrored by `lib/proofImages.ts`.
PROOF_PLACEHOLDER_PREFIX = "placeholder://"

# Tiptap StarterKit nodes + Image (see `ProofEditor.tsx`).
_ALLOWED_NODES: dict[str, set[str]] = {
    "doc": set(),
    "paragraph": set(),
    "text": set(),
    "heading": {"level"},
    "blockquote": set(),
    "bulletList": set(),
    "orderedList": {"start"},
    "listItem": set(),
    "codeBlock": {"language"},
    "hardBreak": set(),
    "horizontalRule": set(),
    "image": {"src", "alt", "title"},
}

# StarterKit marks + link (href checked in _sanitize_mark).
_ALLOWED_MARKS: set[str] = {"bold", "italic", "strike", "code", "link"}

# DoS guards: a long writeup with ~20 images is well under both.
_MAX_DEPTH = 32
_MAX_NODES = 5_000


def _safe_image_src(value: Any, *, allow_placeholders: bool = False) -> str | None:
    """Image src must be relative or point at the configured media host.

    - ``cloudfront_domain`` set (prod): only that host's https URLs pass.
    - no CDN + ``s3``: only the bucket endpoint passes. Falling through to
      "any https" would let a stored tracking pixel exfiltrate every viewer's
      IP/UA.
    - no CDN + ``local`` (dev): the local-storage prefix and any other https
      pass.

    ``allow_placeholders`` also admits ``placeholder://<filename>`` (intake
    only). Ownership of a stored image is an intake question
    (``evidence_intake._reject_foreign_proof_srcs``). Mirrored by
    ``isSafeImageSrc`` (`lib/proof.tsx`).
    """
    if not isinstance(value, str):
        return None
    if allow_placeholders and value.startswith(PROOF_PLACEHOLDER_PREFIX):
        # A bare prefix names no file; drop the node rather than 400 at intake.
        return value if len(value) > len(PROOF_PLACEHOLDER_PREFIX) else None
    # Reject protocol-relative URLs before the relative-path return below
    # (``//attacker.example/pixel.gif`` would exfiltrate viewers' IP/UA).
    # Normalise like a browser (WHATWG): strip tab/CR/LF, backslash to slash,
    # so ``/\evil`` and ``/<TAB>/evil`` reduce to ``//evil``.
    normalized = value.replace("\t", "").replace("\r", "").replace("\n", "").replace("\\", "/")
    if normalized[:2] == "//":
        return None
    if value.startswith("/"):
        return value
    cdn = settings.cloudfront_domain.strip().lower()
    if (
        not cdn
        and settings.storage_backend == "local"
        and value.startswith(LOCAL_STORAGE_URL_PREFIX + "/")
    ):
        return value
    parsed = urlparse(value)
    scheme = parsed.scheme.lower()
    if scheme != "https":
        return None
    host = (parsed.hostname or "").lower()
    if cdn:
        return value if host == cdn else None
    if settings.storage_backend == "s3":
        # Pin to the endpoint ``storage.S3Storage.public_url`` mints.
        s3_host = f"{settings.s3_bucket}.s3.{settings.aws_region}.amazonaws.com".lower()
        return value if host == s3_host else None
    return value


def safe_link_href(value: Any) -> str | None:
    """The value if it is an explicit ``http(s)://`` URL, else ``None``.

    Rejects ``javascript:``, ``data:``, ``mailto:``, and schemeless paths.
    The one link allowlist: applied at write time and again by source
    archival. A value ``urlparse`` refuses (``http://[::1``) returns ``None``
    instead of raising. Mirrored by ``isSafeLinkHref`` (`lib/proof.tsx`).
    """
    if not isinstance(value, str):
        return None
    try:
        parsed = urlparse(value)
    except ValueError:
        return None
    if parsed.scheme.lower() not in {"http", "https"}:
        return None
    if not parsed.hostname:
        return None
    return value


def normalised_host(value: str) -> str | None:
    """The comparable host of a stored link: lower case, no leading ``www.``.

    Shared by :func:`source_archive._normalised_target` and
    :func:`services.user_stats.get_user_stats`, so ``tiktok.com`` and
    ``www.tiktok.com`` are one source. Returns ``None`` when no host reads,
    malformed input included.
    """
    try:
        parsed = urlparse(value)
    except ValueError:
        return None
    return (parsed.hostname or "").lower().removeprefix("www.") or None


def extract_image_srcs(doc: Any) -> list[str]:
    """Image srcs of a Tiptap document (sanitized or not), in tree order, deduped."""
    seen: set[str] = set()
    srcs: list[str] = []

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        if node.get("type") == "image":
            attrs = node.get("attrs")
            if isinstance(attrs, dict):
                src = attrs.get("src")
                if isinstance(src, str) and src not in seen:
                    seen.add(src)
                    srcs.append(src)
        content = node.get("content")
        if isinstance(content, list):
            for child in content:
                walk(child)

    walk(doc)
    return srcs


def extract_link_hrefs(doc: Any) -> list[str]:
    """Link-mark hrefs of a Tiptap document (sanitized or not), in tree order, deduped.

    Only ``http(s)`` hrefs come back: :func:`safe_link_href` is re-applied
    because a row stored before a rule tightened is still readable.
    """
    seen: set[str] = set()
    hrefs: list[str] = []

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        marks = node.get("marks")
        if isinstance(marks, list):
            for mark in marks:
                if not isinstance(mark, dict) or mark.get("type") != "link":
                    continue
                attrs = mark.get("attrs")
                if not isinstance(attrs, dict):
                    continue
                href = safe_link_href(attrs.get("href"))
                if href is not None and href not in seen:
                    seen.add(href)
                    hrefs.append(href)
        content = node.get("content")
        if isinstance(content, list):
            for child in content:
                walk(child)

    walk(doc)
    return hrefs


def sanitize_tiptap_doc(
    doc: Any, *, allow_images: bool = True, allow_placeholders: bool = False
) -> dict[str, Any]:
    """Validate a Tiptap document against the allowlist.

    Drops unknown nodes/marks/attrs and images or links with an unsafe URL.
    Raises ValueError if the root isn't a `type='doc'` object or the tree
    exceeds the caps.

    ``allow_images=False`` drops every image node. ``allow_placeholders=True``
    admits ``placeholder://`` srcs for the create paths (see
    ``PROOF_PLACEHOLDER_PREFIX``).
    """
    if not isinstance(doc, dict) or doc.get("type") != "doc":
        raise ValueError("Tiptap document must be a JSON object with type='doc'")
    counter = [0]
    sanitized = _sanitize_node(
        doc,
        depth=0,
        counter=counter,
        allow_images=allow_images,
        allow_placeholders=allow_placeholders,
    )
    if sanitized is None:
        return {"type": "doc", "content": []}
    sanitized.setdefault("content", [])
    return sanitized


def sanitize_tiptap_doc_or_raise(
    doc: Any,
    *,
    error: type[Exception],
    allow_images: bool = True,
    allow_placeholders: bool = False,
) -> dict[str, Any]:
    """Sanitise a document, raising ``error`` where the sanitiser raises ``ValueError``.

    Routers map typed service errors by ``code``
    (``routers/_errors.raise_typed_error``), so the ValueError must become one
    first. Callers: ``services/events/rules._sanitize_proof`` and
    ``services/collections._checked_description``. ``error`` is a parameter so
    each service owns its vocabulary without importing the other; the message
    passes through unchanged.
    """
    try:
        return sanitize_tiptap_doc(
            doc, allow_images=allow_images, allow_placeholders=allow_placeholders
        )
    except ValueError as exc:
        raise error(str(exc)) from exc


def tiptap_doc_from_text(text: str) -> dict[str, Any]:
    """One paragraph per non-blank line; empty input yields an empty doc.

    Wraps machine-detected text (``clean_proof_text``) into the proof shape.
    """
    paragraphs = [line for line in text.split("\n") if line.strip()]
    if not paragraphs:
        return {"type": "doc", "content": []}
    return {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": line}]}
            for line in paragraphs
        ],
    }


def tiptap_doc_text(doc: Any) -> str:
    """The plain-text projection of a Tiptap document.

    The one reader of a rich-text body as text: the search index
    (``collections.description_text``, ``services/search._collection_tsvector``),
    the card clamp, the share card, and the length cap in ``services/collections``.

    Text nodes concatenate and every block boundary starts a new line
    (``hardBreak`` ends one inside a paragraph). Blank lines drop out, lines
    are stripped and joined with ``\\n``. Textless nodes contribute nothing.

    Mirrored by ``lib/proof.tsx::tiptapDocText``; change both.
    """
    lines: list[str] = []
    current: list[str] = []

    def flush() -> None:
        line = "".join(current).strip()
        current.clear()
        if line:
            lines.append(line)

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        node_type = node.get("type")
        if node_type == "text":
            text = node.get("text")
            if isinstance(text, str):
                current.append(text)
            return
        if node_type == "hardBreak":
            flush()
            return
        content = node.get("content")
        if isinstance(content, list):
            for child in content:
                walk(child)
        # Every block but the root ends its line; containers flush an empty buffer.
        if node_type != "doc":
            flush()

    walk(doc)
    flush()
    return "\n".join(lines)


def _sanitize_node(
    node: Any, *, depth: int, counter: list[int], allow_images: bool, allow_placeholders: bool
) -> dict[str, Any] | None:
    if depth > _MAX_DEPTH:
        raise ValueError(f"Tiptap document exceeds max depth ({_MAX_DEPTH})")
    counter[0] += 1
    if counter[0] > _MAX_NODES:
        raise ValueError(f"Tiptap document exceeds max node count ({_MAX_NODES})")

    if not isinstance(node, dict):
        return None
    node_type = node.get("type")
    if not isinstance(node_type, str) or node_type not in _ALLOWED_NODES:
        return None
    if node_type == "image" and not allow_images:
        return None

    cleaned: dict[str, Any] = {"type": node_type}

    allowed_attrs = _ALLOWED_NODES[node_type]
    raw_attrs = node.get("attrs")
    if isinstance(raw_attrs, dict) and allowed_attrs:
        clean_attrs = _sanitize_attrs(
            node_type, raw_attrs, allowed_attrs, allow_placeholders=allow_placeholders
        )
        if clean_attrs is None:
            return None  # signal: drop the entire node (e.g. image with unsafe src)
        if clean_attrs:
            cleaned["attrs"] = clean_attrs

    text = node.get("text")
    if isinstance(text, str):
        cleaned["text"] = text

    raw_marks = node.get("marks")
    if isinstance(raw_marks, list):
        clean_marks = [m for m in (_sanitize_mark(raw) for raw in raw_marks) if m is not None]
        if clean_marks:
            cleaned["marks"] = clean_marks

    raw_content = node.get("content")
    if isinstance(raw_content, list):
        clean_content = [
            c
            for c in (
                _sanitize_node(
                    child,
                    depth=depth + 1,
                    counter=counter,
                    allow_images=allow_images,
                    allow_placeholders=allow_placeholders,
                )
                for child in raw_content
            )
            if c
        ]
        if clean_content:
            cleaned["content"] = clean_content

    return cleaned


def _sanitize_mark(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    mark_type = raw.get("type")
    if mark_type not in _ALLOWED_MARKS:
        return None
    if mark_type == "link":
        attrs = raw.get("attrs")
        if not isinstance(attrs, dict):
            return None
        href = safe_link_href(attrs.get("href"))
        if href is None:
            return None
        cleaned: dict[str, Any] = {"type": "link", "attrs": {"href": href}}
        target = attrs.get("target")
        if target in {"_blank", "_self"}:
            cleaned["attrs"]["target"] = target
        return cleaned
    return {"type": mark_type}


def _sanitize_attrs(
    node_type: str, raw_attrs: dict[str, Any], allowed: set[str], *, allow_placeholders: bool
) -> dict[str, Any] | None:
    """Returns the cleaned attr dict, or None if the whole node should be dropped."""
    cleaned: dict[str, Any] = {}
    for key, value in raw_attrs.items():
        if key not in allowed:
            continue
        if node_type == "image" and key == "src":
            safe = _safe_image_src(value, allow_placeholders=allow_placeholders)
            if safe is None:
                return None  # unsafe image: drop the node
            cleaned[key] = safe
        elif node_type == "heading" and key == "level":
            if isinstance(value, int) and 1 <= value <= 6:
                cleaned[key] = value
        elif isinstance(value, (str, int, type(None))):
            cleaned[key] = value
    return cleaned
