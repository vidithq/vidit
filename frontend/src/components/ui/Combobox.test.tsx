import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Combobox } from "./Combobox";

/** Puts the field at `top` (36px tall, 200px wide) in a 568px-high viewport. */
function placeField(top: number) {
  vi.spyOn(HTMLInputElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 20, y: top, width: 200, height: 36 }),
  );
}

function renderOpen() {
  render(
    <Combobox
      options={["Russian invasion of Ukraine"]}
      optionKey={(o) => o}
      renderOption={(o) => o}
      onPick={() => {}}
      query=""
      onQueryChange={() => {}}
      open
      onOpenChange={() => {}}
      aria-label="Conflict"
    />,
  );
  return screen.getByRole("listbox").parentElement!;
}

/** The list's vertical extent, from its fixed `top` or `bottom` and its `maxHeight`. */
function extent(list: HTMLElement) {
  const max = parseFloat(list.style.maxHeight);
  if (list.style.top) return { top: parseFloat(list.style.top), bottom: parseFloat(list.style.top) + max };
  const bottom = window.innerHeight - parseFloat(list.style.bottom);
  return { top: bottom - max, bottom };
}

describe("Combobox list placement", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("opens below the field when the room allows", () => {
    window.innerHeight = 568;
    placeField(100);
    const list = renderOpen();
    expect(list.style.top).toBe("140px");
    expect(list.style.maxHeight).toBe("240px");
  });

  it("opens above a field near the bottom, inside the viewport", () => {
    window.innerHeight = 568;
    placeField(500);
    const { top, bottom } = extent(renderOpen());
    expect(bottom).toBe(496);
    expect(top).toBeGreaterThanOrEqual(8);
  });

  it("stays inside the viewport while the field is below it", () => {
    window.innerHeight = 568;
    placeField(800);
    const { top, bottom } = extent(renderOpen());
    expect(top).toBeGreaterThanOrEqual(8);
    expect(bottom).toBeLessThanOrEqual(560);
  });

  it("follows the field when the page shifts without a scroll", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    window.innerHeight = 568;
    placeField(100);
    const list = renderOpen();
    expect(list.style.top).toBe("140px");

    // An image above the field loads and pushes it down: no scroll event, no resize.
    placeField(300);
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(extent(list).bottom).toBeLessThanOrEqual(560);
    expect(list.style.bottom).toBe("272px");
  });
});
