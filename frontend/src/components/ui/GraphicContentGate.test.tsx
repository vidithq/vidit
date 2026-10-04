import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GraphicContentGate } from "./GraphicContentGate";

const REVEAL = "Show graphic content (18 or older)";

afterEach(() => {
  // Reset the sessionStorage acknowledgement between tests.
  window.sessionStorage.clear();
});

describe("GraphicContentGate", () => {
  it("hides the media behind a confirmation until the reader answers", () => {
    render(
      <GraphicContentGate>
        <img src="/media/a.jpg" alt="A street corner" />
      </GraphicContentGate>,
    );

    const covered = screen.getByAltText("A street corner").parentElement;
    // Blurred, inert and out of the accessibility tree.
    expect(covered).toHaveClass("blur-xl", "pointer-events-none");
    expect(covered).toHaveAttribute("aria-hidden", "true");
    // `inert`, not only `pointer-events-none`: Tab and Enter must not reach the
    // covered media.
    expect(covered).toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: REVEAL })).toBeInTheDocument();
  });

  it("reveals every mounted instance from one confirmation", () => {
    render(
      <>
        <GraphicContentGate>
          <img src="/media/a.jpg" alt="First" />
        </GraphicContentGate>
        <GraphicContentGate variant="compact">
          <img src="/media/b.jpg" alt="Second" />
        </GraphicContentGate>
      </>,
    );

    // No `storage` event fires in the writing tab; the primitive keeps its own
    // subscribers.
    expect(screen.getAllByRole("button", { name: REVEAL })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: REVEAL })[0]);

    expect(screen.queryByRole("button", { name: REVEAL })).toBeNull();
    expect(screen.getByAltText("First").parentElement).not.toHaveClass("blur-xl");
    expect(screen.getByAltText("Second").parentElement).not.toHaveClass("blur-xl");
    expect(screen.getByAltText("First").closest("[inert]")).toBeNull();
    expect(screen.getByAltText("Second").closest("[inert]")).toBeNull();
  });

  it("starts revealed for an instance mounted after the confirmation", () => {
    render(
      <GraphicContentGate>
        <img src="/media/a.jpg" alt="First" />
      </GraphicContentGate>,
    );
    fireEvent.click(screen.getByRole("button", { name: REVEAL }));

    render(
      <GraphicContentGate variant="compact">
        <img src="/media/c.jpg" alt="Later" />
      </GraphicContentGate>,
    );

    expect(screen.queryByRole("button", { name: REVEAL })).toBeNull();
    expect(screen.getByAltText("Later").parentElement).not.toHaveClass("blur-xl");
  });
});
