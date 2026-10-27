"""The ``update-map`` pass over canned OpenFreeMap responses (``MockTransport``) and a moto
bucket: no network."""

import gzip
import hashlib
import io
import json
from datetime import UTC, datetime

import boto3
import httpx
import pytest
from moto import mock_aws
from pmtiles.tile import Compression, TileType, deserialize_header, zxy_to_tileid
from pmtiles.writer import Writer

from app.services import map_files
from app.services.map_files import (
    MapConfig,
    MapUpdateError,
    apply_retention,
    latest_version,
    planet_part_size,
    run,
)

BUCKET = "map-test-bucket"
SOURCE = "https://openfreemap.test"
SPRITE_URL = f"{map_files.SPRITE_URL_PREFIX}ofm_abc1/ofm"
PNG = b"\x89PNG\r\n\x1a\n"
NOW = datetime(2026, 10, 27, 6, 0, tzinfo=UTC)


def _config(**overrides) -> MapConfig:
    values = {
        "bucket": BUCKET,
        "prefix": "map",
        "keep_planets": 2,
        "relief_max_zoom": 1,
        "source_url": SOURCE,
        "area": "planet",
        "natural_earth_max_zoom": 1,
    }
    return MapConfig(**{**values, **overrides})


def _planet(max_zoom: int = 14, layers: tuple[str, ...] = tuple(map_files.REQUIRED_VECTOR_LAYERS)):
    out = io.BytesIO()
    writer = Writer(out)
    tile = gzip.compress(b"mvt", mtime=0)
    writer.write_tile(zxy_to_tileid(0, 0, 0), tile)
    writer.write_tile(zxy_to_tileid(max_zoom, 0, 0), tile + b"\x00")
    writer.finalize(
        {"tile_type": TileType.MVT, "tile_compression": Compression.GZIP},
        {"vector_layers": [{"id": layer} for layer in layers]},
    )
    return out.getvalue()


def _index(*versions: str, area: str = "planet") -> str:
    files = ("SHA256SUMS", "done", "osm_date", "tiles.btrfs", "tiles.pmtiles")
    return "\n".join(f"areas/{area}/{v}/{name}" for v in versions for name in files)


class FakeOpenFreeMap:
    """Serves one planet per version and records every request."""

    def __init__(self, planets: dict[str, bytes], sums: dict[str, str] | None = None) -> None:
        self.planets = planets
        self.sums = sums or {v: hashlib.sha256(data).hexdigest() for v, data in planets.items()}
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = str(request.url)
        if url == f"{SOURCE}/files.txt":
            return httpx.Response(200, text=_index(*self.planets))
        if url == map_files.SPRITE_STYLE_URL:
            return httpx.Response(200, json={"sprite": SPRITE_URL})
        if url.startswith(map_files.SPRITE_URL_PREFIX):
            name = url.rsplit("/", 1)[1]
            return httpx.Response(200, content=PNG if name.endswith(".png") else b'{"a": {}}')
        for version, data in self.planets.items():
            folder = f"{SOURCE}/areas/planet/{version}"
            if url == f"{folder}/SHA256SUMS":
                return httpx.Response(200, text=f"{self.sums[version]}  tiles.pmtiles\n")
            if url == f"{folder}/osm_date":
                return httpx.Response(200, text="2026-10-19\n")
            if url == f"{folder}/tiles.pmtiles":
                headers = {"content-length": str(len(data)), "etag": f'"{version}"'}
                body = b"" if request.method == "HEAD" else data
                return httpx.Response(200, headers=headers, content=body)
        return httpx.Response(404)

    def client(self) -> httpx.Client:
        return httpx.Client(
            transport=httpx.MockTransport(self.handler),
            headers={"User-Agent": map_files.USER_AGENT},
        )

    def planet_downloads(self) -> int:
        return sum(
            1 for r in self.requests if r.method == "GET" and r.url.path.endswith("tiles.pmtiles")
        )


def _fake_tile(_http: httpx.Client, _template: str, tile_id: int) -> bytes:
    return PNG + tile_id.to_bytes(4, "big")


@pytest.fixture
def s3():
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket=BUCKET)
        yield client


def _latest(s3) -> dict:
    return json.loads(s3.get_object(Bucket=BUCKET, Key="map/latest.json")["Body"].read())


def _keys(s3) -> set[str]:
    return {obj["Key"] for obj in s3.list_objects_v2(Bucket=BUCKET).get("Contents", [])}


def _run(s3, fake: FakeOpenFreeMap, **overrides) -> dict:
    with fake.client() as http:
        return run(_config(**overrides), http=http, s3=s3, now=lambda: NOW, fetch=_fake_tile)


