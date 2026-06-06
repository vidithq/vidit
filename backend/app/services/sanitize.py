"""Server-side validation for Tiptap (ProseMirror) JSON documents.

Tiptap stores rich-text content as a tree of typed nodes. The frontend
trusts this tree; if an attacker bypasses the editor and submits raw
JSON via the API, malicious content (e.g. javascript: URLs in images,
tracking-pixel image hosts, off-domain link marks) could be stored and
rendered back to other viewers.

`sanitize_tiptap_doc` walks the tree against an allowlist of node types,
marks, and attributes; anything outside the allowlist is dropped.
URL-bearing attrs are constrained:
  - image.src: relative paths or the configured CloudFront/CDN host (or
    any https:// when no CDN is configured, e.g. local dev).
  - link.href (mark): http(s)://… only.
The walker also enforces depth and node-count caps to bound recursion
and storage cost.
"""

from typing import Any
from urllib.parse import urlparse

from app.config import settings
from app.services.storage import LOCAL_STORAGE_URL_PREFIX

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

# DoS guards. Tuned generously for legitimate analyses (a long writeup
# with ~20 images and bullet lists is comfortably under both bounds);
# tight enough to refuse pathological payloads.
_MAX_DEPTH = 32
_MAX_NODES = 5_000


def _safe_image_src(value: Any) -> str | None:
    """Image src must be relative or point at the configured CDN.

    Locally (no CloudFront configured) any https:// passes so dev media
    URLs work; in prod with `cloudfront_domain` set, only that host is
    allowed. As a dev escape hatch, http://localhost local-storage URLs
    are also accepted — but only when both `cloudfront_domain` is unset
    AND `storage_backend == "local"`, so a misconfigured staging env
    (CDN-less but pointed at an S3 backend, say) doesn't accidentally
    accept loopback URLs.
    """
    if not isinstance(value, str):
        return None
    # Reject protocol-relative URLs (``//evil.com/x``) BEFORE the relative-
    # path early-return below: the browser resolves them against the page's
    # scheme, so a persisted ``//attacker.example/pixel.gif`` would exfiltrate
    # every viewer's IP / UA / Referer when another analyst opens the
    # geolocation page. That defeats the central anti-tracking-pixel claim
    # of this sanitiser.
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

    Used after sanitization to link `proof_images` rows to the geolocation
    that referenced them. Returns srcs in tree order; deduped here so the
    caller can pass the result straight to a SQL `IN (...)`.
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


def sanitize_tiptap_doc(doc: Any) -> dict[str, Any]:
    """Validate a Tiptap document against the allowlist.

    Drops unknown nodes/marks/attrs. Strips images with unsafe src and
    link marks with unsafe href. Raises ValueError if the root isn't a
    `type='doc'` object, or if the tree exceeds depth/size caps.
    """
    if not isinstance(doc, dict) or doc.get("type") != "doc":
        raise ValueError("Tiptap document must be a JSON object with type='doc'")
    counter = [0]
    sanitized = _sanitize_node(doc, depth=0, counter=counter)
    if sanitized is None:
        return {"type": "doc", "content": []}
    sanitized.setdefault("content", [])
    return sanitized


def _sanitize_node(node: Any, *, depth: int, counter: list[int]) -> dict[str, Any] | None:
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
                _sanitize_node(child, depth=depth + 1, counter=counter) for child in raw_content
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
