import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LinkListInput } from "./LinkListInput";

const props = {
  max: 3,
  itemLabel: "Secondary source",
};

describe("LinkListInput", () => {
  it("renders one field per value, named by position", () => {
    render(
      <LinkListInput
        {...props}
        values={["https://a.example/1", "https://b.example/2"]}
        onChange={() => {}}
      />
    );
    expect(screen.getByLabelText("Secondary source 1")).toHaveValue(
      "https://a.example/1"
    );
    expect(screen.getByLabelText("Secondary source 2")).toHaveValue(
      "https://b.example/2"
    );
  });

  it("shows only the add button when the list is empty", () => {
    render(<LinkListInput {...props} values={[]} onChange={() => {}} />);
    expect(screen.queryByLabelText("Secondary source 1")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add secondary source" })
    ).toBeEnabled();
  });

  it("appends a blank row on add", () => {
    const onChange = vi.fn();
    render(
      <LinkListInput {...props} values={["https://a.example/1"]} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Add secondary source" }));
    expect(onChange).toHaveBeenCalledWith(["https://a.example/1", ""]);
  });

  it("edits the value at the row's index, leaving its siblings alone", () => {
    const onChange = vi.fn();
    render(
      <LinkListInput
        {...props}
        values={["https://a.example/1", "https://b.example/2"]}
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getByLabelText("Secondary source 2"), {
      target: { value: "https://c.example/3" },
    });
    expect(onChange).toHaveBeenCalledWith([
      "https://a.example/1",
      "https://c.example/3",
    ]);
  });

  it("drops the row at the removed index", () => {
    const onChange = vi.fn();
    render(
      <LinkListInput
        {...props}
        values={["https://a.example/1", "https://b.example/2"]}
        onChange={onChange}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove secondary source 1" })
    );
    expect(onChange).toHaveBeenCalledWith(["https://b.example/2"]);
  });

  it("disables add at the cap and says what the cap is", () => {
    render(
      <LinkListInput
        {...props}
        values={["https://a.example/1", "https://b.example/2", "https://c.example/3"]}
        onChange={() => {}}
      />
    );
    expect(
      screen.getByRole("button", { name: "Add secondary source" })
    ).toBeDisabled();
    expect(screen.getByText("3 maximum.")).toBeInTheDocument();
  });
});
