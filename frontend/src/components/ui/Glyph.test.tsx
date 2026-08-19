import { fireEvent, render, screen } from "@testing-library/react";
import { Archive } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { Glyph } from "./Glyph";

describe("Glyph", () => {
  it("opens a target in a new tab, in the accent state", () => {
    render(<Glyph icon={Archive} label="Wayback Machine copy of the source" href="https://web.archive.org/x" />);
    const link = screen.getByRole("link", {
      name: "Wayback Machine copy of the source",
    });
    expect(link).toHaveAttribute("href", "https://web.archive.org/x");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveClass("text-orange-400");
  });

  it("acts on this page through onClick, carrying a disclosure's state", () => {
    const onClick = vi.fn();
    render(<Glyph icon={Archive} label="Record a copy" onClick={onClick} expanded={false} />);
    const button = screen.getByRole("button", { name: "Record a copy" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("answers the pointer the same way whichever control it renders as", () => {
    // A mark carries no text, so an underline on hover shows nothing: colour is
    // the one channel it has, and the same rise on both forms is what keeps a
    // navigating mark and an acting one from reading as different offers. An
    // inert mark takes no hover at all, since nothing there answers.
    const { rerender } = render(
      <Glyph icon={Archive} label="Copy of the source" href="https://x.test" />
    );
    const hover = "hover:text-orange-300";
    expect(screen.getByRole("link")).toHaveClass(hover);

    rerender(<Glyph icon={Archive} label="Record a copy" onClick={() => {}} />);
    expect(screen.getByRole("button")).toHaveClass(hover);

    rerender(<Glyph icon={Archive} label="No copy of the source" />);
    expect(screen.getByRole("img").className).not.toMatch(/hover:/);
  });

  // The rule the primitive exists to hold: colour says whether a mark can be
  // acted on, so an inactive one is grey *and* inert, not a greyed control that
  // still fires.
  it("neither navigates nor fires while it is inactive", () => {
    const onClick = vi.fn();
    render(
      <Glyph
        icon={Archive}
        label="No map link yet"
        href="https://example.com"
        onClick={onClick}
        active={false}
      />
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();

    // The state travels in the name, since the mark is not a control that
    // refuses but a statement that there is nothing to act on.
    const inert = screen.getByRole("img", { name: "No map link yet" });
    expect(inert).toHaveClass("text-neutral-600");
    fireEvent.click(inert);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("is inert when it was handed nothing to act with", () => {
    render(<Glyph icon={Archive} label="No archived copy of the source" />);
    expect(
      screen.getByRole("img", { name: "No archived copy of the source" })
    ).toHaveClass("text-neutral-600");
  });

  // The mark carries no text, so the name is the whole control; the tooltip
  // tracks it unless a caller has states of its own (the copied flash).
  it("names itself in the tooltip, `title` overriding the label", () => {
    const { unmount } = render(
      <Glyph icon={Archive} label="Copy coordinates" onClick={() => {}} />
    );
    expect(screen.getByRole("button")).toHaveAttribute("title", "Copy coordinates");
    unmount();

    render(
      <Glyph
        icon={Archive}
        label="Copy coordinates"
        title="Coordinates copied"
        onClick={() => {}}
      />
    );
    const button = screen.getByRole("button", { name: "Copy coordinates" });
    expect(button).toHaveAttribute("title", "Coordinates copied");
  });

  it("hides the mark itself from the accessible name", () => {
    render(<Glyph icon={Archive} label="Copy coordinates" onClick={() => {}} />);
    const svg = screen.getByRole("button").querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("width", "13");
  });
});
