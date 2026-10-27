"""Refresh the self-hosted map files in an S3-compatible bucket.

One pass copies the latest OpenFreeMap planet, its icon sprite, the Natural
Earth relief of the Streets style and the elevation tiles of the relief, checks
each, then names them in ``latest.json``, which the frontend reads
(docs/engineering.md#self-hosted-map-files). Every step skips work already
done, and a failure leaves the files ``latest.json`` names in place.
"""

import gzip
import hashlib
import io
import json
import logging
import math
import os
import re
import time
import uuid
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import boto3
import httpx
from botocore.config import Config
from botocore.exceptions import ClientError
from pmtiles.tile import Compression, TileType, deserialize_header, tileid_to_zxy
from pmtiles.writer import Writer

from app.config import settings

logger = logging.getLogger(__name__)

USER_AGENT = "Vidit-update-map/1 (+https://github.com/vidithq/vidit)"

SPRITE_STYLE_URL = "https://tiles.openfreemap.org/styles/dark"
SPRITE_URL_PREFIX = "https://tiles.openfreemap.org/sprites/"
SPRITE_FILES = {
    "ofm.json": "application/json",
    "ofm.png": "image/png",
    "ofm@2x.json": "application/json",
    "ofm@2x.png": "image/png",
}
NATURAL_EARTH_TILES = "https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png"
# The zoom range of the `ne2_shaded` source in the Liberty style.
NATURAL_EARTH_MAX_ZOOM = 6
RELIEF_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

PLANET_MAX_ZOOM = 14
# The OpenMapTiles layers the Vidit and Streets styles cannot draw without. An area extract may
# lack others, such as `aerodrome_label`.
REQUIRED_VECTOR_LAYERS = frozenset(
    {"boundary", "building", "landcover", "landuse", "place", "transportation", "water"}
)
VERSION_PATTERN = re.compile(r"^\d{8}_\d{6}_pt$")
COMPLETE_VERSION_FILES = frozenset({"done", "SHA256SUMS", "tiles.pmtiles"})

LATEST_KEY = "latest.json"
# Mirrored by frontend components/map/mapAssets.ts FIELDS; change both.
LATEST_FIELDS = ("planet", "sprite", "natural_earth", "relief")
ATTRIBUTION = {
    "planet": "OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors",
    "natural_earth": "Natural Earth, public domain",
    "relief": "Terrain Tiles on AWS Open Data: USGS, NOAA, Copernicus EU-DEM and others "
    "(https://github.com/tilezen/joerd/blob/master/docs/attribution.md)",
}
IMMUTABLE = "public, max-age=31536000, immutable"

# S3 allows 10,000 parts of at most 5 GiB. 64 MiB parts hold a 640 GB file; the part size grows
# past that. The job holds about two parts in memory.
MIN_PART_SIZE = 64 * 1024 * 1024
MAX_PART_SIZE = 5 * 1024**3
MAX_PARTS = 10_000
RESUME_ATTEMPTS = 5
TILE_ATTEMPTS = 4
FETCH_WORKERS = 32
FETCH_BATCH = 256
PROGRESS_SECONDS = 30.0

MERCATOR_BOUNDS = {
    "min_lon_e7": -1_800_000_000,
    "min_lat_e7": -850_511_287,
    "max_lon_e7": 1_800_000_000,
    "max_lat_e7": 850_511_287,
}


class MapUpdateError(RuntimeError):
    """A step failed; the files ``latest.json`` names stay as they were."""


@dataclass(frozen=True)
class MapConfig:
    bucket: str
    prefix: str
    keep_planets: int
    relief_max_zoom: int
    source_url: str
    area: str
    planet_version: str = ""
    natural_earth_max_zoom: int = NATURAL_EARTH_MAX_ZOOM

    @classmethod
    def from_settings(cls) -> "MapConfig":
        if not settings.map_bucket:
            raise MapUpdateError("MAP_BUCKET is not set")
        return cls(
            bucket=settings.map_bucket,
            prefix=settings.map_prefix.strip("/"),
            keep_planets=settings.map_keep_planets,
            relief_max_zoom=settings.map_relief_max_zoom,
            source_url=settings.map_source_url.rstrip("/"),
            area=settings.map_area,
            planet_version=settings.map_planet_version,
        )

    def key(self, name: str) -> str:
        return f"{self.prefix}/{name}" if self.prefix else name


