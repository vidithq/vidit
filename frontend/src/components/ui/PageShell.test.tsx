import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

import { PageShell } from "./PageShell";

function railFollowsColumn(narrowRail?: "stacked" | "below" | "hidden"): boolean {
  render(
    <PageShell title="Page" rail={<p>Rail</p>} railLabel="Actions" narrowRail={narrowRail}>
      <p>Column</p>
    </PageShell>,
  );
  const rail = screen.getByRole("complementary", { name: "Actions" });
  const column = screen.getByText("Column");
  return !!(column.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("PageShell's rail", () => {
  it("stacks the rail above the column by default", () => {
    expect(railFollowsColumn()).toBe(false);
  });

  it("stacks the rail after the column with narrow below, so it is read and tabbed after it", () => {
    expect(railFollowsColumn("below")).toBe(true);
  });
});
