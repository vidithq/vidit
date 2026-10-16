import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActionMenu, type ActionMenuItem } from "./ActionMenu";

function setup(items: ActionMenuItem[] = []) {
  const onEdit = vi.fn();
  const onReport = vi.fn();
  render(
    <>
      <ActionMenu
        label="More actions"
        icon={<span>…</span>}
        items={[
          { key: "history", label: "Version history", href: "/events/e1/history" },
          { key: "edit", label: "Edit", onSelect: onEdit, active: true },
          { key: "report", label: "Report", onSelect: onReport, tone: "danger" },
          ...items,
        ]}
      />
      <button type="button">Outside</button>
    </>,
  );
  return { trigger: screen.getByRole("button", { name: "More actions" }), onEdit, onReport };
}

describe("<ActionMenu>", () => {
  it("opens on a click and focuses the first item", () => {
    const { trigger } = setup();
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);

    const menu = screen.getByRole("menu", { name: "More actions" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", menu.id);
    expect(screen.getByRole("menuitem", { name: "Version history" })).toHaveFocus();
  });

  it("moves through the items with the arrow keys, Home and End, wrapping at the ends", () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    const item = (name: string) => screen.getByRole("menuitem", { name });

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(item("Edit")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(item("Report")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(item("Version history")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(item("Report")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(item("Version history")).toHaveFocus();
  });

  it("opens on the last item from ArrowUp on the trigger", () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "Report" })).toHaveFocus();
  });

  it("closes on Escape and gives focus back to the trigger", () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("closes on Tab and on a click outside", () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("runs an item, closes and gives focus back to the trigger", () => {
    const { trigger, onReport } = setup();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Report" }));
    expect(onReport).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("activates the focused item with Space", () => {
    const { trigger, onEdit } = setup();
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: " " });
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("renders a navigating item as a link and marks an open item's panel", () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Version history" })).toHaveAttribute(
      "href",
      "/events/e1/history",
    );
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Report" })).not.toHaveAttribute("aria-expanded");
  });

  it("names the trigger by its printed label with showLabel", () => {
    render(<ActionMenu label="Share" showLabel icon={<span aria-hidden>↗</span>} items={[]} />);
    const trigger = screen.getByRole("button", { name: "Share" });
    expect(trigger).not.toHaveAttribute("aria-label");
  });
});
