import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import FieldHelp from "./FieldHelp";

describe("FieldHelp", () => {
  it("exposes a labelled help button and the explanation text", () => {
    render(<FieldHelp text="Where the footage was first published." label="Source help" />);
    const btn = screen.getByRole("button", { name: "Source help" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    // The text lives in the DOM (a role=tooltip) so hover / focus reveal it.
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Where the footage was first published.");
    // The trigger is described by the tooltip so a screen reader announces it.
    expect(btn.getAttribute("aria-describedby")).toBe(tooltip.getAttribute("id"));
  });

  it("toggles the pinned state on click (touch devices don't hover)", () => {
    render(<FieldHelp text="help" label="Field help" />);
    const btn = screen.getByRole("button", { name: "Field help" });
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });
});
