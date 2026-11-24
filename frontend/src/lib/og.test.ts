import { describe, expect, it } from "vitest";

import {
  ogCount,
  ogMosaicBoxes,
  ogProfileCounts,
  ogTruncate,
  projectEquirectangular,
} from "./og";
import type { PublicProfile, UserStats } from "./users";

describe("projectEquirectangular", () => {
  it("puts the null island at the centre of the frame", () => {
    expect(projectEquirectangular(0, 0)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("maps the corners of the world to the corners of the frame", () => {
    expect(projectEquirectangular(90, -180)).toEqual({ x: 0, y: 0 });
    expect(projectEquirectangular(-90, 180)).toEqual({ x: 1, y: 1 });
  });

  it("places a northern-hemisphere point above and right of centre", () => {
    const { x, y } = projectEquirectangular(48.5, 37.8);
    expect(x).toBeGreaterThan(0.5);
    expect(y).toBeLessThan(0.5);
  });

  it("clamps a value outside the world box into the frame", () => {
    expect(projectEquirectangular(500, 900)).toEqual({ x: 1, y: 0 });
  });
});

describe("ogTruncate", () => {
  it("leaves a short string alone", () => {
    expect(ogTruncate("Strike on a bridge", 40)).toBe("Strike on a bridge");
  });

  it("collapses runs of whitespace", () => {
    expect(ogTruncate("  two   words\nhere ", 40)).toBe("two words here");
  });

  it("cuts on a word boundary near the end of the budget", () => {
    // The last space (index 19) is past 75% of the 24-character budget, so the partial word goes.
    expect(ogTruncate("alpha bravo charlie delta", 24)).toBe("alpha bravo charlie…");
  });

  it("drops the trailing partial word rather than cutting through it", () => {
    expect(ogTruncate("alpha bravo charlie delta", 20)).toBe("alpha bravo charlie…");
  });

  it("cuts mid-word when the last space is too early to be useful", () => {
    expect(ogTruncate("a superlongsingletoken", 12)).toBe("a superlong…");
  });

  it("cuts astral characters whole, leaving no lone surrogate", () => {
    expect(ogTruncate("🚀🚀🚀🚀🚀🚀", 4)).toBe("🚀🚀🚀…");
  });

  it("measures the budget in code points, not UTF-16 units", () => {
    // Two astral characters are four UTF-16 units: a length budget would cut them.
    expect(ogTruncate("🚀🚀", 3)).toBe("🚀🚀");
  });
});

describe("ogCount", () => {
  it("separates thousands", () => {
    expect(ogCount(1234567)).toBe("1,234,567");
  });
});

describe("ogProfileCounts", () => {
  const profile = { geolocations_count: 12, followers_count: 7 } as PublicProfile;
  // The stats read credits co-geolocated events, so its figure leads the profile's own.
  const stats = { geolocated_count: 15, detected_count: 2400 } as UserStats;

  it("counts geolocated and detected off the profile stats, then followers", () => {
    expect(ogProfileCounts(profile, stats)).toEqual([
      { label: "Geolocated", value: 15 },
      { label: "Detected", value: 2400 },
      { label: "Followers", value: 7 },
    ]);
  });

  it("keeps geolocated off the profile and drops detected when the stats read failed", () => {
    expect(ogProfileCounts(profile, null)).toEqual([
      { label: "Geolocated", value: 12 },
      { label: "Followers", value: 7 },
    ]);
  });

  it("names one follower in the singular", () => {
    const one = { ...profile, followers_count: 1 };
    expect(ogProfileCounts(one, null)).toContainEqual({ label: "Follower", value: 1 });
  });
});

describe("ogMosaicBoxes", () => {
  // The panel the collection card draws: 16:9, with `<ItemMedia>`'s gap.
  const frame = { width: 480, height: 270, gap: 2 };

  it("gives a lone tile the whole panel", () => {
    expect(ogMosaicBoxes(1, frame)).toEqual([{ left: 0, top: 0, width: 480, height: 270 }]);
  });

  it("splits two tiles down the middle, full height", () => {
    expect(ogMosaicBoxes(2, frame)).toEqual([
      { left: 0, top: 0, width: 239, height: 270 },
      { left: 241, top: 0, width: 239, height: 270 },
    ]);
  });

  it("puts the earliest of three tall on the left, the next two stacked beside it", () => {
    const [first, second, third] = ogMosaicBoxes(3, frame);
    expect(first).toEqual({ left: 0, top: 0, width: 239, height: 270 });
    expect(second).toEqual({ left: 241, top: 0, width: 239, height: 134 });
    expect(third).toEqual({ left: 241, top: 136, width: 239, height: 134 });
  });

  it("fills a 2x2 with four, in reading order", () => {
    expect(ogMosaicBoxes(4, frame).map((box) => [box.left, box.top])).toEqual([
      [0, 0],
      [241, 0],
      [0, 136],
      [241, 136],
    ]);
  });

  it("draws nothing for a collection with no mosaic", () => {
    expect(ogMosaicBoxes(0, frame)).toEqual([]);
  });

  it("keeps a cover longer than the arrangement inside the panel", () => {
    // The backend caps the cover at four tiles; the count is clamped, not trusted.
    expect(ogMosaicBoxes(9, frame)).toEqual(ogMosaicBoxes(4, frame));
  });

  it("leaves exactly the gap between neighbouring tiles", () => {
    const [topLeft, topRight, bottomLeft] = ogMosaicBoxes(4, frame);
    expect(topRight.left - (topLeft.left + topLeft.width)).toBe(frame.gap);
    expect(bottomLeft.top - (topLeft.top + topLeft.height)).toBe(frame.gap);
  });
});
