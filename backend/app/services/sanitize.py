"""Server-side sanitisation of rich-text HTML (event proofs, collection descriptions).

An attacker can bypass the editor and POST raw HTML (scripts, event handlers,
``javascript:`` URLs, tracking-pixel image hosts), so :func:`sanitize_html`
parses it with ``nh3`` (html5ever plus ammonia) against a tag and attribute
allowlist and serialises the canonical result. Link and image URLs go through
:func:`safe_link_href` and :func:`_safe_image_src`; a refused URL drops the
attribute, and an image left without a ``src`` is dropped.

The allowlists and URL predicates mirror the front end (`lib/proof.tsx`);
a security fix to either side needs the other.
"""

import re
import secrets
from collections.abc import Mapping
from html import escape as html_escape
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlparse

import nh3

from app.config import settings
from app.services.storage import LOCAL_STORAGE_URL_PREFIX

# Src scheme for a not-yet-uploaded proof image (``placeholder://<filename>``,
# the file rides in the same multipart request). Intake resolves it before
# storing, so no persisted doc carries one. Mirrored by `lib/proofImages.ts`.
PROOF_PLACEHOLDER_PREFIX = "placeholder://"

# Every tag but ``img``, which only a proof carries. A tag outside the set is
# unwrapped (its text stays); ``script`` and ``style`` lose their content too.
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
# ``"*"`` empties ammonia's default generic set (``lang``, ``title``).
_ATTRIBUTES: dict[str, set[str]] = {"*": set(), "a": {"href"}, "img": {"src", "alt"}}
_VOID_TAGS = frozenset({"img", "hr", "br"})

# Blocks whose boundaries start a new line in :func:`html_text`.
_LINE_TAGS = frozenset({"p", "h2", "h3", "li", "blockquote", "pre", "ul", "ol", "hr", "br"})

# DoS guards, checked before parsing: html5ever's tree builder is quadratic in
# nesting depth, so the tag count bounds parse time (10,000 nested tags parse
# in about 0.1 s). A long writeup with ~20 images is well under all three.
_MAX_LENGTH = 200_000
_MAX_TAGS = 10_000
_MAX_DEPTH = 32

# Canonical output escapes ``"`` and ``>`` inside attribute values, so ``[^>]*``
# spans exactly one tag and `` src="`` cannot occur inside a value. An ``a``
# carries only ``href``, so a bare ``<a>`` lost it; the parser never nests
# links, so the lazy match pairs it with its own ``</a>``.
_BARE_IMG = re.compile(r'<img(?![^>]*\ssrc=")[^>]*>')
_BARE_LINK = re.compile(r"<a>(.*?)</a>", re.DOTALL)

# The editor writes U+FFFC into an empty block; it carries no text.
_OBJECT_REPLACEMENT = "\ufffc"


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
        # A bare prefix names no file; drop the image rather than 400 at intake.
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


def _check_size(html: str) -> None:
    if len(html) > _MAX_LENGTH:
        raise ValueError(f"Rich text exceeds max length ({_MAX_LENGTH} characters)")
    if html.count("<") > _MAX_TAGS:
        raise ValueError(f"Rich text exceeds max tag count ({_MAX_TAGS})")


