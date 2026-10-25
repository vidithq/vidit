import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActionMenu } from "./ActionMenu";

function setup() {
  render(
    <>
      <ActionMenu
        label="v2: choose a version"
        text="v2"
        icon={<span aria-hidden>▾</span>}
        menuLabel="Versions"
        items={[
          { key: "v3", label: "Version 3", href: "/events/e1" },
          { key: "v2", label: "Version 2", href: "/events/e1/v2", current: true },
          { key: "v1", label: "Version 1", href: "/events/e1/v1" },
          { key: "history", label: "Full history", href: "/events/e1/history" },
        ]}
      />
      <button type="button">Outside</button>
    </>,
  );
  return screen.getByRole("button", { name: "v2: choose a version" });
}

const item = (name: string) => screen.getByRole("menuitem", { name });

describe("<ActionMenu>", () => {
  it("prints its text, opens a named list of links, and focuses the current one", () => {
    const trigger = setup();
    expect(trigger).toHaveTextContent("v2");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);

    const menu = screen.getByRole("menu", { name: "Versions" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", menu.id);
    expect(item("Version 2")).toHaveAttribute("aria-current", "page");
    expect(item("Version 2")).toHaveFocus();
    expect(item("Version 3")).toHaveAttribute("href", "/events/e1");
    expect(item("Version 3")).not.toHaveAttribute("aria-current");
  });

  it("moves through the items with the arrow keys, Home and End, wrapping at the ends", () => {
    fireEvent.click(setup());
    const menu = screen.getByRole("menu");

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(item("Version 1")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(item("Full history")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(item("Version 3")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(item("Full history")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(item("Version 3")).toHaveFocus();
  });

  it("opens on the last item from ArrowUp on the trigger", () => {
    fireEvent.keyDown(setup(), { key: "ArrowUp" });
    expect(item("Full history")).toHaveFocus();
  });

  it("closes on Escape and gives focus back to the trigger", () => {
    const trigger = setup();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("closes on Tab and on a click outside", () => {
    const trigger = setup();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps its default width unless asked to match the trigger", () => {
    fireEvent.click(setup());
    expect(screen.getByRole("menu")).toHaveClass("w-56");
  });

  it("spans the trigger's width and prints an icon-only item as its icon, named by its label", () => {
    render(
      <ActionMenu
        label="v1: choose a version"
        text="v1"
        icon={<span aria-hidden>▾</span>}
        matchTriggerWidth
        items={[
          { key: "v1", label: "v1", href: "/events/e1", current: true },
          {
            key: "history",
            label: "History",
            icon: <svg data-testid="history-icon" />,
            href: "/events/e1/history",
            iconOnly: true,
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "v1: choose a version" }));

    const menu = screen.getByRole("menu");
    expect(menu).toHaveClass("left-0", "right-0");
    expect(menu).not.toHaveClass("w-56");
    const history = item("History");
    expect(history).toHaveAttribute("href", "/events/e1/history");
    expect(history).not.toHaveTextContent("History");
    expect(history).toContainElement(screen.getByTestId("history-icon"));
  });

  it("runs an action item as a button, after closing and giving focus back to the trigger", () => {
    const onSelect = vi.fn();
    render(
      <ActionMenu
        label="More actions"
        icon={<span aria-hidden>…</span>}
        items={[{ key: "close", label: "Close this request", onSelect }]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "More actions" });
    fireEvent.click(trigger);

    const close = item("Close this request");
    expect(close.tagName).toBe("BUTTON");
    expect(close).not.toHaveAttribute("href");
    fireEvent.click(close);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
