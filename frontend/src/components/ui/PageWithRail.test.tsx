import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageWithRail } from "./PageWithRail";

function railFollowsColumn(narrow?: "stacked" | "below" | "hidden"): boolean {
  render(
    <PageWithRail rail={<p>Rail</p>} railLabel="Actions" narrow={narrow}>
      <p>Column</p>
    </PageWithRail>,
  );
  const rail = screen.getByRole("complementary", { name: "Actions" });
  const column = screen.getByText("Column");
  return !!(column.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("PageWithRail", () => {
  it("stacks the rail above the column by default", () => {
    expect(railFollowsColumn()).toBe(false);
  });

  it("stacks the rail after the column with narrow below, so it is read and tabbed after it", () => {
    expect(railFollowsColumn("below")).toBe(true);
  });
});
