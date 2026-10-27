"""Server-side sanitisation of rich-text HTML (event proofs, collection descriptions).

The rules are in ``docs/api.md`` (Rich text). The allowlists and URL predicates
mirror the front end (`lib/proof.tsx`); a security fix to either side needs the
other.
"""

import re
import secrets
from collections.abc import Mapping
from html import escape as html_escape
from html.parser import HTMLParser
from urllib.parse import urlparse

import nh3

from app.config import settings
from app.services.storage import LOCAL_STORAGE_URL_PREFIX

# Src scheme for a not-yet-uploaded proof image (``placeholder://<filename>``,
# the file rides in the same multipart request). Intake resolves it before
# storing, so no persisted body carries one. Mirrored by `lib/proofImages.ts`.
PROOF_PLACEHOLDER_PREFIX = "placeholder://"

# Every tag but ``img``, which only a proof carries.
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

_LINE_TAGS = frozenset({"p", "h2", "h3", "li", "blockquote", "pre", "ul", "ol", "hr", "br"})

# DoS guards, checked before parsing: html5ever's tree builder is quadratic in
# nesting depth, so the tag count bounds parse time (10,000 nested tags parse
# in about 0.1 s). A long writeup with ~20 images is well under both.
_MAX_LENGTH = 200_000
_MAX_TAGS = 10_000
# The read view (html-react-parser) recurses per level and overflows the
# browser stack near 2,500 nested tags, which the tag cap alone allows.
_MAX_DEPTH = 32
_VOID_TAGS = frozenset({"img", "br", "hr"})
# html5ever reopens each active formatting element (b, code, em, font, ...; an
# ``a`` never stacks) in every new block, and keeps at most three copies of a
# tag with identical attributes, so N unclosed tags with distinct attributes and
# M blocks build N x M nodes (50 KB built 1.2 GB). Capping the distinct tags
# bounds that list at three copies each: at the cap, the tag-count limit costs
# about 0.05 s and 64 MB. Two tags count as one only when their source text is
# identical and fits ``_PLAIN_TAG_REST``, a span html5ever reads the same way;
# any other formatting tag counts on its own.
_MAX_FORMATTING_TAGS = 16
_FORMATTING_TAG = re.compile(
    r"<(?:b|big|code|em|font|i|nobr|s|small|strike|strong|tt|u)(?=[\t\n\f\r />])", re.IGNORECASE
)
_PLAIN_TAG_REST = re.compile(
    r"""(?:[\t\n\f\r ]++[^\t\n\f\r />"'<=]++(?:=(?:"[^"]*+"|'[^']*+'|[^\t\n\f\r >"'<=`]++))?)*+"""
    r"[\t\n\f\r ]*+/?>"
)

# Canonical output quotes every attribute value and escapes ``"``, ``<`` and
# ``>`` inside it, so a tag reads as a run of `` name="value"`` tokens and a
# value cannot fake a ``src`` token. An ``a`` carries only ``href``, so a bare
# ``<a>`` lost it; the parser never nests links, so the lazy match pairs it
# with its own ``</a>``.
_BARE_IMG = re.compile(r'<img(?:\s(?!src=)[a-z-]+="[^"]*")*>')
_BARE_LINK = re.compile(r"<a>(.*?)</a>", re.DOTALL)

# The editor writes U+FFFC into an empty block; it carries no text.
_OBJECT_REPLACEMENT = "\ufffc"


def _safe_image_src(value: str, *, allow_placeholders: bool = False) -> str | None:
    """The src if it is relative or on the configured media host, else ``None``.

    Mirrored by ``isSafeImageSrc`` (`lib/proof.tsx`).
    """
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


def safe_link_href(value: str) -> str | None:
    """The value if it is an ``http(s)://`` URL with a host, else ``None``.

    Mirrored by ``isSafeLinkHref`` (`lib/proof.tsx`).
    """
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

    Shared by :func:`source_archive._normalised_target` and :func:`platform_host`,
    so ``tiktok.com`` and ``www.tiktok.com`` are one source. Returns ``None`` when
    no host reads, malformed input included.
    """
    try:
        parsed = urlparse(value)
    except ValueError:
        return None
    return (parsed.hostname or "").lower().removeprefix("www.") or None


# The hosts of one platform, canonical first. Bare hosts: ``normalised_host``
# folds ``www.``. ``schemas/user.SOCIAL_PROFILE_HOSTS`` reads its rows.
PLATFORM_HOSTS: dict[str, tuple[str, ...]] = {
    "x": ("x.com", "twitter.com", "mobile.twitter.com"),
    "youtube": ("youtube.com", "m.youtube.com", "youtu.be"),
    "telegram": ("t.me", "telegram.me"),
    "tiktok": ("tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"),
    "github": ("github.com",),
}

_CANONICAL_HOST = {alias: hosts[0] for hosts in PLATFORM_HOSTS.values() for alias in hosts}


def platform_host(value: str) -> str | None:
    """:func:`normalised_host`, with an alias in :data:`PLATFORM_HOSTS` folded onto
    its platform's canonical host (``twitter.com`` reads ``x.com``)."""
    host = normalised_host(value)
    return _CANONICAL_HOST.get(host, host) if host else None


