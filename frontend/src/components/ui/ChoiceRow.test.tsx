import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChoiceRow } from "./ChoiceRow";

const OPTIONS = [
  { value: "everyone", label: "Everyone" },
  { value: "nobody", label: "Nobody" },
];

describe("ChoiceRow", () => {
  it("shows the label and description over a bar named by the label", () => {
    render(
      <ChoiceRow
        label="Accept requests from"
        description="Who can ask."
        options={OPTIONS}
        value="everyone"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Who can ask.")).toBeInTheDocument();
    const bar = screen.getByRole("group", { name: "Accept requests from" });
    expect(bar).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Everyone" })).toHaveAttribute("aria-pressed", "true");
  });

  it("reports the picked choice", () => {
    const onChange = vi.fn();
    render(
      <ChoiceRow
        label="Accept requests from"
        description="Who can ask."
        options={OPTIONS}
        value="everyone"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Nobody" }));

    expect(onChange).toHaveBeenCalledWith("nobody");
  });
});
