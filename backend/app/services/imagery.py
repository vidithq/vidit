"""Imagery providers: whether a reader can reopen a satellite or aircraft image at its date.

The one home of the provider list (``docs/imagery.md`` renders it): each provider's hosts, the
permalink shape a reader reopens, the credit line and a one-line help. The event forms read it
through ``POST /sources/check``, every ``SourceRead`` carries the warnings it computes, and the
import's context hosts (``tweet_ingest.urls.CONTEXT_HOSTS``) take their imagery rows from it.

A check never refuses an event's source: :func:`source_warnings` describes what keeps a reader
from reopening the image, and the write goes through. A site source is refused when no link
reopens it (:func:`can_reopen`, read by ``services/sites``). Pure string work, no I/O, no app
import, so the ingest vocabulary can read it.
"""

from __future__ import annotations

import base64
import binascii
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from urllib.parse import parse_qs, unquote, urlparse

# The source kinds a provider check applies to, a subset of ``models/source.SourceKind``.
ImageryKind = Literal["satellite", "aircraft"]
IMAGERY_KINDS: tuple[ImageryKind, ...] = ("satellite", "aircraft")

# ``accepted``: a permalink reopens the image at its date, and its shape is checked.
# ``other``: reopenable with a link and a capture date, no shape to check.
# ``aircraft_archive``: a national archive of aerial photos, reopened by frame or mission id.
# ``not_reopenable``: no reader can reopen the same image at the same date.
ProviderGroup = Literal["accepted", "other", "aircraft_archive", "not_reopenable"]

SourceWarningCode = Literal[
    "provider_unknown",
    "provider_not_reopenable",
    "short_link",
    "permalink_shape",
    "capture_date_missing",
]


@dataclass(frozen=True)
class _Url:
    host: str
    path: str
    # The query and the fragment parameters together: Wayback keeps its state in the fragment.
    params: dict[str, list[str]]


# A shape check answers the sentence that says what the permalink lacks, or ``None``.
ShapeCheck = Callable[[_Url], str | None]


@dataclass(frozen=True)
class ImageryProvider:
    id: str
    name: str
    group: ProviderGroup
    # The kinds of image it serves; the first is the kind an imported link takes.
    kinds: tuple[ImageryKind, ...]
    # ``(base host, path prefix)``: a base matches itself and its subdomains, ``""`` is any path.
    hosts: tuple[tuple[str, str], ...]
    # The line a published image carries; ``""`` for a provider that cannot be reopened.
    credit: str
    # How a reader reopens the image, or why no reader can.
    help: str
    shape: ShapeCheck | None = None


@dataclass(frozen=True)
class ImageryWarning:
    code: SourceWarningCode
    message: str
    # The link the warning is about; ``None`` for the whole source.
    url: str | None = None


@dataclass(frozen=True)
class LinkCheck:
    """One link of a source as the check reads it."""

    url: str
    # A snapshot is recorded: an unlisted page then reads as a third-party publication.
    archived: bool = False


# ── Permalink shapes ──────────────────────────────────────────────────────

_ISO_DAY_RE = re.compile(rb"\d{4}-\d{2}-\d{2}")


def _google_earth_shape(url: _Url) -> str | None:
    if not url.path.startswith("/web/@"):
        return (
            "Copy the link from the Google Earth web view: it starts with earth.google.com/web/@."
        )
    # The ``data`` segment is URL-safe base64 of an undocumented protobuf; the historical imagery
    # day is the one ASCII ``YYYY-MM-DD`` in it.
    match = re.search(r"/data=([A-Za-z0-9_-]+)", url.path)
    if match is not None:
        encoded = match.group(1)
        try:
            decoded = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        except (binascii.Error, ValueError):
            decoded = b""
        if _ISO_DAY_RE.search(decoded):
            return None
    return (
        "The link carries no imagery date. Turn on historical imagery, step to the capture day, "
        "and copy the link again."
    )


_COPERNICUS_PARAMS = ("lat", "lng", "zoom", "datasetId", "layerId", "fromTime", "toTime")
_COPERNICUS_DATASET_RE = re.compile(r"^(?:S2_L2A_CDAS|S2_L1C_CDAS|S1_CDAS_\w+)$")


def _copernicus_shape(url: _Url) -> str | None:
    missing = [name for name in _COPERNICUS_PARAMS if not url.params.get(name, [""])[0]]
    if missing:
        return (
            f"The link lacks {', '.join(missing)}. Copy the full link from the address bar, "
            "not a short link."
        )
    dataset = url.params["datasetId"][0]
    # An unknown id silently opens Sentinel-2, so a reader would see another image.
    if _COPERNICUS_DATASET_RE.match(dataset) is None:
        return (
            f"The dataset {dataset} is not one Copernicus Browser reopens: use S2_L2A_CDAS, "
            "S2_L1C_CDAS or an S1_CDAS dataset."
        )
    return None


