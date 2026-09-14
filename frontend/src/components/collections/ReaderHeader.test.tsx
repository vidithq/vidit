import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReaderHeader } from "./ReaderHeader";

function renderHeader(over: { step?: number; total?: number } = {}) {
  const onStep = vi.fn();
  render(
    <ReaderHeader
      step={over.step ?? 3}
      total={over.total ?? 12}
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

  // The end of the sequence is where a step has nowhere to go, so the control
  // that would take it there is the one that is off.
  it.each([
    { step: 1, off: "Previous event", on: "Next event" },
    { step: 12, off: "Next event", on: "Previous event" },
  ])("refuses to step off the end at $step", ({ step, off, on }) => {
    renderHeader({ step });

    expect(screen.getByRole("button", { name: off })).toBeDisabled();
    expect(screen.getByRole("button", { name: on })).toBeEnabled();
  });
});