class _DepthProbe(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.max_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _VOID_TAGS:
            return
        self.depth += 1
        self.max_depth = max(self.max_depth, self.depth)

    def handle_endtag(self, tag: str) -> None:
        if tag not in _VOID_TAGS:
            self.depth -= 1


def _clean(
    html: str,
    *,
    allow_images: bool,
    allow_placeholders: bool,
    src_map: Mapping[str, str] | None = None,
) -> str:
    # ammonia parses every ``href`` / ``src`` with the url crate before the
    # filter runs, and ``placeholder://<filename>`` puts the filename where a
    # host goes, so a space in it would fail that parse. Swapping the prefix
    # for a per-call relative path keeps the value for the filter to judge.
    marker = f"/{secrets.token_hex(16)}/"
    if allow_placeholders:
        html = html.replace(PROOF_PLACEHOLDER_PREFIX, marker)

    def attribute_filter(tag: str, attr: str, value: str) -> str | None:
        if allow_placeholders and value.startswith(marker):
            value = PROOF_PLACEHOLDER_PREFIX + value[len(marker) :]
        if tag == "a" and attr == "href":
            return safe_link_href(value)
        if tag == "img" and attr == "src":
            src = _safe_image_src(value, allow_placeholders=allow_placeholders)
            if src is not None and src_map is not None:
                return src_map.get(src, src)
            return src
        return value

    cleaned = nh3.clean(
        html,
        tags=_TEXT_TAGS | {"img"} if allow_images else _TEXT_TAGS,
        clean_content_tags={"script", "style"},
        attributes=_ATTRIBUTES,
        attribute_filter=attribute_filter,
        link_rel=None,
        url_schemes={"http", "https"},
    )
    cleaned = _BARE_LINK.sub(r"\1", _BARE_IMG.sub("", cleaned)).replace(_OBJECT_REPLACEMENT, "")
    if allow_placeholders:
        cleaned = cleaned.replace(marker, PROOF_PLACEHOLDER_PREFIX)
    return cleaned


def sanitize_html(html: str, *, allow_images: bool = True, allow_placeholders: bool = False) -> str:
    """The canonical, allowlisted form of a rich-text body.

    Keeps ``p``, ``h2``, ``h3``, ``strong``, ``em``, ``s``, ``code``, ``pre``,
    ``a[href]``, ``ul``, ``ol``, ``li``, ``blockquote``, ``hr``, ``br`` and
    ``img[src, alt]``. Any other tag is unwrapped with its text kept; ``script``
    and ``style`` lose their content too. A link whose href fails
    :func:`safe_link_href` becomes text; an image whose src fails
    :func:`_safe_image_src` is dropped. Raises ValueError over the size, tag
    count or depth caps.

    A body with no text (:func:`html_text`) and no image is ``""``, the empty
    body. ``allow_images=False`` drops every image. ``allow_placeholders=True``
    admits ``placeholder://`` srcs for the create paths (see
    ``PROOF_PLACEHOLDER_PREFIX``).
    """
    _check_size(html)
    cleaned = _clean(html, allow_images=allow_images, allow_placeholders=allow_placeholders)
    probe = _DepthProbe()
    probe.feed(cleaned)
    probe.close()
    if probe.max_depth > _MAX_DEPTH:
        raise ValueError(f"Rich text exceeds max depth ({_MAX_DEPTH})")
    if not html_text(cleaned) and not extract_image_srcs(cleaned):
        return ""
    return cleaned


def sanitize_html_or_raise(
    html: str,
    *,
    error: type[Exception],
    allow_images: bool = True,
    allow_placeholders: bool = False,
) -> str:
    """Sanitise a body, raising ``error`` where the sanitiser raises ``ValueError``.

    Routers map typed service errors by ``code``
    (``routers/_errors.raise_typed_error``), so the ValueError must become one
    first. Callers: ``services/events/rules._sanitize_proof`` and
    ``services/collections._checked_description``. ``error`` is a parameter so
    each service owns its vocabulary without importing the other; the message
    passes through unchanged.
    """
    try:
        return sanitize_html(html, allow_images=allow_images, allow_placeholders=allow_placeholders)
    except ValueError as exc:
        raise error(str(exc)) from exc


def rewrite_image_srcs(html: str, src_map: Mapping[str, str]) -> str:
    """A sanitised proof body with each image src in ``src_map`` swapped for its value.

    Intake's ``placeholder://`` to stored-URL rewrite. The swap runs inside the
    sanitiser, so the result stays canonical. Mapped URLs are ones storage
    minted, so they skip the host check.
    """
    return _clean(html, allow_images=True, allow_placeholders=True, src_map=src_map)


def _escape_attr(value: str) -> str:
    # The escaping html5ever's serialiser applies, so the result stays canonical.
    return value.replace("&", "&amp;").replace('"', "&quot;").replace(" ", "&nbsp;")


def html_from_text(text: str, *, image_srcs: list[str] | None = None) -> str:
    """One paragraph per non-blank line, then one ``img`` per src; empty input yields ``""``.

    Wraps machine-detected text (``clean_proof_text``) into the proof shape.
    ``image_srcs`` are URLs storage minted, so they skip the host check.
    """
    paragraphs = "".join(
        f"<p>{html_escape(line, quote=False)}</p>" for line in text.split("\n") if line.strip()
    )
    images = "".join(f'<img src="{_escape_attr(src)}">' for src in image_srcs or [])
    return sanitize_html(paragraphs, allow_images=False) + images


class _TextProjection(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lines: list[str] = []
        self.current: list[str] = []

    def flush(self) -> None:
        text = "".join(self.current)
        self.current.clear()
        self.lines.extend(line.strip() for line in text.split("\n") if line.strip())

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _LINE_TAGS:
            self.flush()

    def handle_endtag(self, tag: str) -> None:
        if tag in _LINE_TAGS:
            self.flush()

    def handle_data(self, data: str) -> None:
        self.current.append(data.replace(_OBJECT_REPLACEMENT, ""))


def html_text(html: str) -> str:
    """The plain-text projection of a sanitised rich-text body.

    The one reader of a rich-text body as text: the search index
    (``collections.description_text``, ``services/search._collection_tsvector``),
    the card clamp, the share card, and the length cap in ``services/collections``.

    Text concatenates with entities decoded and U+FFFC dropped. Every ``p``,
    ``h2``, ``h3``, ``li``, ``blockquote``, ``pre``, ``ul``, ``ol`` and ``hr``
    boundary and every ``br`` starts a new line, and so does a newline in the
    text (``pre`` keeps its own). Lines are stripped, blank lines drop out, and
    the rest join with ``\\n``.

    Mirrored by ``lib/proof.tsx::htmlText``; change both.
    """
    parser = _TextProjection()
    parser.feed(html)
    parser.close()
    parser.flush()
    return "\n".join(parser.lines)


class _UrlCollector(HTMLParser):
    def __init__(self, tag: str, attr: str) -> None:
        super().__init__(convert_charrefs=True)
        self.tag = tag
        self.attr = attr
        self.values: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != self.tag:
            return
        for name, value in attrs:
            if name == self.attr and value is not None and value not in self.values:
                self.values.append(value)


def _collect(html: str, tag: str, attr: str) -> list[str]:
    collector = _UrlCollector(tag, attr)
    collector.feed(html)
    collector.close()
    return collector.values


def extract_image_srcs(html: str) -> list[str]:
    """Image srcs of a rich-text body (sanitised or not), in document order, deduped."""
    return _collect(html, "img", "src")


def extract_link_hrefs(html: str) -> list[str]:
    """Link hrefs of a rich-text body (sanitised or not), in document order, deduped.

    Only ``http(s)`` hrefs come back: :func:`safe_link_href` is re-applied
    because a row stored before a rule tightened is still readable.
    """
    return [href for href in _collect(html, "a", "href") if safe_link_href(href) is not None]
