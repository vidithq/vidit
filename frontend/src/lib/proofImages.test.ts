import { describe, expect, it } from "vitest";

import { PROOF_PLACEHOLDER_PREFIX, safeProofFilename } from "./proofImages";

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
    // BEL (U+0007) is a control char (category Cc); built via fromCharCode so
    // no literal control byte lands in this source file.
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

  it("preserves the extension when disambiguating a dotless-stem name", () => {
    const used = new Set(["shot.jpeg"]);
    expect(safeProofFilename("shot.jpeg", used)).toBe("shot-2.jpeg");
  });
});
