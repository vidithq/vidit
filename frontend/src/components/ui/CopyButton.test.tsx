import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CopyButton } from "./CopyButton";

function marks(copied: boolean) {
  const { container } = render(
    <CopyButton label="Copy coordinates" announce="Coordinates copied" icon={<span>⧉</span>} copied={copied} onClick={vi.fn()} />,
  );
  const [rest, check] = container.querySelectorAll("button > span > span");
  return { rest, check };
}

describe("<CopyButton>", () => {
  it("rests on its own mark and says nothing", () => {
    const { rest, check } = marks(false);
    expect(rest).toHaveClass("opacity-100");
    expect(check).toHaveClass("opacity-0");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("swaps to the check at once and announces the copy, its name unchanged", () => {
    const { rest, check } = marks(true);
    expect(check).toHaveClass("opacity-100");
    expect(rest).toHaveClass("opacity-0");
    // The swap in is instant; only the way back fades, and only where motion is welcome.
    expect(check.className).not.toContain("transition");
    expect(screen.getByRole("button", { name: "Copy coordinates" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Coordinates copied");
    expect(screen.getByRole("status")).toHaveClass("sr-only");
  });

  it("shows the confirmation in its tooltip while the copy holds", () => {
    marks(true);
    const bubbles = [...document.body.querySelectorAll('[aria-hidden="true"]')];
    expect(bubbles.some((el) => el.textContent === "Coordinates copied")).toBe(true);
  });

  it("fades back only under motion-safe", () => {
    const { rest } = marks(false);
    expect(rest).toHaveClass("motion-safe:transition-opacity");
  });
});
