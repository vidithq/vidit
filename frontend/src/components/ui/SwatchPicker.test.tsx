import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { SwatchPicker } from "./SwatchPicker";

const OPTIONS = [
  { value: "orange", label: "Orange", color: "#f97316" },
  { value: "blue", label: "Blue", color: "#3b82f6" },
  { value: "green", label: "Green", color: "#22c55e" },
];

function Harness({ initial = "orange", onChange = vi.fn() }: { initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <SwatchPicker
      aria-label="Accent color"
      options={OPTIONS}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

describe("SwatchPicker", () => {
  it("is a named radiogroup with the current swatch checked and the only tab stop", () => {
    render(<Harness initial="blue" />);

    expect(screen.getByRole("radiogroup", { name: "Accent color" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Blue" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Blue" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Orange" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("radio", { name: "Orange" })).not.toBeChecked();
  });

  it("selects a clicked swatch, once", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "Green" }));
    fireEvent.click(screen.getByRole("radio", { name: "Green" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("green");
  });

  it("moves focus and selection with the arrow keys, wrapping at the ends", () => {
    render(<Harness />);
    const orange = screen.getByRole("radio", { name: "Orange" });
    orange.focus();

    fireEvent.keyDown(orange, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Blue" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Blue" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("radio", { name: "Blue" }), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("radio", { name: "Orange" }), { key: "ArrowUp" });
    expect(screen.getByRole("radio", { name: "Green" })).toBeChecked();

    fireEvent.keyDown(screen.getByRole("radio", { name: "Green" }), { key: "ArrowDown" });
    expect(screen.getByRole("radio", { name: "Orange" })).toBeChecked();
  });

  it("jumps to the ends with Home and End", () => {
    render(<Harness initial="blue" />);
    const blue = screen.getByRole("radio", { name: "Blue" });

    fireEvent.keyDown(blue, { key: "End" });
    expect(screen.getByRole("radio", { name: "Green" })).toBeChecked();

    fireEvent.keyDown(screen.getByRole("radio", { name: "Green" }), { key: "Home" });
    expect(screen.getByRole("radio", { name: "Orange" })).toBeChecked();
  });

  it("leaves other keys alone", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole("radio", { name: "Orange" }), { key: "a" });

    expect(onChange).not.toHaveBeenCalled();
  });
});
