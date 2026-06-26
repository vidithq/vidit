import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import FieldHelp from "./FieldHelp";
import { FIELD_HELP } from "@/lib/fieldHelp";

afterEach(() => {
  // The hide preference lives in localStorage; reset it so one test's toggle
  // can't leak into the next.
  window.localStorage.clear();
});

describe("FieldHelp", () => {
  it("resolves a concept to its registry label + explanation text", () => {
    render(<FieldHelp concept="source_url" />);
    const btn = screen.getByRole("button", { name: FIELD_HELP.source_url.label });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    // The text lives in the DOM (a role=tooltip) so hover / focus reveal it.
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent(FIELD_HELP.source_url.text);
    // The trigger is described by the tooltip so a screen reader announces it.
    expect(btn.getAttribute("aria-describedby")).toBe(tooltip.getAttribute("id"));
  });

  it("toggles the pinned state on click (touch devices don't hover)", () => {
    render(<FieldHelp concept="title" />);
    const btn = screen.getByRole("button", { name: FIELD_HELP.title.label });
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("un-pins when the pointer leaves the trigger (dismisses naturally)", () => {
    render(<FieldHelp concept="title" />);
    const btn = screen.getByRole("button", { name: FIELD_HELP.title.label });
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    // Leaving the wrapper (the `?` + its tooltip) closes it on desktop.
    fireEvent.mouseLeave(btn.parentElement as HTMLElement);
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("renders nothing when the user has hidden help (settings toggle)", () => {
    window.localStorage.setItem("vidit:help-hidden", "1");
    render(<FieldHelp concept="title" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
