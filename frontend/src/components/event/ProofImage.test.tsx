import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProofImage } from "./ProofImage";

describe("ProofImage", () => {
  it("opens the shared viewer from the picture itself", () => {
    render(<ProofImage src="https://cdn.example/anchor.png" alt="Anchor points" />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "View image: Anchor points" }));
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "Anchor points");
  });

  // The same floating cluster the gallery tiles carry, so a proof frame is
  // saveable without leaving the page.
  it("floats a download and an expand, revealed on hover", () => {
    const { container } = render(
      <ProofImage src="https://cdn.example/anchor.png" alt="Anchor points" />,
    );

    const cluster = screen.getByRole("button", { name: "Download" }).parentElement;
    expect(cluster).toContainElement(screen.getByRole("button", { name: "Expand image" }));
    expect(cluster).toHaveClass("opacity-0", "group-hover:opacity-100");
    // Visible on touch, where no pointer can ever reveal it.
    expect(cluster).toHaveClass("pointer-coarse:opacity-100");
    expect(container.querySelector(".group")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand image" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
