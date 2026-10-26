import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AUTHOR_PILL_KEY } from "./EventFilterSections";
import { FilterRail } from "./FilterRail";

const pills = (onRemove = vi.fn()) => [
  { key: "tag:drone", label: "drone", onRemove },
  { key: AUTHOR_PILL_KEY, label: "By ana", onRemove },
];

describe("FilterRail", () => {
  it("heads the panel with the active filters, minus the author the Author section names", () => {
    render(
      <FilterRail pills={pills()} onClearAll={() => {}}>
        <p>panel</p>
      </FilterRail>,
    );

    expect(screen.getByTitle("Remove filter: drone")).toBeInTheDocument();
    expect(screen.queryByTitle("Remove filter: By ana")).not.toBeInTheDocument();
    expect(screen.getByTitle("Remove filter: drone").compareDocumentPosition(screen.getByText("panel")))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("keeps the author pill when the panel offers no Author section", () => {
    render(
      <FilterRail pills={pills()} onClearAll={() => {}} sections={["tags"]}>
        <p>panel</p>
      </FilterRail>,
    );

    expect(screen.getByTitle("Remove filter: By ana")).toBeInTheDocument();
  });

  it("removes a filter from its pill", () => {
    const onRemove = vi.fn();
    render(
      <FilterRail pills={pills(onRemove)} onClearAll={() => {}}>
        <p>panel</p>
      </FilterRail>,
    );

    fireEvent.click(screen.getByTitle("Remove filter: drone"));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
