import { describe, expect, it } from "vitest";
import { splitHighlights } from "./search";

const STX = "";
const ETX = "";

describe("splitHighlights", () => {
  it("returns one unhighlighted segment for sentinel-free text", () => {
    expect(splitHighlights("plain text")).toEqual([
      { text: "plain text", highlighted: false },
    ]);
  });

  it("marks the segment between STX and ETX as highlighted", () => {
    expect(splitHighlights(`foo ${STX}bar${ETX} baz`)).toEqual([
      { text: "foo ", highlighted: false },
      { text: "bar", highlighted: true },
      { text: " baz", highlighted: false },
    ]);
  });

  it("handles multiple highlight pairs with alternating parity", () => {
    const segments = splitHighlights(
      `${STX}a${ETX} and ${STX}b${ETX} end`
    );
    expect(segments).toEqual([
      { text: "", highlighted: false },
      { text: "a", highlighted: true },
      { text: " and ", highlighted: false },
      { text: "b", highlighted: true },
      { text: " end", highlighted: false },
    ]);
  });

  it("keeps empty segments from consecutive sentinels so parity holds", () => {
    expect(splitHighlights(`${STX}${ETX}tail`)).toEqual([
      { text: "", highlighted: false },
      { text: "", highlighted: true },
      { text: "tail", highlighted: false },
    ]);
  });

  it("never treats user-typed bracket text as a sentinel", () => {
    // The pre-sentinel design used [[HL]] markers, which user content
    // could forge. Literal bracket text must stay inert.
    expect(splitHighlights("[[HL]]not a highlight[[/HL]]")).toEqual([
      { text: "[[HL]]not a highlight[[/HL]]", highlighted: false },
    ]);
  });
});
