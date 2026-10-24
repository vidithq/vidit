"""The imagery provider check: each provider's permalink shape, short links, unlisted and
unreopenable providers, the capture date, and the kinds the check covers."""

from __future__ import annotations

import importlib.util
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.models.source import SOURCE_KINDS
from app.services.imagery import IMAGERY_KINDS, PROVIDERS, LinkCheck, provider_of, source_warnings

CAPTURED = datetime(2024, 7, 12, tzinfo=UTC)


def _codes(url: str, *, kind: str = "satellite", archived: bool = False) -> list[str]:
    return [w.code for w in source_warnings(kind, CAPTURED, [LinkCheck(url, archived)])]


# One permalink a reader reopens per accepted provider (the research's examples), and the same
# provider's link in a shape that does not reopen the image.
_PERMALINKS = [
    (
        "google_earth",
        "https://earth.google.com/web/@47.0951,37.5413,50a,2000d,35y,0h,0t,0r/data="
        "ChYqEAgBEgoyMDI0LTA3LTEyGAFCAggBQgIIAEoNCP___________wEQAA",
        "https://earth.google.com/web/@47.0951,37.5413,50a,2000d,35y,0h,0t,0r",
    ),
    (
        "copernicus_browser",
        "https://browser.dataspace.copernicus.eu/?zoom=14&lat=47.0951&lng=37.5413"
        "&themeId=DEFAULT-THEME&datasetId=S2_L2A_CDAS&fromTime=2022-04-20T00%3A00%3A00.000Z"
        "&toTime=2022-04-20T23%3A59%3A59.999Z&layerId=1_TRUE_COLOR&dateMode=SINGLE",
        "https://browser.dataspace.copernicus.eu/?zoom=14&lat=47.0951&lng=37.5413",
    ),
    (
        "esri_wayback",
        "https://livingatlas.arcgis.com/wayback/#mapCenter=37.54130%2C47.09510%2C16"
        "&mode=explore&active=63116",
        "https://livingatlas.arcgis.com/wayback/#mode=explore",
    ),
    (
        "usgs_earthexplorer",
        "https://earthexplorer.usgs.gov/scene/metadata/full/5e839ff7d71d4811/DZB00403600089H016001/",
        "https://earthexplorer.usgs.gov/",
    ),
    (
        "nasa_worldview",
        "https://worldview.earthdata.nasa.gov/?v=36.9,46.8,38.2,47.4"
        "&l=Coastlines_15m,MODIS_Terra_CorrectedReflectance_TrueColor&t=2022-04-20-T00%3A00%3A00Z",
        "https://worldview.earthdata.nasa.gov/?v=36.9,46.8,38.2,47.4&l=Coastlines_15m",
    ),
]


@pytest.mark.parametrize(
    ("provider", "valid", "wrong"), _PERMALINKS, ids=[p[0] for p in _PERMALINKS]
)
def test_an_accepted_permalink_is_clean_and_a_wrong_shape_warns(provider, valid, wrong):
    assert provider_of(valid).id == provider
    assert _codes(valid) == []
    assert provider_of(wrong).id == provider
    assert _codes(wrong) == ["permalink_shape"]


def test_every_accepted_provider_checks_its_permalink():
    assert {p.id for p in PROVIDERS if p.shape is not None} == {p[0] for p in _PERMALINKS}
    assert all(p.group == "accepted" for p in PROVIDERS if p.shape is not None)


def test_google_earth_without_a_date_in_its_data_warns():
    # Valid base64 of a protobuf with no ``YYYY-MM-DD`` in it.
    url = "https://earth.google.com/web/@47.09,37.54,50a,2000d,35y,0h,0t,0r/data=CgRIAQ"
    [warning] = source_warnings("satellite", CAPTURED, [LinkCheck(url)])
    assert warning.code == "permalink_shape"
    assert "no imagery date" in warning.message


def test_copernicus_refuses_a_dataset_it_does_not_reopen():
    url = (
        "https://browser.dataspace.copernicus.eu/?zoom=14&lat=47&lng=37&datasetId=S1_AWS_IW_VVVH"
        "&layerId=X&fromTime=2022-04-20T00:00:00Z&toTime=2022-04-20T23:59:59Z"
    )
    [warning] = source_warnings("satellite", CAPTURED, [LinkCheck(url)])
    assert warning.code == "permalink_shape"
    assert "S1_AWS_IW_VVVH" in warning.message