def test_latest_version_picks_the_newest_complete_folder():
    index = "\n".join(
        [
            _index("20261011_080001_pt", "20261018_080001_pt"),
            # Newer, but still uploading: no `done` marker yet.
            "areas/planet/20261025_080012_pt/SHA256SUMS",
            "areas/planet/20261025_080012_pt/tiles.pmtiles",
            _index("20261027_033001_pt", area="monaco"),
            _index("latest"),
        ]
    )
    assert latest_version(index, "planet") == "20261018_080001_pt"
    assert latest_version(index, "monaco") == "20261027_033001_pt"
    with pytest.raises(MapUpdateError, match="no complete"):
        latest_version(index, "andorra")


def test_planet_part_size_stays_within_the_s3_part_limits():
    assert planet_part_size(87_230_232_932) == map_files.MIN_PART_SIZE
    assert planet_part_size(10**12) * map_files.MAX_PARTS >= 10**12
    with pytest.raises(MapUpdateError):
        planet_part_size(map_files.MAX_PART_SIZE * map_files.MAX_PARTS + 1)


def test_a_run_copies_every_file_and_names_them_in_latest_json(s3):
    planet = _planet()
    fake = FakeOpenFreeMap({"20261025_080012_pt": planet})

    latest = _run(s3, fake)

    assert _latest(s3) == latest
    assert latest == {
        "planet": {
            "key": "planet/20261025_080012_pt.pmtiles",
            "version": "20261025_080012_pt",
            "area": "planet",
            "osm_date": "2026-10-19",
            "sha256": hashlib.sha256(planet).hexdigest(),
            "bytes": len(planet),
        },
        "sprite": {"key": "sprite/ofm_abc1/ofm"},
        "natural_earth": {"key": "natural-earth/ne2sr-z1.pmtiles", "max_zoom": 1},
        "relief": {"key": "relief/terrarium-z1.pmtiles", "max_zoom": 1},
        "attribution": map_files.ATTRIBUTION,
        "updated_at": "2026-10-27T06:00:00+00:00",
    }
    body = s3.get_object(Bucket=BUCKET, Key="map/planet/20261025_080012_pt.pmtiles")["Body"].read()
    assert body == planet
    assert {f"map/sprite/ofm_abc1/{name}" for name in map_files.SPRITE_FILES} <= _keys(s3)
    relief = s3.get_object(Bucket=BUCKET, Key="map/relief/terrarium-z1.pmtiles")["Body"].read()
    header = deserialize_header(relief[:127])
    assert (header["tile_type"], header["min_zoom"], header["max_zoom"]) == (TileType.PNG, 0, 1)
    assert header["addressed_tiles_count"] == 5
    assert all(r.headers["User-Agent"] == map_files.USER_AGENT for r in fake.requests)


def test_a_second_run_with_nothing_new_writes_nothing(s3):
    fake = FakeOpenFreeMap({"20261025_080012_pt": _planet()})
    first = _run(s3, fake)

    second = _run(s3, fake)

    assert second == first
    assert fake.planet_downloads() == 1


def test_a_checksum_mismatch_aborts_the_upload_and_keeps_latest_json(s3):
    old, new = "20261018_080001_pt", "20261025_080012_pt"
    _run(s3, FakeOpenFreeMap({old: _planet()}))
    before = _latest(s3)
    fake = FakeOpenFreeMap({old: _planet(), new: _planet()}, sums={old: "", new: "0" * 64})

    with pytest.raises(MapUpdateError, match="does not match"):
        _run(s3, fake)

    assert _latest(s3) == before
    assert f"map/planet/{new}.pmtiles" not in _keys(s3)
    assert not s3.list_multipart_uploads(Bucket=BUCKET).get("Uploads")


def test_a_planet_without_the_expected_layers_is_deleted(s3):
    fake = FakeOpenFreeMap({"20261025_080012_pt": _planet(layers=("water",))})

    with pytest.raises(MapUpdateError, match="no vector layer"):
        _run(s3, fake)

    assert _keys(s3).isdisjoint({"map/latest.json", "map/planet/20261025_080012_pt.pmtiles"})


def test_a_new_planet_keeps_the_previous_one(s3):
    versions = ["20261011_080001_pt", "20261018_080001_pt", "20261025_080012_pt"]
    for i in range(1, len(versions) + 1):
        _run(s3, FakeOpenFreeMap({v: _planet() for v in versions[:i]}))

    planets = {key for key in _keys(s3) if key.startswith("map/planet/")}
    assert planets == {f"map/planet/{v}.pmtiles" for v in versions[1:]}
    assert _latest(s3)["planet"]["version"] == versions[2]


