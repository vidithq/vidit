import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CopyButton } from "./CopyButton";

function renderButton(copied: boolean) {
  render(
    <CopyButton label="Copy coordinates" announce="Coordinates copied" icon={<span>⧉</span>} copied={copied} onClick={vi.fn()} />,
  );
}

describe("<CopyButton>", () => {
  it("rests on its own mark and says nothing", () => {
    renderButton(false);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("swaps to the check at once and announces the copy, its name unchanged", () => {
    renderButton(true);
    expect(screen.getByRole("button", { name: "Copy coordinates" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Coordinates copied");
  });

  it("shows the confirmation in its tooltip while the copy holds", () => {
    renderButton(true);
    const bubbles = [...document.body.querySelectorAll('[aria-hidden="true"]')];
    expect(bubbles.some((el) => el.textContent === "Coordinates copied")).toBe(true);
  });
});
