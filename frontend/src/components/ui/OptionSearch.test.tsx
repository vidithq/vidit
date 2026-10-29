import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OptionSearch } from "./OptionSearch";

const KINDS = [
  { value: "drone", label: "Drone" },
  { value: "satellite", label: "Satellite" },
  { value: "article", label: "Article" },
];

function Host({ single = false, required = false }: { single?: boolean; required?: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <OptionSearch
      aria-label="Kind"
      placeholder="Search kinds"
      options={KINDS}
      selected={selected}
      onChange={setSelected}
      single={single}
      required={required}
    />
  );
}

const field = () => screen.getByRole("combobox", { name: "Kind" });
const optionNames = () => screen.queryAllByRole("option").map((o) => o.textContent);

function pick(label: string) {
  fireEvent.focus(field());
  fireEvent.click(screen.getByRole("option", { name: label }));
}

describe("<OptionSearch>", () => {
  it("lists every option on focus, narrows them as you type, and says when none matches", () => {
    render(<Host />);
    fireEvent.focus(field());
    expect(optionNames()).toEqual(["Drone", "Satellite", "Article"]);
    fireEvent.change(field(), { target: { value: "SAT" } });
    expect(optionNames()).toEqual(["Satellite"]);
    fireEvent.change(field(), { target: { value: "zz" } });
    expect(screen.getByRole("status")).toHaveTextContent("No match.");
  });

  it("closes after a pick and shows the picks under the field, each removable", () => {
    render(<Host />);
    pick("Drone");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    pick("Article");
    expect(screen.getByRole("button", { name: "Remove Drone" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Drone" }));
    expect(screen.queryByRole("button", { name: "Remove Drone" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Article" })).toBeInTheDocument();
  });

  it("keeps one pick in single mode, which a new pick replaces", () => {
    render(<Host single />);
    pick("Drone");
    pick("Satellite");
    expect(screen.queryByRole("button", { name: "Remove Drone" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Satellite" })).toBeInTheDocument();
  });

  it("offers no removal of a required single pick", () => {
    render(<Host single required />);
    pick("Drone");
    expect(screen.getByText("Drone")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Drone" })).not.toBeInTheDocument();
  });
});

describe("<OptionSearch> suggestions", () => {
  it("keeps the suggestions to two lines of the field's width, hiding the rest", () => {
    // Two pills to a 28px line: the fifth wraps onto a third line.
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      const index = Number(this.textContent?.match(/kind (\d)/)?.[1] ?? 0);
      return Math.floor(index / 2) * 28;
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(20);
    const kinds = [0, 1, 2, 3, 4].map((i) => ({ value: `k${i}`, label: `kind ${i}` }));
    render(
      <OptionSearch
        aria-label="Kind"
        placeholder="Search kinds"
        options={kinds}
        suggestions={kinds}
        selected={[]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Add kind 3" })).not.toHaveClass("invisible");
    expect(screen.getByRole("button", { name: "Add kind 4" })).toHaveClass("invisible");
    expect(screen.getByRole("group", { name: "Suggested kind" })).toHaveStyle({ maxHeight: "48px" });
    vi.restoreAllMocks();
  });
});
