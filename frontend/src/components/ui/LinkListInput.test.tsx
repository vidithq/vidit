import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LinkListInput } from "./LinkListInput";

const props = {
  max: 3,
  itemLabel: "Link",
  urlOf: (row: string) => row,
  withUrl: (_row: string, url: string) => url,
  blank: () => "",
};

describe("LinkListInput", () => {
  it("renders one field per value, named by position", () => {
    render(
      <LinkListInput
        {...props}
        rows={["https://a.example/1", "https://b.example/2"]}
        onChange={() => {}}
      />
    );
    expect(screen.getByLabelText("Link 1")).toHaveValue(
      "https://a.example/1"
    );
    expect(screen.getByLabelText("Link 2")).toHaveValue(
      "https://b.example/2"
    );
  });

  it("shows only the add button when the list is empty", () => {
    render(<LinkListInput {...props} rows={[]} onChange={() => {}} />);
    expect(screen.queryByLabelText("Link 1")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add link" })
    ).toBeEnabled();
  });

  it("appends a blank row on add", () => {
    const onChange = vi.fn();
    render(
      <LinkListInput {...props} rows={["https://a.example/1"]} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    expect(onChange).toHaveBeenCalledWith(["https://a.example/1", ""]);
  });

  it("edits the value at the row's index, leaving its siblings alone", () => {
    const onChange = vi.fn();
    render(
      <LinkListInput
        {...props}
        rows={["https://a.example/1", "https://b.example/2"]}
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getByLabelText("Link 2"), {
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
        rows={["https://a.example/1", "https://b.example/2"]}
        onChange={onChange}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove link 1" })
    );
    expect(onChange).toHaveBeenCalledWith(["https://b.example/2"]);
  });

  it("keeps what a row carries besides its URL", () => {
    type Row = { url: string; postedAt: string };
    const onChange = vi.fn();
    render(
      <LinkListInput<Row>
        max={3}
        itemLabel="Link"
        urlOf={(r) => r.url}
        withUrl={(r, url) => ({ ...r, url })}
        blank={() => ({ url: "", postedAt: "" })}
        rows={[{ url: "https://a.example/1", postedAt: "2026-01-01T10:00" }]}
        onChange={onChange}
        detail={({ row }) => <span>posted {row.postedAt}</span>}
      />
    );
    expect(screen.getByText("posted 2026-01-01T10:00")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Link 1"), {
      target: { value: "https://b.example/2" },
    });
    expect(onChange).toHaveBeenCalledWith([
      { url: "https://b.example/2", postedAt: "2026-01-01T10:00" },
    ]);
  });

  it("disables add at the cap and says what the cap is", () => {
    render(
      <LinkListInput
        {...props}
        rows={["https://a.example/1", "https://b.example/2", "https://c.example/3"]}
        onChange={() => {}}
      />
    );
    expect(
      screen.getByRole("button", { name: "Add link" })
    ).toBeDisabled();
    expect(screen.getByText("3 maximum.")).toBeInTheDocument();
  });
});
