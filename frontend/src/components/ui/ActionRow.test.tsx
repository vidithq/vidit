import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActionRow } from "./ActionRow";

describe("ActionRow", () => {
  it("prints the label over its line and acts through its action alone", () => {
    const onAdd = vi.fn();
    render(
      <ActionRow
        label="Kupiansk rail corridor"
        description="12 events"
        action={
          <button type="button" onClick={onAdd}>
            Add
          </button>
        }
      />,
    );

    expect(screen.getByText("12 events")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Kupiansk rail corridor"));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledOnce();
  });
});
