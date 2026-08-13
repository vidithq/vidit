import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OverflowMenu } from "./OverflowMenu";

describe("OverflowMenu", () => {
  it("opens the menu on the trigger click", () => {
    render(<OverflowMenu items={[{ label: "Close this request" }]} />);
    const trigger = screen.getByRole("button", { name: "More actions" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // The panel is portaled and only rendered while open.
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu");
    expect(trigger.getAttribute("aria-controls")).toBe(menu.getAttribute("id"));
    expect(
      screen.getByRole("menuitem", { name: "Close this request" })
    ).toBeInTheDocument();
  });

  it("runs an item's action and closes", () => {
    const onClick = vi.fn();
    render(
      <OverflowMenu
        items={[{ label: "Delete this request", danger: true, onClick }]}
      />
    );
    const trigger = screen.getByRole("button", { name: "More actions" });
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole("menuitem", { name: "Delete this request" }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on Escape", () => {
    render(<OverflowMenu items={[{ label: "Close this request" }]} />);
    const trigger = screen.getByRole("button", { name: "More actions" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("renders no trigger when there is nothing to show", () => {
    render(<OverflowMenu items={[]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