def _check_size(html: str) -> None:
    if len(html) > _MAX_LENGTH:
        raise ValueError(f"Rich text exceeds max length ({_MAX_LENGTH} characters)")
    if html.count("<") > _MAX_TAGS:
        raise ValueError(f"Rich text exceeds max tag count ({_MAX_TAGS})")
    distinct: set[str] = set()
    unparsed = 0
    for tag in _FORMATTING_TAG.finditer(html):
        rest = _PLAIN_TAG_REST.match(html, tag.end())
        if rest is None:
            unparsed += 1
        else:
            distinct.add(html[tag.start() : rest.end()])
        if len(distinct) + unparsed > _MAX_FORMATTING_TAGS:
            raise ValueError(
                f"Rich text exceeds max distinct formatting tags ({_MAX_FORMATTING_TAGS})"
            )


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
    """The canonical, allowlisted form of a rich-text body; raises ValueError over a cap."""
    _check_size(html)
    cleaned = _clean(html, allow_images=allow_images, allow_placeholders=allow_placeholders)
    reader = _Reader(cleaned)
    if reader.max_depth > _MAX_DEPTH:
        raise ValueError(f"Rich text exceeds max nesting depth ({_MAX_DEPTH})")
    if "<img " not in cleaned and not reader.lines:
        return ""
    return cleaned


def rewrite_image_srcs(html: str, src_map: Mapping[str, str]) -> str:
    """A sanitised proof body with each image src in ``src_map`` swapped for its value.

    The swap runs inside the sanitiser, so the result stays canonical. Mapped
    URLs are ones storage minted, so they skip the host check.
    """
    return _clean(html, allow_images=True, allow_placeholders=True, src_map=src_map)


def html_from_text(text: str, *, image_srcs: list[str] | None = None) -> str:
    """One paragraph per non-blank line, then one ``img`` per src; empty input yields ``""``.

    The srcs are ones storage minted, so like :func:`rewrite_image_srcs` they
    skip the host check.
    """
    paragraphs = "".join(
        f"<p>{html_escape(line, quote=False)}</p>" for line in text.split("\n") if line.strip()
    )
    minted = {f"{PROOF_PLACEHOLDER_PREFIX}{i}": src for i, src in enumerate(image_srcs or [])}
    images = "".join(f'<img src="{placeholder}">' for placeholder in minted)
    return sanitize_html(paragraphs, allow_images=False) + rewrite_image_srcs(images, minted)


class _Reader(HTMLParser):
    """One pass over a body: its text lines, image srcs and link hrefs."""

    _URL_ATTRS = {"img": "src", "a": "href"}

    def __init__(self, html: str) -> None:
        super().__init__(convert_charrefs=True)
        self.lines: list[str] = []
        self.current: list[str] = []
        self.urls: dict[str, list[str]] = {"img": [], "a": []}
        self.depth = 0
        self.max_depth = 0
        self.feed(html)
        self.close()
        self.flush()

    def flush(self) -> None:
        text = "".join(self.current)
        self.current.clear()
        self.lines.extend(line.strip() for line in text.split("\n") if line.strip())

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag not in _VOID_TAGS:
            self.depth += 1
            self.max_depth = max(self.max_depth, self.depth)
        if tag in _LINE_TAGS:
            self.flush()
        if tag in self._URL_ATTRS:
            wanted = self._URL_ATTRS[tag]
            self.urls[tag].extend(v for name, v in attrs if name == wanted and v is not None)

    def handle_endtag(self, tag: str) -> None:
        if tag not in _VOID_TAGS:
            self.depth -= 1
        if tag in _LINE_TAGS:
            self.flush()

    def handle_data(self, data: str) -> None:
        self.current.append(data)


def html_text(html: str) -> str:
    """The plain-text projection of a sanitised rich-text body.

    Mirrored by ``lib/proof.tsx::htmlText``; change both.
    """
    return "\n".join(_Reader(html).lines)


def extract_image_srcs(html: str) -> list[str]:
    """Image srcs of a rich-text body, in document order, deduped."""
    return list(dict.fromkeys(_Reader(html).urls["img"]))
