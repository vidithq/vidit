import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAnchoredPosition } from "./useAnchoredPosition";

function Anchored({ align }: { align?: "start" | "end" }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const style = useAnchoredPosition({ open: true, anchorRef, floatingRef, align });
  return (
    <>
      <button ref={anchorRef} type="button">
        Anchor
      </button>
      <div ref={floatingRef} style={style}>
        Panel
      </div>
    </>
  );
}

/** Puts a 60x30 anchor at (`left`, `top`) and returns where a 150x`height` panel lands. */
function placeAt(
  top: number,
  left: number,
  { height = 200, align }: { height?: number; align?: "start" | "end" } = {},
) {
  vi.spyOn(HTMLButtonElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: left, y: top, width: 60, height: 30 }),
  );
  vi.spyOn(HTMLDivElement.prototype, "offsetWidth", "get").mockReturnValue(150);
  vi.spyOn(HTMLDivElement.prototype, "offsetHeight", "get").mockReturnValue(height);
  const { unmount } = render(<Anchored align={align} />);
  const { top: placedTop, bottom, left: placedLeft } = screen.getByText("Panel").style;
  unmount();
  return { top: placedTop, bottom, left: placedLeft };
}

describe("useAnchoredPosition", () => {
  beforeEach(() => {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(600);
  });
  afterEach(() => vi.restoreAllMocks());

  it("opens 4px below the anchor, at its left edge", () => {
    expect(placeAt(100, 200)).toEqual({ top: "134px", bottom: "", left: "200px" });
  });

  it("ends at the anchor's right edge with align end", () => {
    expect(placeAt(100, 200, { align: "end" }).left).toBe(`${260 - 150}px`);
  });

  it("opens above when the room below is short and the room above larger", () => {
    const { top, bottom } = placeAt(500, 200);
    expect(top).toBe("");
    expect(bottom).toBe(`${600 - (500 - 4)}px`);
  });

  it("stays below when neither side fits and below holds more, inside the viewport", () => {
    expect(placeAt(100, 200, { height: 590 }).top).toBe("8px");
  });

  it("shifts sideways to stay 8px inside the viewport", () => {
    expect(placeAt(100, 950).left).toBe(`${1000 - 8 - 150}px`);
    expect(placeAt(100, 0, { align: "end" }).left).toBe("8px");
  });
});