_WAYBACK_CENTRE_RE = re.compile(r"^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?(?:,\d+(?:\.\d+)?)?$")


def _wayback_shape(url: _Url) -> str | None:
    release = url.params.get("active", [""])[0]
    centre = url.params.get("mapCenter", [""])[0]
    if release.isdigit() and _WAYBACK_CENTRE_RE.match(centre):
        return None
    return (
        "The link lacks the release (active) or the map centre (mapCenter). Pick the release, "
        "then copy the link again."
    )


_EARTHEXPLORER_SCENE_RE = re.compile(r"^/scene/metadata/full/[^/]+/[^/]+/?$")


def _earthexplorer_shape(url: _Url) -> str | None:
    if _EARTHEXPLORER_SCENE_RE.match(url.path):
        return None
    return (
        "Link the scene's metadata page: "
        "earthexplorer.usgs.gov/scene/metadata/full/<dataset>/<entity>/."
    )


_WORLDVIEW_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def _worldview_shape(url: _Url) -> str | None:
    if not _WORLDVIEW_DAY_RE.match(url.params.get("t", [""])[0]):
        return "The link carries no date (t=). Pick the day, then copy the link again."
    if not url.params.get("l", [""])[0]:
        return "The link carries no layer (l=). Pick the imagery layer, then copy the link again."
    return None


# ── The provider list ─────────────────────────────────────────────────────

_DATELESS = (
    "shows no capture date, so no reader can reopen the same image. Use Google Earth web "
    "historical imagery or Esri World Imagery Wayback."
)
_ACCOUNT_ONLY = (
    "needs an account, so a reader cannot reopen the image. Cite the image through an "
    "accepted provider, or link a publication that shows it."
)
_OPEN_SAR = "Link the open data item and give its acquisition date as the capture date."


def _dateless(id_: str, name: str, *hosts: tuple[str, str]) -> ImageryProvider:
    return ImageryProvider(
        id_, name, "not_reopenable", ("satellite",), hosts, "", f"{name} {_DATELESS}"
    )


def _account_only(id_: str, name: str, *hosts: tuple[str, str]) -> ImageryProvider:
    return ImageryProvider(
        id_, name, "not_reopenable", ("satellite",), hosts, "", f"{name} {_ACCOUNT_ONLY}"
    )


