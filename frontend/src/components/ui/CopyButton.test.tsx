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
    const { check } = marks(false);
    expect(check).toHaveClass("opacity-0");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("swaps to the check at once and announces the copy, its name unchanged", () => {
    const { check } = marks(true);
    expect(check).toHaveClass("opacity-100");
    expect(screen.getByRole("button", { name: "Copy coordinates" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Coordinates copied");
  });

  it("shows the confirmation in its tooltip while the copy holds", () => {
    marks(true);
    const bubbles = [...document.body.querySelectorAll('[aria-hidden="true"]')];
    expect(bubbles.some((el) => el.textContent === "Coordinates copied")).toBe(true);
  });
});
