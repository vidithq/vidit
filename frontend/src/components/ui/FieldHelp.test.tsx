import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FieldHelp } from "./FieldHelp";
import { FIELD_HELP } from "@/lib/fieldHelp";

afterEach(() => {
  // Reset the localStorage hide preference between tests.
  window.localStorage.clear();
});

describe("FieldHelp", () => {
  it("reveals the registry label + explanation text on hover / focus", async () => {
    render(<FieldHelp concept="source_url" />);
    const btn = screen.getByRole("button", { name: FIELD_HELP.source_url.label });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(btn);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(FIELD_HELP.source_url.text);
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