# The first entry whose host matches wins, so a narrower path comes before its host's whole.
PROVIDERS: tuple[ImageryProvider, ...] = (
    ImageryProvider(
        "google_earth",
        "Google Earth web",
        "accepted",
        ("satellite",),
        (("earth.google.com", ""), ("google.com", "/earth")),
        "Google and every provider listed in Data attribution",
        "Turn on historical imagery, step to the capture day and copy the link: it carries the "
        "date. Google Earth Pro has no link, so reopen the same date in Google Earth web.",
        _google_earth_shape,
    ),
    ImageryProvider(
        "copernicus_browser",
        "Copernicus Browser",
        "accepted",
        ("satellite",),
        (("browser.dataspace.copernicus.eu", ""),),
        "Copernicus Sentinel data [year]",
        "Pick the day and the layer, then copy the full link from the address bar. It opens "
        "without an account.",
        _copernicus_shape,
    ),
    ImageryProvider(
        "esri_wayback",
        "Esri World Imagery Wayback",
        "accepted",
        ("satellite",),
        (("livingatlas.arcgis.com", "/wayback"),),
        "Esri, Vantor, Earthstar Geographics, and the GIS User Community",
        "Pick the release and copy the link. The capture date is in the popup a click on the map "
        "opens, not the release date.",
        _wayback_shape,
    ),
    ImageryProvider(
        "usgs_earthexplorer",
        "USGS EarthExplorer",
        "accepted",
        ("satellite", "aircraft"),
        (("earthexplorer.usgs.gov", ""),),
        "[Product] image courtesy of the U.S. Geological Survey",
        "Link the scene's metadata page, which names the entity id and the acquisition date: "
        "Landsat, declassified CORONA, KH-7 and KH-9, and aerial photo single frames.",
        _earthexplorer_shape,
    ),
    ImageryProvider(
        "nasa_worldview",
        "NASA Worldview",
        "accepted",
        ("satellite",),
        (("worldview.earthdata.nasa.gov", ""),),
        "NASA Worldview",
        "Pick the day and the layers, then copy the link: it carries the date. Its resolution "
        "suits fires, smoke and floods, not landmark matching.",
        _worldview_shape,
    ),
    ImageryProvider(
        "umbra",
        "Umbra Open Data",
        "other",
        ("satellite",),
        (
            ("umbra.space", ""),
            ("umbra-open-data-catalog.s3.amazonaws.com", ""),
            ("registry.opendata.aws", "/umbra-open-data"),
        ),
        "Umbra, CC BY 4.0",
        _OPEN_SAR,
    ),
    ImageryProvider(
        "capella",
        "Capella Space Open Data",
        "other",
        ("satellite",),
        (("capellaspace.com", ""), ("registry.opendata.aws", "/capella_opendata")),
        "Capella Space, CC BY 4.0",
        _OPEN_SAR,
    ),
    ImageryProvider(
        "iceye",
        "ICEYE Open Data",
        "other",
        ("satellite",),
        (("iceye.com", ""),),
        "ICEYE, CC BY 4.0",
        _OPEN_SAR,
    ),
    ImageryProvider(
        "vantor_open_data",
        "Vantor Open Data",
        "other",
        ("satellite",),
        (
            ("vantor.com", ""),
            ("registry.opendata.aws", "/vantor-open-data"),
            ("registry.opendata.aws", "/maxar-open-data"),
        ),
        "Vantor, CC BY-NC 4.0",
        "Link the open data item and give its acquisition date as the capture date. The licence "
        "allows non-commercial use only.",
    ),
    ImageryProvider(
        "apollo_image_hunter",
        "Apollo Image Hunter",
        "other",
        ("satellite",),
        (("apollomapping.com", ""),),
        "The satellite operator named in Image Info",
        "Its page holds no link to a scene: put the catalog ID in the source title, so a reader "
        "finds it with Catalog ID search, and give the acquisition date as the capture date.",
    ),
    ImageryProvider(
        "ign_remonter_le_temps",
        "IGN Remonter le temps",
        "aircraft_archive",
        ("aircraft",),
        (("remonterletemps.ign.fr", ""),),
        "IGN, Remonter le temps",
        "Link the photo, put the mission and photo id in the source title, and give the shooting "
        "date as the capture date.",
    ),
    ImageryProvider(
        "swisstopo",
        "swisstopo",
        "aircraft_archive",
        ("aircraft",),
        (("map.geo.admin.ch", ""), ("swisstopo.admin.ch", "")),
        "swisstopo",
        "Link the aerial photo on map.geo.admin.ch, put the image number in the source title, "
        "and give the flight date as the capture date.",
    ),
    _dateless("google_maps", "Google Maps", ("maps.google.com", ""), ("google.com", "/maps")),
    _dateless("bing_maps", "Bing Maps", ("bing.com", "/maps")),
    _dateless("apple_maps", "Apple Maps", ("maps.apple.com", "")),
    _dateless(
        "yandex_maps",
        "Yandex Maps",
        ("yandex.ru", "/maps"),
        ("yandex.com", "/maps"),
        ("yandex.ua", "/maps"),
    ),
    _account_only("planet", "Planet", ("planet.com", "")),
    _account_only("airbus_oneatlas", "Airbus OneAtlas", ("oneatlas.airbus.com", "")),
    _account_only("skyfi", "SkyFi", ("skyfi.com", "")),
    ImageryProvider(
        "eosda_landviewer",
        "EOSDA LandViewer",
        "not_reopenable",
        ("satellite",),
        (("eos.com", "/landviewer"), ("eos.com", "/products/landviewer")),
        "",
        "EOSDA LandViewer needs an account and its terms forbid sharing the source imagery. Open "
        "the same Sentinel or Landsat scene in Copernicus Browser or USGS EarthExplorer.",
    ),
    ImageryProvider(
        "earth_engine_timelapse",
        "Earth Engine Timelapse",
        "not_reopenable",
        ("satellite",),
        (("earthengine.google.com", "/timelapse"), ("timelapse.withgoogle.com", "")),
        "",
        "Earth Engine Timelapse shows yearly composites, not an image of one day. Use Google "
        "Earth web historical imagery or Copernicus Browser.",
    ),
    ImageryProvider(
        "nasa_firms",
        "NASA FIRMS",
        "not_reopenable",
        ("satellite",),
        (("firms.modaps.eosdis.nasa.gov", ""),),
        "",
        "NASA FIRMS shows thermal detections, not an image. Use NASA Worldview for the imagery "
        "of the day.",
    ),
    ImageryProvider(
        "eo_browser",
        "Sentinel Hub EO Browser",
        "not_reopenable",
        ("satellite",),
        (("sentinel-hub.com", ""),),
        "",
        "Sentinel Hub EO Browser closed on 2026-03-20. Open the same scene in Copernicus Browser.",
    ),
)