LOCAL_SCHEME = "file://"


class LocalBucket:
    """The calls the pass makes on a boto3 S3 client, on a local folder. Any static HTTP server
    that answers byte ranges then serves the folder as the map files' base URL."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root):
            raise MapUpdateError(f"{key}: outside {self.root}")
        return path

    def _file(self, key: str, operation: str) -> Path:
        path = self._path(key)
        if not path.is_file():
            raise ClientError({"Error": {"Code": "NoSuchKey", "Message": key}}, operation)
        return path

    def head_object(self, *, Key: str, **_: Any) -> dict[str, Any]:
        return {"ContentLength": self._file(Key, "HeadObject").stat().st_size, "Metadata": {}}

    def get_object(self, *, Key: str, Range: str = "", **_: Any) -> dict[str, Any]:
        with self._file(Key, "GetObject").open("rb") as f:
            if not Range:
                return {"Body": io.BytesIO(f.read())}
            start, end = (int(n) for n in Range.removeprefix("bytes=").split("-"))
            f.seek(start)
            return {"Body": io.BytesIO(f.read(end - start + 1))}

    def put_object(self, *, Key: str, Body: bytes, **_: Any) -> None:
        upload = self.create_multipart_upload(Key=Key)["UploadId"]
        Path(upload).write_bytes(Body)
        self.complete_multipart_upload(Key=Key, UploadId=upload)

    def delete_object(self, *, Key: str, **_: Any) -> None:
        self._path(Key).unlink(missing_ok=True)

    def create_multipart_upload(self, *, Key: str, **_: Any) -> dict[str, str]:
        path = self._path(Key)
        path.parent.mkdir(parents=True, exist_ok=True)
        part = path.with_name(f".{path.name}.{uuid.uuid4().hex}.part")
        part.touch()
        return {"UploadId": str(part)}

    def upload_part(
        self, *, UploadId: str, PartNumber: int, Body: bytes, **_: Any
    ) -> dict[str, str]:
        with open(UploadId, "ab") as f:
            f.write(Body)
        return {"ETag": str(PartNumber)}

    def complete_multipart_upload(self, *, Key: str, UploadId: str, **_: Any) -> None:
        os.replace(UploadId, self._path(Key))

    def abort_multipart_upload(self, *, UploadId: str, **_: Any) -> None:
        Path(UploadId).unlink(missing_ok=True)

    def get_paginator(self, _operation: str) -> "LocalBucket":
        return self

    def paginate(self, *, Prefix: str, **_: Any) -> Iterator[dict[str, Any]]:
        keys = (p.relative_to(self.root).as_posix() for p in self.root.rglob("*") if p.is_file())
        yield {"Contents": [{"Key": key} for key in sorted(keys) if key.startswith(Prefix)]}

    def sha256(self, key: str) -> str:
        path = self._file(key, "GetObject")
        digest = hashlib.sha256()
        progress = _Progress(f"hashing {key}", path.stat().st_size, "bytes")
        with path.open("rb") as f:
            while chunk := f.read(MIN_PART_SIZE):
                digest.update(chunk)
                progress.update(f.tell())
        return digest.hexdigest()


def map_storage() -> Any:
    """The map bucket's client, or a ``LocalBucket`` when ``MAP_BUCKET`` is a ``file://`` URL."""
    if settings.map_bucket.startswith(LOCAL_SCHEME):
        return LocalBucket(Path(settings.map_bucket.removeprefix(LOCAL_SCHEME)))
    kwargs: dict[str, Any] = {
        # Checksums only where S3 requires them: some S3-compatible stores refuse the
        # default CRC32 trailer on uploaded parts.
        "config": Config(
            retries={"max_attempts": 10, "mode": "standard"},
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        ),
    }
    if settings.map_endpoint_url:
        kwargs["endpoint_url"] = settings.map_endpoint_url
    if region := settings.map_region or settings.aws_region:
        kwargs["region_name"] = region
    if settings.aws_access_key_id and settings.aws_secret_access_key:
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
    return boto3.client("s3", **kwargs)