def test_retention_never_deletes_a_protected_planet(s3):
    names = [f"planet/2026100{i}_080001_pt.pmtiles" for i in range(1, 6)]
    for name in names:
        s3.put_object(Bucket=BUCKET, Key=f"map/{name}", Body=b"x")
    s3.put_object(Bucket=BUCKET, Key="map/planet/notes.txt", Body=b"x")

    deleted = apply_retention(s3, _config(), protected={names[0], names[2]})

    assert sorted(deleted) == [names[1]]
    assert f"map/{names[0]}" in _keys(s3)
    assert "map/planet/notes.txt" in _keys(s3)


def test_a_dropped_download_resumes_where_it_stopped(s3, monkeypatch):
    monkeypatch.setattr(map_files.time, "sleep", lambda _s: None)
    version = "20261025_080012_pt"
    planet = _planet()
    fake = FakeOpenFreeMap({version: planet})
    ranges: list[str | None] = []

    def flaky(request: httpx.Request) -> httpx.Response:
        if not request.url.path.endswith("tiles.pmtiles") or request.method == "HEAD":
            return fake.handler(request)
        ranges.append(request.headers.get("Range"))
        if request.headers.get("Range"):
            start = int(request.headers["Range"].removeprefix("bytes=").rstrip("-"))
            return httpx.Response(206, content=planet[start:])

        def broken():
            yield planet[:100]
            raise httpx.ReadError("connection reset")

        return httpx.Response(200, content=broken())

    with httpx.Client(transport=httpx.MockTransport(flaky)) as http:
        latest = run(_config(), http=http, s3=s3, now=lambda: NOW, fetch=_fake_tile)

    assert ranges == [None, "bytes=100-"]
    assert latest["planet"]["sha256"] == hashlib.sha256(planet).hexdigest()


def test_a_download_that_keeps_failing_gives_up_and_aborts_the_upload(s3, monkeypatch):
    monkeypatch.setattr(map_files.time, "sleep", lambda _s: None)
    fake = FakeOpenFreeMap({"20261025_080012_pt": _planet()})

    def failing(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("tiles.pmtiles") and request.method == "GET":
            raise httpx.ConnectError("unreachable")
        return fake.handler(request)

    with (
        httpx.Client(transport=httpx.MockTransport(failing)) as http,
        pytest.raises(MapUpdateError, match="expected"),
    ):
        run(_config(), http=http, s3=s3, now=lambda: NOW, fetch=_fake_tile)

    assert "map/latest.json" not in _keys(s3)
    assert not s3.list_multipart_uploads(Bucket=BUCKET).get("Uploads")


def _run_local(root, fake: FakeOpenFreeMap, **overrides) -> dict:
    with fake.client() as http:
        return run(
            _config(prefix="", **overrides),
            http=http,
            s3=map_files.LocalBucket(root),
            now=lambda: NOW,
            fetch=_fake_tile,
        )


def test_a_local_folder_gets_the_bucket_layout(tmp_path):
    planet = _planet()
    _run_local(tmp_path, FakeOpenFreeMap({"20261025_080012_pt": planet}))

    files = {p.relative_to(tmp_path).as_posix() for p in tmp_path.rglob("*") if p.is_file()}
    assert files == {
        "latest.json",
        "planet/20261025_080012_pt.pmtiles",
        "natural-earth/ne2sr-z1.pmtiles",
        "relief/terrarium-z1.pmtiles",
        *(f"sprite/ofm_abc1/{name}" for name in map_files.SPRITE_FILES),
    }
    assert (tmp_path / "planet/20261025_080012_pt.pmtiles").read_bytes() == planet
    latest = json.loads((tmp_path / "latest.json").read_text())
    assert latest["planet"]["key"] == "planet/20261025_080012_pt.pmtiles"


def test_a_pinned_planet_placed_by_hand_is_checked_not_downloaded(tmp_path):
    pinned, newer = "20261018_080001_pt", "20261025_080012_pt"
    planet = _planet()
    (tmp_path / "planet").mkdir()
    (tmp_path / f"planet/{pinned}.pmtiles").write_bytes(planet)
    fake = FakeOpenFreeMap({pinned: planet, newer: _planet(max_zoom=13)})

    latest = _run_local(tmp_path, fake, planet_version=pinned)

    assert latest["planet"]["version"] == pinned
    assert fake.planet_downloads() == 0
    assert not (tmp_path / f"planet/{newer}.pmtiles").exists()


def test_a_pin_on_an_unpublished_version_fails():
    with pytest.raises(MapUpdateError, match="not complete"):
        latest_version(_index("20261018_080001_pt"), "planet", "20261025_080012_pt")
