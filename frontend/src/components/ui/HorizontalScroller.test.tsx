import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HorizontalScroller, type HorizontalScrollerHandle } from "./HorizontalScroller";

// jsdom has no layout: each item is 300px wide with a 12px gap, in a 612px strip, so two fit.
const ITEM = 300;
const GAP = 12;
const VIEW = 2 * ITEM + GAP;

function layOut(strip: HTMLElement) {
  Object.defineProperty(strip, "clientWidth", { configurable: true, value: VIEW });
  Array.from(strip.children).forEach((child, i) => {
    Object.defineProperty(child, "offsetWidth", { configurable: true, value: ITEM });
    Object.defineProperty(child, "offsetLeft", { configurable: true, value: i * (ITEM + GAP) });
  });
}

function scrollStrip(strip: HTMLElement, left: number) {
  strip.scrollLeft = left;
  fireEvent.scroll(strip);
}

function renderScroller(count: number) {
  render(
    <HorizontalScroller
      heading={<h2>Things</h2>}
      label="Things"
      previousLabel="Previous thing"
      nextLabel="Next thing"
    >
      {Array.from({ length: count }, (_, i) => (
        <p key={i}>Thing {i + 1}</p>
      ))}
    </HorizontalScroller>,
  );
  return screen.getByRole("region", { name: "Things" });
}

afterEach(() => vi.restoreAllMocks());

describe("HorizontalScroller", () => {
  it("shows one item without a range or buttons", () => {
    renderScroller(1);
    expect(screen.getByText("Thing 1")).toBeInTheDocument();
    expect(screen.queryByText(/of 1/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("follows the scroll with the shown range and stops the buttons at the ends", () => {
    const strip = renderScroller(5);
    const previous = screen.getByRole("button", { name: "Previous thing" });
    const next = screen.getByRole("button", { name: "Next thing" });

    layOut(strip);
    scrollStrip(strip, 0);
    expect(screen.getByText("1 to 2 of 5")).toBeInTheDocument();
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();

    scrollStrip(strip, ITEM + GAP);
    expect(screen.getByText("2 to 3 of 5")).toBeInTheDocument();
    expect(previous).toBeEnabled();

    scrollStrip(strip, 3 * (ITEM + GAP));
    expect(screen.getByText("4 to 5 of 5")).toBeInTheDocument();
    expect(next).toBeDisabled();
    expect(previous).toBeEnabled();
  });

  it("scrolls by one item, without smoothing under reduced motion", () => {
    const strip = renderScroller(5);
    const scrollTo = vi.fn();
    strip.scrollTo = scrollTo;
    layOut(strip);
    scrollStrip(strip, ITEM + GAP);

    fireEvent.click(screen.getByRole("button", { name: "Next thing" }));
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 2 * (ITEM + GAP), behavior: "smooth" });

    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    fireEvent.click(screen.getByRole("button", { name: "Previous thing" }));
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: "auto" });
  });
});

describe("HorizontalScroller controls", () => {
  it("steps with the left and right keys on its buttons", () => {
    const strip = renderScroller(5);
    const scrollTo = vi.fn();
    strip.scrollTo = scrollTo;
    layOut(strip);
    scrollStrip(strip, 0);

    fireEvent.keyDown(screen.getByRole("button", { name: "Next thing" }), { key: "ArrowRight" });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: ITEM + GAP, behavior: "smooth" });
  });

  it("shows an item a parent asks for", () => {
    const ref = createRef<HorizontalScrollerHandle>();
    render(
      <HorizontalScroller
        ref={ref}
        heading={<h2>Things</h2>}
        label="Things"
        previousLabel="Previous thing"
        nextLabel="Next thing"
        actions={<button type="button">Add a thing</button>}
      >
        {Array.from({ length: 3 }, (_, i) => (
          <p key={i}>Thing {i + 1}</p>
        ))}
      </HorizontalScroller>,
    );
    const strip = screen.getByRole("region", { name: "Things" });
    const scrollTo = vi.fn();
    strip.scrollTo = scrollTo;
    layOut(strip);

    act(() => ref.current?.show(2));
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 2 * (ITEM + GAP), behavior: "smooth" });
    expect(screen.getByRole("button", { name: "Add a thing" })).toBeInTheDocument();
  });
});
