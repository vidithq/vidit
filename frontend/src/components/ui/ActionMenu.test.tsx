import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
          { key: "v3", label: "Version 3", meta: "Current", href: "/events/e1" },
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
    expect(item("Version 3 Current")).toHaveAttribute("href", "/events/e1");
    expect(item("Version 3 Current")).not.toHaveAttribute("aria-current");
  });

  it("moves through the items with the arrow keys, Home and End, wrapping at the ends", () => {
    fireEvent.click(setup());
    const menu = screen.getByRole("menu");

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(item("Version 1")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(item("Full history")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(item("Version 3 Current")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(item("Full history")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(item("Version 3 Current")).toHaveFocus();
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
});