@pytest.mark.parametrize(
    "url",
    [
        "https://sentinelshare.page.link/osH4",
        "https://goo.gl/abc",
        "https://bit.ly/abc",
        "https://arcg.is/0abc",
    ],
)
def test_a_short_link_warns(url):
    assert _codes(url) == ["short_link"]


@pytest.mark.parametrize(
    ("url", "provider"),
    [
        ("https://www.google.com/maps/@47.09,37.54,500m/data=!3m1!1e3", "google_maps"),
        ("https://www.bing.com/maps?cp=47.09~37.54", "bing_maps"),
        ("https://www.planet.com/explorer/", "planet"),
        ("https://eos.com/landviewer/?lat=47&lng=37&z=11", "eosda_landviewer"),
        ("https://earthengine.google.com/timelapse/", "earth_engine_timelapse"),
        ("https://firms.modaps.eosdis.nasa.gov/map/", "nasa_firms"),
        ("https://apps.sentinel-hub.com/eo-browser/?zoom=10", "eo_browser"),
    ],
)
def test_a_provider_no_reader_can_reopen_warns_with_its_reason(url, provider):
    assert provider_of(url).id == provider
    [warning] = source_warnings("satellite", CAPTURED, [LinkCheck(url)])
    assert (warning.code, warning.url) == ("provider_not_reopenable", url)
    assert warning.message == provider_of(url).help


def test_an_unlisted_host_warns_once_for_the_source():
    links = [LinkCheck("https://imagery.example/a"), LinkCheck("https://imagery.example/b")]
    [warning] = source_warnings("satellite", CAPTURED, links)
    assert (warning.code, warning.url) == ("provider_unknown", None)
    assert "Google Earth web" in warning.message


def test_an_archived_publication_reopens_the_image():
    assert _codes("https://news.example/strike-imagery", archived=True) == []


def test_a_listed_link_beside_an_unlisted_one_is_enough():
    links = [
        LinkCheck("https://news.example/strike-imagery"),
        LinkCheck("https://earthexplorer.usgs.gov/scene/metadata/full/a/b/"),
    ]
    assert source_warnings("satellite", CAPTURED, links) == []


@pytest.mark.parametrize(
    "url",
    [
        "https://umbra.space/open-data/",
        "https://registry.opendata.aws/vantor-open-data/",
        "https://imagehunter.apollomapping.com/",
    ],
)
def test_an_other_provider_needs_no_shape(url):
    assert provider_of(url).group == "other"
    assert _codes(url) == []


def test_an_aircraft_source_reads_the_aerial_archives():
    assert provider_of("https://remonterletemps.ign.fr/comparer").group == "aircraft_archive"
    assert _codes("https://remonterletemps.ign.fr/comparer", kind="aircraft") == []
    [warning] = source_warnings("aircraft", CAPTURED, [LinkCheck("https://aerial.example/1")])
    assert "IGN Remonter le temps" in warning.message
    assert "Google Earth web" not in warning.message


def test_a_missing_capture_date_warns():
    url = _PERMALINKS[0][1]
    assert [w.code for w in source_warnings("satellite", None, [LinkCheck(url)])] == [
        "capture_date_missing"
    ]


@pytest.mark.parametrize("kind", ["drone", "article", "unknown"])
def test_other_kinds_carry_no_warning(kind):
    assert source_warnings(kind, None, [LinkCheck("https://bit.ly/abc")]) == []


def test_the_imagery_kinds_are_source_kinds():
    assert set(IMAGERY_KINDS) <= set(SOURCE_KINDS)
    assert all(set(p.kinds) <= set(IMAGERY_KINDS) for p in PROVIDERS)


def test_every_reopenable_provider_names_its_credit():
    for provider in PROVIDERS:
        assert bool(provider.credit) == (provider.group != "not_reopenable"), provider.id
        assert provider.help, provider.id


def test_the_sources_migration_freezes_the_kind_list():
    path = next(
        (Path(__file__).resolve().parents[1] / "alembic" / "versions").glob("fb4098ed6742_*.py")
    )
    spec = importlib.util.spec_from_file_location("event_sources_migration", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.SOURCE_KINDS == SOURCE_KINDS
    assert "aircraft" in SOURCE_KINDS
