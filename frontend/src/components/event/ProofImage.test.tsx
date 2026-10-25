import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProofImage } from "./ProofImage";

describe("ProofImage", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("opens the shared viewer from the picture itself", async () => {
    render(<ProofImage src="https://cdn.example/anchor.png" alt="Anchor points" />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "View image: Anchor points" }));
    expect(await screen.findByRole("dialog")).toHaveAttribute("aria-label", "Anchor points");
  });

  // The gallery tiles' floating cluster, so a proof frame is saveable without leaving the page.
  it("floats a download and an expand, revealed on hover", async () => {
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
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("shows a media-host picture through the optimizer, capped at 1920 px, and nothing else", () => {
    vi.stubEnv("NEXT_PUBLIC_MEDIA_HOST", "cdn.example");
    render(<ProofImage src="https://cdn.example/anchor.png" alt="On the host" />);
    render(<ProofImage src="https://elsewhere.example/anchor.png" alt="Off the host" />);

    const onHost = screen.getByRole("img", { name: "On the host" });
    expect(onHost.getAttribute("src")).toBe(
      `/_next/image?url=${encodeURIComponent("https://cdn.example/anchor.png")}&w=1920&q=75`,
    );
    expect(onHost).not.toHaveAttribute("srcset");
    expect(screen.getByRole("img", { name: "Off the host" })).toHaveAttribute(
      "src",
      "https://elsewhere.example/anchor.png",
    );
  });
});
