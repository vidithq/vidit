"""Server-side validation for Tiptap (ProseMirror) JSON documents.

Tiptap stores rich text as a tree of typed nodes. If an attacker bypasses
the editor and POSTs raw JSON, malicious content (javascript: URLs in
images, tracking-pixel image hosts, off-domain link marks) could be stored
and rendered to other viewers.

`sanitize_tiptap_doc` walks the tree against an allowlist of node types,
marks, and attributes; anything outside is dropped. URL-bearing attrs are
constrained:
  - image.src: relative paths or the configured CloudFront/CDN host (or any
    https:// when no CDN is configured, e.g. local dev).
  - link.href (mark): http(s)://… only.
Depth and node-count caps bound recursion and storage cost.
"""

from typing import Any
from urllib.parse import urlparse

from app.config import settings
from app.services.storage import LOCAL_STORAGE_URL_PREFIX

# The canonical empty proof document. ``geolocations.proof`` is NOT NULL — every
# row carries a proof doc — so a submission with no proof body and the migration
# that backfilled pre-existing NULLs both store this. It renders as "no proof"
# through the proof renderer rather than a shape the frontend doesn't expect.
EMPTY_TIPTAP_DOC: dict[str, Any] = {"type": "doc", "content": []}

# Tiptap StarterKit nodes (+ Image extension wired in
# frontend/src/components/editor/ProofEditor.tsx).
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

# Tiptap StarterKit marks + link (with href validation in _sanitize_mark).
_ALLOWED_MARKS: set[str] = {"bold", "italic", "strike", "code", "link"}

# DoS guards. Generous for legitimate analyses (a long writeup with ~20
# images and bullet lists is well under both), tight against pathological
# payloads.
_MAX_DEPTH = 32
_MAX_NODES = 5_000


def _safe_image_src(value: Any) -> str | None:
    """Image src must be relative or point at the configured CDN.

    With no CloudFront configured, any https:// passes (dev media URLs); in
    prod with `cloudfront_domain` set, only that host. http://localhost
    local-storage URLs pass only when `cloudfront_domain` is unset AND
    `storage_backend == "local"`, so a CDN-less-but-S3 staging env doesn't
    accept loopback URLs.
    """
    if not isinstance(value, str):
        return None
    # Reject protocol-relative URLs (``//evil.com/x``) BEFORE the
    # relative-path early-return below: the browser resolves them against
    # the page scheme, so a persisted ``//attacker.example/pixel.gif`` would
    # exfiltrate every viewer's IP / UA / Referer, defeating the
    # anti-tracking-pixel guarantee.
    if value.startswith("//"):
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
    if cdn and (parsed.hostname or "").lower() != cdn:
        return None
    return value


def _safe_link_href(value: Any) -> str | None:
    """Link href must be an explicit http(s):// URL — no javascript:,
    data:, mailto:, or schemeless paths."""
    if not isinstance(value, str):
        return None
    parsed = urlparse(value)
    if parsed.scheme.lower() not in {"http", "https"}:
        return None
    if not parsed.hostname:
        return None
    return value


def extract_image_srcs(doc: Any) -> list[str]:
    """Collect image src URLs from a Tiptap document (sanitized or not).

    Used after sanitization to link `proof_images` rows to the referencing
    geolocation. Returns srcs in tree order, deduped so the caller can pass
    the result straight to a SQL `IN (...)`.
    """
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


def sanitize_tiptap_doc(doc: Any, *, allow_images: bool = True) -> dict[str, Any]:
    """Validate a Tiptap document against the allowlist.

    Drops unknown nodes/marks/attrs. Strips images with unsafe src and
    link marks with unsafe href. Raises ValueError if the root isn't a
    `type='doc'` object, or if the tree exceeds depth/size caps.

    ``allow_images=False`` drops every image node. Bounty proofs use this:
    the bounty create path never adopts inline images into ``proof_images``
    rows (that table only has an ``event_id``), so a kept image would
    orphan and get reaped — a broken image in the stored proof. Geolocations
    adopt their images, so they keep the default.
    """
    if not isinstance(doc, dict) or doc.get("type") != "doc":
        raise ValueError("Tiptap document must be a JSON object with type='doc'")
    counter = [0]
    sanitized = _sanitize_node(doc, depth=0, counter=counter, allow_images=allow_images)
    if sanitized is None:
        return {"type": "doc", "content": []}
    sanitized.setdefault("content", [])
    return sanitized


def tiptap_doc_from_text(text: str) -> dict[str, Any]:
    """Build a minimal Tiptap proof document from plain text.

    One paragraph node per non-blank line; blank lines drop out. Used by the
    machine-detection assemble step to wrap a tweet / thread's cleaned text
    (from ``clean_proof_text``) into the JSONB proof shape every row carries.
    Empty or all-blank input yields an empty document (same shape as
    :data:`EMPTY_TIPTAP_DOC`).
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


def _sanitize_node(
    node: Any, *, depth: int, counter: list[int], allow_images: bool
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
        clean_attrs = _sanitize_attrs(node_type, raw_attrs, allowed_attrs)
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
                _sanitize_node(child, depth=depth + 1, counter=counter, allow_images=allow_images)
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
        href = _safe_link_href(attrs.get("href"))
        if href is None:
            return None
        cleaned: dict[str, Any] = {"type": "link", "attrs": {"href": href}}
        target = attrs.get("target")
        if target in {"_blank", "_self"}:
            cleaned["attrs"]["target"] = target
        return cleaned
    return {"type": mark_type}


def _sanitize_attrs(
    node_type: str, raw_attrs: dict[str, Any], allowed: set[str]
) -> dict[str, Any] | None:
    """Returns the cleaned attr dict, or None if the whole node should be dropped."""
    cleaned: dict[str, Any] = {}
    for key, value in raw_attrs.items():
        if key not in allowed:
            continue
        if node_type == "image" and key == "src":
            safe = _safe_image_src(value)
            if safe is None:
                return None  # unsafe image — drop the node entirely
            cleaned[key] = safe
        elif node_type == "heading" and key == "level":
            if isinstance(value, int) and 1 <= value <= 6:
                cleaned[key] = value
        elif isinstance(value, (str, int, type(None))):
            cleaned[key] = value
    return cleaned
