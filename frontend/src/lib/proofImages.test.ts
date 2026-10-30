import { describe, expect, it } from "vitest";

import { MAX_GIF_FRAMES } from "@/lib/mediaTypes";
import { tinyGif } from "@/test/gif";
import {
  gifFrameCount,
  gifFrameFilename,
  gifRefusal,
  gifSplitFrames,
  PROOF_PLACEHOLDER_PREFIX,
  safeProofFilename,
  splitGif,
} from "./proofImages";

describe("PROOF_PLACEHOLDER_PREFIX", () => {
  it("mirrors the backend placeholder scheme", () => {
    expect(PROOF_PLACEHOLDER_PREFIX).toBe("placeholder://");
  });
});

describe("safeProofFilename", () => {
  const none = new Set<string>();

  it("keeps a clean filename as-is", () => {
    expect(safeProofFilename("IMG_1234.jpg", none)).toBe("IMG_1234.jpg");
  });

  it("strips path components (both slash kinds), like the backend", () => {
    expect(safeProofFilename("../../etc/passwd.jpg", none)).toBe("passwd.jpg");
    expect(safeProofFilename("a\\b\\c.png", none)).toBe("c.png");
  });

  it("rejects control (Cc) and format (Cf) codepoints, and the empty case", () => {
    // BEL (U+0007) is category Cc; built via fromCharCode so no control byte lands in this file.
    expect(safeProofFilename(`bad${String.fromCharCode(7)}name.jpg`, none)).toBeNull();
    // RTL-override (U+202E) is category Cf, the filename-spoofing codepoint.
    const rtlOverride = String.fromCharCode(0x202e);
    expect(safeProofFilename(`photo${rtlOverride}gpj.exe`, none)).toBeNull();
    expect(safeProofFilename("   ", none)).toBeNull();
    expect(safeProofFilename("", none)).toBeNull();
  });

  it("disambiguates a collision so two files don't share a placeholder", () => {
    const used = new Set(["IMG.jpg"]);
    const next = safeProofFilename("IMG.jpg", used);
    expect(next).toBe("IMG-2.jpg");
    expect(next).not.toBe("IMG.jpg");
  });

  it("keeps disambiguating past a second collision", () => {
    const used = new Set(["p.png", "p-2.png"]);
    expect(safeProofFilename("p.png", used)).toBe("p-3.png");
  });
});

describe("gifFrameCount", () => {
  it.each([1, 4, 7])("counts the %i frames of a GIF", (frames) => {
    expect(gifFrameCount(tinyGif(frames))).toBe(frames);
  });

  it("reads no GIF out of other bytes or a GIF with no frame", () => {
    expect(gifFrameCount(new TextEncoder().encode("not a gif"))).toBeNull();
    expect(gifFrameCount(tinyGif(0))).toBeNull();
  });

  it("counts the frames before a truncation inside the last one", () => {
    const whole = tinyGif(3);
    expect(gifFrameCount(whole.subarray(0, whole.length - 25))).toBe(2);
  });
});

describe("gifRefusal", () => {
  it("takes a GIF up to the frame cap and words the refusal past it", () => {
    expect(gifRefusal(6, MAX_GIF_FRAMES)).toBeNull();
    expect(gifRefusal(7, MAX_GIF_FRAMES)).toBe(
      "This GIF holds 7 frames, and a GIF may hold at most 6. Insert a GIF of 6 frames or fewer.",
    );
    expect(gifRefusal(null, MAX_GIF_FRAMES)).toBe("Could not read this GIF. Insert a valid GIF file.");
  });
});

describe("gifSplitFrames", () => {
  const file = (bytes: BlobPart, type = "image/gif") => new File([bytes], "scan.gif", { type });

  it.each([2, MAX_GIF_FRAMES])("names the %i frames a GIF splits into", async (frames) => {
    expect(await gifSplitFrames(file(tinyGif(frames)))).toBe(frames);
  });

  it.each([
    ["a GIF of one frame", file(tinyGif(1))],
    ["a GIF past the frame cap", file(tinyGif(MAX_GIF_FRAMES + 1))],
    ["an unreadable GIF", file("not a gif")],
    ["a file that is not a GIF", file(tinyGif(3), "image/png")],
  ])("names no split for %s", async (_name, picked) => {
    expect(await gifSplitFrames(picked)).toBeNull();
  });
});

describe("gifFrameFilename", () => {
  it("numbers the frames of a GIF and names a lone frame after the GIF", () => {
    expect(gifFrameFilename("scan.gif", 0, 3)).toBe("scan-1.png");
    expect(gifFrameFilename("scan.gif", 2, 3)).toBe("scan-3.png");
    expect(gifFrameFilename("scan.gif", 0, 1)).toBe("scan.png");
  });
});

describe("splitGif", () => {
  it("leaves the GIF whole where the browser cannot decode it frame by frame", async () => {
    const gif = new File([tinyGif(2)], "scan.gif", { type: "image/gif" });
    expect(await splitGif(gif, 2)).toBeNull();
  });
});
