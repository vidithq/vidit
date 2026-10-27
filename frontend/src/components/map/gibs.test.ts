import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { PbfWriter } from "pbf";
import { describe, expect, it } from "vitest";

import { dailyImagerySource, decodeFireDetections, fireDetectionUrls, gibsDate } from "./gibs";

type Value = string | number;

// A one-layer Mapbox Vector Tile of points, in the shape GIBS serves its fire detections.
function fireTile(layerName: string, points: Record<string, Value>[]): ArrayBuffer {
  const keys = [...new Set(points.flatMap(Object.keys))];
  const values: Value[] = [];
  const valueIndex = (value: Value) => {
    const at = values.indexOf(value);
    return at === -1 ? values.push(value) - 1 : at;
  };
  const features = points.map((properties) =>
    Object.entries(properties).flatMap(([key, value]) => [keys.indexOf(key), valueIndex(value)]),
  );
  const pbf = new PbfWriter();
  pbf.writeMessage(
    3,
    (_: null, layer: PbfWriter) => {
      layer.writeVarintField(15, 2);
      layer.writeStringField(1, layerName);
      for (const tags of features) {
        layer.writeMessage(
          2,
          (_tags: number[], feature: PbfWriter) => {
            feature.writePackedVarint(2, tags);
            feature.writeVarintField(3, 1);
            feature.writePackedVarint(4, [9, 0, 0]);
          },
          tags,
        );
      }
      for (const key of keys) layer.writeStringField(3, key);
      for (const value of values) {
        layer.writeMessage(
          4,
          (v: Value, message: PbfWriter) => {
            if (typeof v === "string") message.writeStringField(1, v);
            else message.writeDoubleField(3, v);
          },
          value,
        );
      }
      layer.writeVarintField(5, 4096);
    },
    null,
  );
  const bytes = pbf.finish();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("gibsDate", () => {
  it("names the UTC day before now", () => {
    expect(gibsDate(new Date("2026-10-26T12:00:00Z"))).toBe("2026-10-25");
    expect(gibsDate(new Date("2026-10-26T00:30:00Z"))).toBe("2026-10-25");
    expect(gibsDate(new Date("2026-10-26T23:59:00Z"))).toBe("2026-10-25");
  });

  it("crosses month and year ends", () => {
    expect(gibsDate(new Date("2026-03-01T08:00:00Z"))).toBe("2026-02-28");
    expect(gibsDate(new Date("2028-03-01T08:00:00Z"))).toBe("2028-02-29");
    expect(gibsDate(new Date("2027-01-01T08:00:00Z"))).toBe("2026-12-31");
  });

  it("reads the UTC day, not the local one", () => {
    // 23:30 on the 26th west of Greenwich is already the 27th in UTC.
    expect(gibsDate(new Date("2026-10-26T23:30:00-05:00"))).toBe("2026-10-26");
  });
});

describe("daily imagery source", () => {
  it("asks GIBS for the VIIRS true colour of the given day, to zoom 9, with its credit", () => {
    const source = dailyImagerySource("2026-10-25");
    expect(source.tiles?.[0]).toContain("VIIRS_SNPP_CorrectedReflectance_TrueColor/default/2026-10-25/");
    expect(source.maxzoom).toBe(9);
    expect(source.attribution).toContain("NASA GIBS / EOSDIS");
    expect(
      validateStyleMin({ version: 8, sources: { imagery: source }, layers: [{ id: "i", type: "raster", source: "imagery" }] }),
    ).toEqual([]);
  });
});

describe("fire detections", () => {
  it("reads both level 0 tiles of the day", () => {
    const urls = fireDetectionUrls("2026-10-25");
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url).toContain("VIIRS_SNPP_Thermal_Anomalies_375m_All/default/2026-10-25/500m/0/0/");
    }
  });

  it("places each detection at its own coordinates and keeps its power and confidence", () => {
    const east = fireTile("VIIRS_SNPP_Thermal_Anomalies_375m_All_v2_NRT", [
      { LATITUDE: -6.19148, LONGITUDE: 106.57301, FRP: 0.51, CONFIDENCE: "nominal", ACQ_TIME: "18:36" },
      { LATITUDE: 48.5, LONGITUDE: 35.2, FRP: 12.4, CONFIDENCE: "high" },
    ]);
    const west = fireTile("VIIRS_SNPP_Thermal_Anomalies_375m_All_v2_NRT", [
      { LATITUDE: -12.25, LONGITUDE: 135.5, FRP: 3, CONFIDENCE: "low" },
      { FRP: 1, CONFIDENCE: "low" },
    ]);
    const detections = decodeFireDetections([east, west]);
    expect(detections.features.map((feature) => feature.geometry.coordinates)).toEqual([
      [106.57301, -6.19148],
      [35.2, 48.5],
      [135.5, -12.25],
    ]);
    expect(detections.features[1].properties).toEqual({ frp: 12.4, confidence: "high" });
  });
});