# Shorteners: the stored link must be the expanded one, since a short link rots (Firebase
# Dynamic Links already 404).
SHORT_LINK_HOSTS: tuple[str, ...] = (
    "page.link",
    "goo.gl",
    "g.co",
    "bit.ly",
    "rebrand.ly",
    "tinyurl.com",
    "t.co",
    "t.ly",
    "ow.ly",
    "buff.ly",
    "is.gd",
    "cutt.ly",
    "rb.gy",
    "shorturl.at",
    "arcg.is",
    "s.geo.admin.ch",
)


def _host_matches(host: str, base: str) -> bool:
    return host == base or host.endswith("." + base)


def _parse(url: str) -> _Url | None:
    try:
        parsed = urlparse(url.strip())
        host = (parsed.hostname or "").lower()
    except ValueError:
        return None
    if not host:
        return None
    params = parse_qs(parsed.query)
    for name, values in parse_qs(parsed.fragment).items():
        params.setdefault(name, values)
    # ``mapCenter`` may arrive with an encoded comma.
    params = {name: [unquote(v) for v in values] for name, values in params.items()}
    return _Url(host=host, path=parsed.path, params=params)


def provider_of(url: str) -> ImageryProvider | None:
    """The provider ``url`` opens, or ``None`` for an unlisted or unparsable link."""
    parsed = _parse(url)
    if parsed is None:
        return None
    path = parsed.path.lower()
    for provider in PROVIDERS:
        for base, prefix in provider.hosts:
            if _host_matches(parsed.host, base) and path.startswith(prefix):
                return provider
    return None


def is_short_link(url: str) -> bool:
    parsed = _parse(url)
    return parsed is not None and any(_host_matches(parsed.host, b) for b in SHORT_LINK_HOSTS)


def _reopens(link: LinkCheck) -> bool:
    """A listed provider a reader can reopen, or an unlisted publication with an archived copy."""
    if is_short_link(link.url):
        return False
    provider = provider_of(link.url)
    if provider is None:
        return link.archived
    return provider.group != "not_reopenable"


def can_reopen(links: Sequence[LinkCheck]) -> bool:
    """Whether at least one link lets a reader reopen the image."""
    return any(_reopens(link) for link in links)


def image_provider(urls: Sequence[str]) -> ImageryProvider | None:
    """The provider an image is credited to: the first link on a reopenable listed provider,
    else the first link on any listed provider."""
    providers = [p for p in map(provider_of, urls) if p is not None]
    reopenable = [p for p in providers if p.group != "not_reopenable"]
    return next(iter(reopenable or providers), None)


def _suggested(kind: str) -> str:
    names = [
        p.name for p in PROVIDERS if p.group in ("accepted", "aircraft_archive") and kind in p.kinds
    ]
    return ", ".join(names[:-1]) + " or " + names[-1]


def source_warnings(
    kind: str, captured_at: datetime | None, links: Sequence[LinkCheck]
) -> list[ImageryWarning]:
    """What keeps a reader from reopening a satellite or aircraft source's image at its date.

    Empty for every other kind. A link of an unlisted host that carries an archived copy reads
    as a third-party publication of the image, which a reader reopens from the copy.
    """
    if kind not in IMAGERY_KINDS:
        return []
    warnings: list[ImageryWarning] = []
    unlisted = False
    for link in links:
        if is_short_link(link.url):
            warnings.append(
                ImageryWarning(
                    "short_link",
                    "A short link stops working when its service closes. Open it and paste the "
                    "full link instead.",
                    link.url,
                )
            )
            continue
        provider = provider_of(link.url)
        if provider is None:
            unlisted = unlisted or not link.archived
            continue
        if provider.group == "not_reopenable":
            warnings.append(ImageryWarning("provider_not_reopenable", provider.help, link.url))
            continue
        parsed = _parse(link.url)
        problem = provider.shape(parsed) if provider.shape and parsed else None
        if problem is not None:
            warnings.append(
                ImageryWarning("permalink_shape", f"{provider.name}: {problem}", link.url)
            )
    if unlisted and not can_reopen(links):
        warnings.append(
            ImageryWarning(
                "provider_unknown",
                "No link opens a listed imagery provider. Link a permalink from "
                f"{_suggested(kind)}, or archive the publication that shows the image.",
            )
        )
    if captured_at is None:
        warnings.append(
            ImageryWarning(
                "capture_date_missing",
                "Give the capture date: a reader needs it to reopen the same image.",
            )
        )
    return warnings
