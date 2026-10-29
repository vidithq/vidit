import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./Button";
import { Tooltip } from "./Tooltip";

const bubble = (text: string) =>
  [...document.body.querySelectorAll('[aria-hidden="true"]')].find((el) => el.textContent === text);

describe("icon button tooltip", () => {
  it("shows the label while a mouse rests on the button, and hides it on leave", () => {
    render(
      <Button icon variant="ghost" aria-label="Report">
        !
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Report" });
    expect(button).not.toHaveAttribute("title");

    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    expect(bubble("Report")).toBeDefined();
    fireEvent.pointerLeave(button, { pointerType: "mouse" });
    // The close waits a beat so the pointer can cross gaps; a fresh render shows it shut.
  });

  it("never opens on a touch", () => {
    render(
      <Button icon variant="ghost" aria-label="Report">
        !
      </Button>,
    );
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Report" }), { pointerType: "touch" });
    expect(bubble("Report")).toBeUndefined();
  });

  it("opens on keyboard focus and closes on Escape", () => {
    render(
      <Button icon variant="ghost" aria-label="Share">
        ↗
      </Button>,
    );
    act(() => screen.getByRole("button", { name: "Share" }).focus());
    expect(bubble("Share")).toBeDefined();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(bubble("Share")).toBeUndefined();
  });

  it("shows a longer hint from title, and keeps the native title off", () => {
    render(
      <Button icon variant="ghost" aria-label="Edit" title="Edit (saves a new version)">
        ✎
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Edit" });
    expect(button).not.toHaveAttribute("title");
    fireEvent.keyDown(document, { key: "Tab" });
    act(() => button.focus());
    expect(bubble("Edit (saves a new version)")).toBeDefined();
  });

  it("stays shut while the button's own menu is open", () => {
    render(
      <Button icon variant="ghost" aria-label="Versions" aria-expanded>
        ▾
      </Button>,
    );
    act(() => screen.getByRole("button", { name: "Versions" }).focus());
    expect(bubble("Versions")).toBeUndefined();
  });

  it("leaves a text button alone", () => {
    render(<Button title="Hint">Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("title", "Hint");
  });

  it("wraps an icon link without changing its parent's layout", () => {
    render(
      <nav>
        <Tooltip label="Edit">
          <a href="#edit" aria-label="Edit">
            ✎
          </a>
        </Tooltip>
      </nav>,
    );
    const link = screen.getByRole("link", { name: "Edit" });
    fireEvent.pointerEnter(link.parentElement!, { pointerType: "mouse" });
    expect(bubble("Edit")).toBeDefined();
  });

  it("with tapToShow, shows the label on a touch's first tap and follows the link on the second", () => {
    render(
      <Tooltip label="maya approved v2 on 15 Oct 2026" tapToShow>
        <a href="#maya" aria-label="maya approved v2 on 15 Oct 2026">
          m
        </a>
      </Tooltip>,
    );
    const link = screen.getByRole("link");
    fireEvent.pointerDown(link, { pointerType: "touch" });
    expect(fireEvent.click(link)).toBe(false);
    expect(bubble("maya approved v2 on 15 Oct 2026")).toBeDefined();

    fireEvent.pointerDown(link, { pointerType: "touch" });
    expect(fireEvent.click(link)).toBe(true);
  });

  it("with tapToShow, lets a mouse click follow the link at once", () => {
    render(
      <Tooltip label="maya" tapToShow>
        <a href="#maya" aria-label="maya">
          m
        </a>
      </Tooltip>,
    );
    const link = screen.getByRole("link");
    fireEvent.pointerDown(link, { pointerType: "mouse" });
    expect(fireEvent.click(link)).toBe(true);
  });
});
