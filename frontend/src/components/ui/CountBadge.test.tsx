import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./Button";
import { CountBadge } from "./CountBadge";

const LABEL = "2 missing: Title, Conflict";

const bubble = () =>
  [...document.body.querySelectorAll('[aria-hidden="true"]')].find((el) => el.textContent === LABEL);

function renderPublish(count: number, onClick = () => {}) {
  render(
    <CountBadge count={count} label={LABEL}>
      {(describedBy) => (
        <Button aria-describedby={describedBy} onClick={onClick}>
          Publish
        </Button>
      )}
    </CountBadge>,
  );
  return screen.getByRole("button", { name: "Publish" });
}

describe("CountBadge", () => {
  it("counts beside the control, which it describes", () => {
    const publish = renderPublish(2);
    const badge = screen.getByRole("button", { name: LABEL });
    expect(badge).toHaveTextContent("2");
    expect(publish.contains(badge)).toBe(false);
    expect(publish).toHaveAccessibleDescription(LABEL);
  });

  it("shows nothing at a count of 0", () => {
    const publish = renderPublish(0);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(publish).not.toHaveAttribute("aria-describedby");
  });

  it("lists what is missing while a mouse rests on the badge", () => {
    renderPublish(2);
    fireEvent.pointerEnter(screen.getByRole("button", { name: LABEL }), { pointerType: "mouse" });
    expect(bubble()).toBeDefined();
  });

  it("lists it on a tap on the badge, while a tap on the control still acts", () => {
    const onClick = vi.fn();
    const publish = renderPublish(2, onClick);

    fireEvent.pointerDown(publish, { pointerType: "touch" });
    fireEvent.click(publish);
    expect(onClick).toHaveBeenCalledOnce();
    expect(bubble()).toBeUndefined();

    const badge = screen.getByRole("button", { name: LABEL });
    fireEvent.pointerDown(badge, { pointerType: "touch" });
    fireEvent.click(badge);
    expect(bubble()).toBeDefined();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
