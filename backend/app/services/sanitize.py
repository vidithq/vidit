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

# Image src scheme the editor uses for a not-yet-uploaded proof image: the
# node references the file riding in the same multipart request
# (``placeholder://<filename>``). Evidence intake resolves each placeholder to
# an uploaded S3 URL before the doc is stored, so a persisted doc never
# carries one (an unresolved placeholder is a 400 at intake).
PROOF_PLACEHOLDER_PREFIX = "placeholder://"

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


def _safe_image_src(value: Any, *, allow_placeholders: bool = False) -> str | None:
    """Image src must be relative or point at the configured CDN.

    With no CloudFront configured, any https:// passes (dev media URLs); in
    prod with `cloudfront_domain` set, only that host. http://localhost
    local-storage URLs pass only when `cloudfront_domain` is unset AND
    `storage_backend == "local"`, so a CDN-less-but-S3 staging env doesn't
    accept loopback URLs. ``allow_placeholders`` additionally admits
    ``placeholder://<filename>`` srcs, intake-time only, never persisted
    (see ``PROOF_PLACEHOLDER_PREFIX``).
    """
    if not isinstance(value, str):
        return None
    if allow_placeholders and value.startswith(PROOF_PLACEHOLDER_PREFIX):
        # A bare prefix names no file; intake could never match it, so drop
        # the node here rather than 400 the whole submission later.
        return value if len(value) > len(PROOF_PLACEHOLDER_PREFIX) else None
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

    Evidence intake uses it to match ``placeholder://`` srcs to uploaded
    files, enforce the proof-image floor, and diff kept vs dropped proof
    media on edit. Returns srcs in tree order, deduped.
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


def sanitize_tiptap_doc(
    doc: Any, *, allow_images: bool = True, allow_placeholders: bool = False
) -> dict[str, Any]:
    """Validate a Tiptap document against the allowlist.

    Drops unknown nodes/marks/attrs. Strips images with unsafe src and
    link marks with unsafe href. Raises ValueError if the root isn't a
    `type='doc'` object, or if the tree exceeds depth/size caps.

    ``allow_images=False`` drops every image node, for a caller that has no way
    to resolve image srcs. ``allow_placeholders=True`` admits the
    ``placeholder://`` srcs the create paths (geolocation and request) resolve at
    intake (see ``PROOF_PLACEHOLDER_PREFIX``); no persisted doc keeps one.
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


def tiptap_doc_from_text(text: str) -> dict[str, Any]:
    """Build a minimal Tiptap proof document from plain text.

    One paragraph node per non-blank line; blank lines drop out. Used by the
    machine-detection assemble step to wrap a tweet / thread's cleaned text
    (from ``clean_proof_text``) into the JSONB proof shape every row carries.
    Empty or all-blank input yields an empty document
    (``{"type": "doc", "content": []}``).
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
                return None  # unsafe image — drop the node entirely
            cleaned[key] = safe
        elif node_type == "heading" and key == "level":
            if isinstance(value, int) and 1 <= value <= 6:
                cleaned[key] = value
        elif isinstance(value, (str, int, type(None))):
            cleaned[key] = value
    return cleaned
