import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { TitleField } from "./TitleField";

function Host({ onSubmit, form }: { onSubmit: () => void; form?: string }) {
  const [value, setValue] = useState("");
  return (
    <>
      <TitleField value={value} onChange={setValue} form={form} />
      <form
        id="f"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      />
    </>
  );
}

describe("TitleField", () => {
  it("is a one-row field that grows with its text", () => {
    render(<Host onSubmit={vi.fn()} />);
    const field = screen.getByRole("textbox", { name: "Title" });
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveAttribute("rows", "1");
    expect(field.className).toContain("field-sizing-content");
  });

  it("adds no line on Enter and submits the form it joins", () => {
    const onSubmit = vi.fn();
    render(<Host onSubmit={onSubmit} form="f" />);
    const field = screen.getByRole("textbox", { name: "Title" });
    const enter = fireEvent.keyDown(field, { key: "Enter" });
    expect(enter).toBe(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("keeps a pasted title on one line", () => {
    render(<Host onSubmit={vi.fn()} />);
    const field = screen.getByRole("textbox", { name: "Title" });
    fireEvent.change(field, { target: { value: "Strike on a depot\nDonetsk" } });
    expect(field).toHaveValue("Strike on a depot Donetsk");
  });
});
