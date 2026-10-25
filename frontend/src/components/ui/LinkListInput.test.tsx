import { useState } from "react";
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

  it("heads the list with one Links label, red while flagged, and removes in red", () => {
    const { rerender } = render(
      <LinkListInput {...props} rows={["https://a.example/1"]} onChange={() => {}} heading="Links" />
    );
    expect(screen.getAllByText("Links")).toHaveLength(1);
    expect(screen.getByText("Links").className).not.toContain("text-red-400");
    expect(screen.getByRole("button", { name: "Remove link 1" }).className).toContain("text-red-400");
    rerender(
      <LinkListInput {...props} rows={["https://a.example/1"]} onChange={() => {}} invalid />
    );
    expect(screen.getByText("Links").className).toContain("text-red-400");
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
        columns={[
          {
            header: "Posted",
            width: "13rem",
            cell: ({ index, row, update }) => (
              <input
                aria-label={`Posted ${index + 1}`}
                value={row.postedAt}
                onChange={(e) => update({ ...row, postedAt: e.target.value })}
              />
            ),
          },
        ]}
      />
    );
    expect(screen.getByLabelText("Posted 1")).toHaveValue("2026-01-01T10:00");
    fireEvent.change(screen.getByLabelText("Link 1"), {
      target: { value: "https://b.example/2" },
    });
    expect(onChange).toHaveBeenLastCalledWith([
      { url: "https://b.example/2", postedAt: "2026-01-01T10:00" },
    ]);
    fireEvent.change(screen.getByLabelText("Posted 1"), {
      target: { value: "2026-02-02T08:00" },
    });
    expect(onChange).toHaveBeenLastCalledWith([
      { url: "https://a.example/1", postedAt: "2026-02-02T08:00" },
    ]);
  });

  it("keeps a row's open line with its row when a row above it is removed", () => {
    function Host() {
      const [rows, setRows] = useState(["https://a.example/1", "https://b.example/2"]);
      return (
        <LinkListInput
          {...props}
          rows={rows}
          onChange={setRows}
          columns={[
            {
              header: "Archive",
              width: "auto",
              cell: ({ index, toggle }) => (
                <button type="button" onClick={toggle}>
                  Open {index + 1}
                </button>
              ),
            },
          ]}
          expansion={({ row }) => <p>line of {row}</p>}
        />
      );
    }
    render(<Host />);
    expect(screen.queryByText(/^line of/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open 2" }));
    expect(screen.getByText("line of https://b.example/2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove link 1" }));
    expect(screen.getByText("line of https://b.example/2")).toBeInTheDocument();
  });

  it("focuses the new row's URL field on add", () => {
    function Host() {
      const [rows, setRows] = useState(["https://a.example/1"]);
      return <LinkListInput {...props} rows={rows} onChange={setRows} />;
    }
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    expect(screen.getByLabelText("Link 2")).toHaveFocus();
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
