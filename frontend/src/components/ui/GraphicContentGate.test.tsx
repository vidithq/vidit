import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GraphicContentGate } from "./GraphicContentGate";

const REVEAL = "Show graphic content (18 or older)";

afterEach(() => {
  // The acknowledgement lives in sessionStorage for the whole browser session;
  // reset it so one test's confirmation can't leak into the next.
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
    // Blurred, inert, and out of the accessibility tree: the picture is still
    // in the layout, but nothing under the gate can be read or clicked.
    expect(covered).toHaveClass("blur-xl", "pointer-events-none");
    expect(covered).toHaveAttribute("aria-hidden", "true");
    // `inert` and not only `pointer-events-none`: a keyboard reader must not
    // be able to Tab into the covered media and open the lightbox with Enter.
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

    // sessionStorage fires no `storage` event in the tab that wrote it, so both
    // gates only unblur together because the primitive keeps its own
    // subscribers.
    expect(screen.getAllByRole("button", { name: REVEAL })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: REVEAL })[0]);

    expect(screen.queryByRole("button", { name: REVEAL })).toBeNull();
    expect(screen.getByAltText("First").parentElement).not.toHaveClass("blur-xl");
    expect(screen.getByAltText("Second").parentElement).not.toHaveClass("blur-xl");
    // The wrapper is gone with the gate, so the media is back in the tab order.
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
