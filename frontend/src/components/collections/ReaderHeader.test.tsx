import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReaderHeader } from "./ReaderHeader";

function renderHeader(over: { step?: number; total?: number; capped?: boolean } = {}) {
  const onStep = vi.fn();
  render(
    <ReaderHeader
      step={over.step ?? 3}
      total={over.total ?? 12}
      capped={over.capped ?? false}
      onStep={onStep}
    />,
  );
  return { onStep };
}

describe("ReaderHeader", () => {
  it("says where in the collection the reader is", () => {
    renderHeader();

    expect(screen.getByText("3 of 12")).toBeInTheDocument();
  });

  it("carries no way out: it is a block of the collection's own page", () => {
    renderHeader();

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("steps either way", () => {
    const { onStep } = renderHeader({ step: 3 });

    fireEvent.click(screen.getByRole("button", { name: "Next event" }));
    expect(onStep).toHaveBeenCalledWith(4);

    fireEvent.click(screen.getByRole("button", { name: "Previous event" }));
    expect(onStep).toHaveBeenCalledWith(2);
  });

  it("refuses to step off either end", () => {
    const first = renderHeader({ step: 1 });
    expect(screen.getByRole("button", { name: "Previous event" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next event" })).toBeEnabled();
    expect(first.onStep).not.toHaveBeenCalled();

    screen.getByText("1 of 12");
  });

  it("disables the next control on the last step", () => {
    renderHeader({ step: 12 });

    expect(screen.getByRole("button", { name: "Next event" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous event" })).toBeEnabled();
  });

  it("says so when the walk stopped at the ceiling", () => {
    renderHeader({ capped: true, total: 500 });

    expect(
      screen.getByText("First 500 events of this collection."),
    ).toBeInTheDocument();
  });

  it("says nothing about a ceiling it did not reach", () => {
    renderHeader({ capped: false });

    expect(screen.queryByText(/First 500 events/)).not.toBeInTheDocument();
  });
});
