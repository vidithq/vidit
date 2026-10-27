import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import AboutPage from "./page";

describe("/about", () => {
  it("keeps the prose in the main column and the links in the rail", () => {
    render(<AboutPage />);

    const rail = screen.getByRole("complementary", { name: "Links" });
    for (const title of ["Guides", "Stay in touch", "Legal"]) {
      expect(within(rail).getByRole("heading", { name: title })).toBeInTheDocument();
    }
    for (const title of ["Commitments", "Funding", "Privacy", "Behind Vidit"]) {
      const heading = screen.getByRole("heading", { name: title });
      expect(rail).not.toContainElement(heading);
    }
  });

  it("follows the prose with the rail", () => {
    render(<AboutPage />);

    const rail = screen.getByRole("complementary", { name: "Links" });
    const prose = screen.getByRole("heading", { name: "Commitments" });
    expect(
      prose.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