def http_client() -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": USER_AGENT},
        timeout=httpx.Timeout(60.0, connect=20.0),
        follow_redirects=True,
        limits=httpx.Limits(max_connections=FETCH_WORKERS),
    )


class _Progress:
    def __init__(self, label: str, total: int, unit: str) -> None:
        self.label, self.total, self.unit = label, total, unit
        self.started = self.logged = time.monotonic()

    def update(self, done: int, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self.logged < PROGRESS_SECONDS:
            return
        self.logged = now
        rate = done / max(now - self.started, 1e-6)
        if self.unit == "bytes":
            logger.info(
                "%s: %.1f of %.1f GB (%.0f%%), %.1f MB/s",
                self.label,
                done / 1e9,
                self.total / 1e9,
                100 * done / max(self.total, 1),
                rate / 1e6,
            )
        else:
            logger.info(
                "%s: %d of %d %s (%.0f%%), %.0f/s",
                self.label,
                done,
                self.total,
                self.unit,
                100 * done / max(self.total, 1),
                rate,
            )


class MultipartUpload:
    """A file-like sink that streams into one S3 multipart upload, a part at a time.

    Used as a context manager: an exception inside the block aborts the upload, so no
    partial object and no billed orphan parts stay behind.
    """

    def __init__(
        self,
        s3: Any,
        bucket: str,
        key: str,
        content_type: str,
        part_size: int,
        metadata: dict[str, str] | None = None,
    ) -> None:
        if not 0 < part_size <= MAX_PART_SIZE:
            raise MapUpdateError(f"part size {part_size} is outside the S3 limits")
        self.s3, self.bucket, self.key, self.part_size = s3, bucket, key, part_size
        self.upload_id: str = s3.create_multipart_upload(
            Bucket=bucket,
            Key=key,
            ContentType=content_type,
            CacheControl=IMMUTABLE,
            Metadata=metadata or {},
        )["UploadId"]
        self.parts: list[dict[str, Any]] = []
        self.buffer = bytearray()
        self.size = 0

    def write(self, data: bytes) -> int:
        self.buffer += data
        self.size += len(data)
        while len(self.buffer) >= self.part_size:
            self._upload_part(bytes(self.buffer[: self.part_size]))
            del self.buffer[: self.part_size]
        return len(data)

    def _upload_part(self, body: bytes) -> None:
        number = len(self.parts) + 1
        if number > MAX_PARTS:
            raise MapUpdateError(f"{self.key}: more than {MAX_PARTS} parts")
        response = self.s3.upload_part(
            Bucket=self.bucket, Key=self.key, UploadId=self.upload_id, PartNumber=number, Body=body
        )
        self.parts.append({"PartNumber": number, "ETag": response["ETag"]})

    def complete(self) -> None:
        if self.buffer or not self.parts:
            self._upload_part(bytes(self.buffer))
            self.buffer.clear()
        self.s3.complete_multipart_upload(
            Bucket=self.bucket,
            Key=self.key,
            UploadId=self.upload_id,
            MultipartUpload={"Parts": self.parts},
        )

    def abort(self) -> None:
        try:
            self.s3.abort_multipart_upload(
                Bucket=self.bucket, Key=self.key, UploadId=self.upload_id
            )
        except ClientError:
            logger.exception("could not abort the multipart upload of %s", self.key)

    def __enter__(self) -> "MultipartUpload":
        return self

    def __exit__(self, exc_type: object, *_: object) -> None:
        if exc_type is not None:
            self.abort()


def planet_part_size(size: int) -> int:
    part = max(MIN_PART_SIZE, math.ceil(size / MAX_PARTS))
    if part > MAX_PART_SIZE:
        raise MapUpdateError(f"{size} bytes do not fit in {MAX_PARTS} parts of 5 GiB")
    return part


def _exists(s3: Any, bucket: str, key: str) -> bool:
    try:
        s3.head_object(Bucket=bucket, Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
            return False
        raise
    return True


def _range(s3: Any, bucket: str, key: str, start: int, length: int) -> bytes:
    response = s3.get_object(Bucket=bucket, Key=key, Range=f"bytes={start}-{start + length - 1}")
    return response["Body"].read()


def check_archive(
    s3: Any,
    bucket: str,
    key: str,
    *,
    tile_type: TileType,
    max_zoom: int,
    vector_layers: frozenset[str] = frozenset(),
) -> None:
    """Reads an uploaded archive's header and metadata over range requests, as MapLibre will."""
    raw = _range(s3, bucket, key, 0, 127)
    if len(raw) < 127 or not raw.startswith(b"PMTiles\x03"):
        raise MapUpdateError(f"{key}: not a PMTiles v3 archive")
    header = deserialize_header(raw)
    if header["tile_type"] != tile_type:
        raise MapUpdateError(f"{key}: tile type {header['tile_type']}, expected {tile_type}")
    if (header["min_zoom"], header["max_zoom"]) != (0, max_zoom):
        raise MapUpdateError(
            f"{key}: zooms {header['min_zoom']} to {header['max_zoom']}, expected 0 to {max_zoom}"
        )
    if not vector_layers:
        return
    metadata = _range(s3, bucket, key, header["metadata_offset"], header["metadata_length"])
    if header["internal_compression"] == Compression.GZIP:
        metadata = gzip.decompress(metadata)
    layers = {layer.get("id") for layer in json.loads(metadata).get("vector_layers", [])}
    if missing := vector_layers - layers:
        raise MapUpdateError(f"{key}: no vector layer {', '.join(sorted(missing))}")


def latest_version(index: str, area: str, pinned: str = "") -> str:
    """The newest version of the area whose folder lists the archive, its checksums and the
    `done` marker OpenFreeMap writes last, or ``pinned`` when it is such a version."""
    files: dict[str, set[str]] = {}
    for line in index.splitlines():
        parts = line.strip().split("/")
        if len(parts) == 4 and parts[0] == "areas" and parts[1] == area:
            files.setdefault(parts[2], set()).add(parts[3])
    complete = [
        version
        for version, names in files.items()
        if VERSION_PATTERN.match(version) and names >= COMPLETE_VERSION_FILES
    ]
    if pinned:
        if pinned not in complete:
            raise MapUpdateError(
                f"{area} version {pinned} is not complete in the OpenFreeMap index"
            )
        return pinned
    if not complete:
        raise MapUpdateError(f"no complete {area} version in the OpenFreeMap index")
    return max(complete)


def _expected_sha256(sums: str, name: str) -> str:
    for line in sums.splitlines():
        fields = line.split()
        if len(fields) == 2 and fields[1].lstrip("*") == name:
            return fields[0].lower()
    raise MapUpdateError(f"SHA256SUMS lists no {name}")


def _get(http: httpx.Client, url: str) -> httpx.Response:
    response = http.get(url)
    if response.status_code != 200:
        raise MapUpdateError(f"GET {url}: {response.status_code}")
    return response


def _stream(http: httpx.Client, url: str, size: int, etag: str | None) -> Iterator[bytes]:
    """The body of ``url``, resumed with a range request after a dropped connection."""
    received = 0
    for attempt in range(RESUME_ATTEMPTS + 1):
        if received >= size:
            break
        headers = {}
        if attempt:
            time.sleep(2**attempt)
        if received:
            headers["Range"] = f"bytes={received}-"
            if etag:
                headers["If-Range"] = etag
        try:
            with http.stream("GET", url, headers=headers) as response:
                if response.status_code != (206 if received else 200):
                    raise MapUpdateError(f"GET {url}: {response.status_code}")
                for chunk in response.iter_bytes():
                    received += len(chunk)
                    yield chunk
        except httpx.TransportError as exc:
            logger.warning("%s: interrupted at byte %d (%s); resuming", url, received, exc)
    if received != size:
        raise MapUpdateError(f"{url}: {received} bytes, expected {size}")


def _stored_sha256(s3: Any, bucket: str, key: str) -> str | None:
    """The SHA-256 of an archive already at ``key``: from the metadata the job uploads it with,
    or, in a local folder, from the file itself (a planet downloaded by hand)."""
    if not _exists(s3, bucket, key):
        return None
    if isinstance(s3, LocalBucket):
        return s3.sha256(key)
    sha: str | None = s3.head_object(Bucket=bucket, Key=key).get("Metadata", {}).get("sha256")
    return sha


def _check_planet(s3: Any, config: MapConfig, key: str) -> None:
    check_archive(
        s3,
        config.bucket,
        config.key(key),
        tile_type=TileType.MVT,
        max_zoom=PLANET_MAX_ZOOM,
        vector_layers=REQUIRED_VECTOR_LAYERS,
    )


def _copy_planet(
    http: httpx.Client,
    s3: Any,
    config: MapConfig,
    key: str,
    url: str,
    expected: str,
    size: int,
    etag: str | None,
) -> None:
    logger.info("planet: copying %s, %.1f GB, to %s", url, size / 1e9, config.key(key))
    digest = hashlib.sha256()
    progress = _Progress("planet", size, "bytes")
    with MultipartUpload(
        s3,
        config.bucket,
        config.key(key),
        "application/vnd.pmtiles",
        planet_part_size(size),
        metadata={"sha256": expected},
    ) as upload:
        for chunk in _stream(http, url, size, etag):
            digest.update(chunk)
            upload.write(chunk)
            progress.update(upload.size)
        progress.update(upload.size, force=True)
        if digest.hexdigest() != expected:
            raise MapUpdateError(f"{url}: SHA-256 {digest.hexdigest()} does not match {expected}")
        upload.complete()
    try:
        _check_planet(s3, config, key)
    except Exception:
        s3.delete_object(Bucket=config.bucket, Key=config.key(key))
        raise


def update_planet(
    http: httpx.Client, s3: Any, config: MapConfig, current: dict[str, Any] | None
) -> dict[str, Any]:
    index = _get(http, f"{config.source_url}/files.txt").text
    version = latest_version(index, config.area, config.planet_version)
    key = f"planet/{version}.pmtiles"
    if (
        current
        and current.get("key") == key
        and current.get("area") == config.area
        and _exists(s3, config.bucket, config.key(key))
    ):
        logger.info("planet: %s is current", version)
        return current

    folder = f"{config.source_url}/areas/{config.area}/{version}"
    expected = _expected_sha256(_get(http, f"{folder}/SHA256SUMS").text, "tiles.pmtiles")
    url = f"{folder}/tiles.pmtiles"
    head = http.head(url)
    if head.status_code != 200 or "content-length" not in head.headers:
        raise MapUpdateError(f"HEAD {url}: {head.status_code}, no size")
    size = int(head.headers["content-length"])
    osm_date = http.get(f"{folder}/osm_date")
    if _stored_sha256(s3, config.bucket, config.key(key)) == expected:
        logger.info("planet: %s is already in the bucket", version)
        _check_planet(s3, config, key)
    else:
        _copy_planet(http, s3, config, key, url, expected, size, head.headers.get("etag"))
    return {
        "key": key,
        "version": version,
        "area": config.area,
        "osm_date": osm_date.text.strip() if osm_date.status_code == 200 else None,
        "sha256": expected,
        "bytes": size,
    }


def _is_png(data: bytes) -> bool:
    return data.startswith(b"\x89PNG\r\n\x1a\n")


def update_sprite(http: httpx.Client, s3: Any, config: MapConfig) -> dict[str, Any]:
    sprite_url = _get(http, SPRITE_STYLE_URL).json().get("sprite")
    match = re.fullmatch(re.escape(SPRITE_URL_PREFIX) + r"(ofm_\w+)/ofm", str(sprite_url))
    if not match:
        raise MapUpdateError(f"unexpected sprite URL in {SPRITE_STYLE_URL}: {sprite_url}")
    key = f"sprite/{match.group(1)}/ofm"
    folder = key.rsplit("/", 1)[0]
    if all(_exists(s3, config.bucket, config.key(f"{folder}/{name}")) for name in SPRITE_FILES):
        logger.info("sprite: %s is current", key)
        return {"key": key}

    files = {
        name: _get(http, f"{SPRITE_URL_PREFIX}{match.group(1)}/{name}").content
        for name in SPRITE_FILES
    }
    for name, data in files.items():
        valid = _is_png(data) if name.endswith(".png") else isinstance(json.loads(data), dict)
        if not valid or not data:
            raise MapUpdateError(f"sprite {name}: not a valid file")
    for name, data in files.items():
        s3.put_object(
            Bucket=config.bucket,
            Key=config.key(f"{folder}/{name}"),
            Body=data,
            ContentType=SPRITE_FILES[name],
            CacheControl=IMMUTABLE,
        )
    logger.info("sprite: copied %s", key)
    return {"key": key}


def _fetch_tile(http: httpx.Client, template: str, tile_id: int) -> bytes:
    z, x, y = tileid_to_zxy(tile_id)
    url = template.format(z=z, x=x, y=y)
    for attempt in range(TILE_ATTEMPTS):
        try:
            response = http.get(url)
        except httpx.TransportError as exc:
            error = str(exc)
        else:
            if response.status_code == 200 and _is_png(response.content):
                return response.content
            error = f"status {response.status_code}"
            if response.status_code < 500 and response.status_code != 429:
                break
        time.sleep(2**attempt)
    raise MapUpdateError(f"GET {url}: {error}")


def build_raster_archive(
    http: httpx.Client,
    s3: Any,
    config: MapConfig,
    *,
    key: str,
    template: str,
    max_zoom: int,
    name: str,
    attribution: str,
    fetch: Callable[[httpx.Client, str, int], bytes] = _fetch_tile,
) -> None:
    """Copies every PNG tile of zooms 0 to ``max_zoom`` into one PMTiles archive.

    The writer keeps the tile data in a temporary file until the directory is known, then
    streams the archive into the bucket: the job needs free disk the size of the archive.
    """
    total = (4 ** (max_zoom + 1) - 1) // 3
    progress = _Progress(name, total, "tiles")
    with (
        MultipartUpload(
            s3, config.bucket, config.key(key), "application/vnd.pmtiles", MIN_PART_SIZE
        ) as upload,
        ThreadPoolExecutor(FETCH_WORKERS) as pool,
    ):
        writer = Writer(upload)
        # PMTiles tile ids run zoom by zoom along a Hilbert curve; writing them in order keeps
        # the archive clustered, so a reader's neighbouring tiles sit next to each other.
        for start in range(0, total, FETCH_BATCH):
            ids = range(start, min(start + FETCH_BATCH, total))
            for tile_id, data in zip(
                ids, pool.map(lambda i: fetch(http, template, i), ids), strict=True
            ):
                writer.write_tile(tile_id, data)
            progress.update(ids.stop)
        progress.update(total, force=True)
        writer.finalize(
            {
                "tile_type": TileType.PNG,
                "tile_compression": Compression.NONE,
                "center_zoom": 0,
                "center_lon_e7": 0,
                "center_lat_e7": 0,
                **MERCATOR_BOUNDS,
            },
            {"name": name, "attribution": attribution, "format": "png", "type": "baselayer"},
        )
        upload.complete()


def update_raster(
    http: httpx.Client,
    s3: Any,
    config: MapConfig,
    *,
    field: str,
    key: str,
    template: str,
    max_zoom: int,
    fetch: Callable[[httpx.Client, str, int], bytes] = _fetch_tile,
) -> dict[str, Any]:
    """A raster archive that never changes upstream: built once per max zoom, then checked."""
    if _exists(s3, config.bucket, config.key(key)):
        logger.info("%s: %s is in place", field, key)
    else:
        logger.info("%s: building %s, zooms 0 to %d", field, key, max_zoom)
        build_raster_archive(
            http,
            s3,
            config,
            key=key,
            template=template,
            max_zoom=max_zoom,
            name=field,
            attribution=ATTRIBUTION[field],
            fetch=fetch,
        )
    try:
        check_archive(s3, config.bucket, config.key(key), tile_type=TileType.PNG, max_zoom=max_zoom)
    except MapUpdateError:
        s3.delete_object(Bucket=config.bucket, Key=config.key(key))
        raise
    return {"key": key, "max_zoom": max_zoom}


def read_latest(s3: Any, config: MapConfig) -> dict[str, Any] | None:
    try:
        body = s3.get_object(Bucket=config.bucket, Key=config.key(LATEST_KEY))["Body"].read()
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
            return None
        raise
    latest: dict[str, Any] = json.loads(body)
    return latest


def apply_retention(s3: Any, config: MapConfig, protected: set[str]) -> list[str]:
    """Deletes the planets past the newest ``keep_planets``, never one in ``protected``."""
    prefix = config.key("planet/")
    keys: list[str] = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=config.bucket, Prefix=prefix):
        keys.extend(obj["Key"].removeprefix(config.key("")) for obj in page.get("Contents", []))
    planets = sorted(
        (key for key in keys if re.fullmatch(r"planet/[\w-]+\.pmtiles", key)), reverse=True
    )
    doomed = [key for key in planets[config.keep_planets :] if key not in protected]
    for key in doomed:
        s3.delete_object(Bucket=config.bucket, Key=config.key(key))
        logger.info("retention: deleted %s", key)
    return doomed


def run(
    config: MapConfig,
    *,
    http: httpx.Client,
    s3: Any,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
    fetch: Callable[[httpx.Client, str, int], bytes] = _fetch_tile,
) -> dict[str, Any]:
    """One pass. Raises ``MapUpdateError`` (or a storage error) with ``latest.json`` untouched."""
    current = read_latest(s3, config)
    planet = update_planet(http, s3, config, (current or {}).get("planet"))
    sprite = update_sprite(http, s3, config)
    natural_earth = update_raster(
        http,
        s3,
        config,
        field="natural_earth",
        key=f"natural-earth/ne2sr-z{config.natural_earth_max_zoom}.pmtiles",
        template=NATURAL_EARTH_TILES,
        max_zoom=config.natural_earth_max_zoom,
        fetch=fetch,
    )
    relief = update_raster(
        http,
        s3,
        config,
        field="relief",
        key=f"relief/terrarium-z{config.relief_max_zoom}.pmtiles",
        template=RELIEF_TILES,
        max_zoom=config.relief_max_zoom,
        fetch=fetch,
    )
    files = (planet, sprite, natural_earth, relief)
    latest: dict[str, Any] = {
        **dict(zip(LATEST_FIELDS, files, strict=True)),
        "attribution": ATTRIBUTION,
    }
    if current and {k: v for k, v in current.items() if k != "updated_at"} == latest:
        logger.info("latest.json is current")
        latest = current
    else:
        latest = {**latest, "updated_at": now().isoformat(timespec="seconds")}
        s3.put_object(
            Bucket=config.bucket,
            Key=config.key(LATEST_KEY),
            Body=json.dumps(latest, indent=2).encode(),
            ContentType="application/json",
            CacheControl="no-cache",
        )
        logger.info("latest.json now names planet %s", planet["version"])

    protected = {planet["key"]}
    if current and isinstance(current.get("planet"), dict):
        protected.add(current["planet"].get("key", ""))
    apply_retention(s3, config, protected)
    return latest
