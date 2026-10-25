import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RemoveButton } from "./RemoveButton";

describe("<RemoveButton>", () => {
  it("is a red button named by what it removes, a cross when the removal is instant", () => {
    const onClick = vi.fn();
    const { container } = render(<RemoveButton label="Remove link 2" onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Remove link 2" });
    expect(button.className).toContain("text-red-400");
    expect(container.querySelector("svg.lucide-x")).not.toBeNull();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows a trash when the removal asks first", () => {
    const { container } = render(<RemoveButton label="Remove source 2" confirms />);
    expect(container.querySelector("svg.lucide-trash-2, svg.lucide-trash2")).not.toBeNull();
    expect(container.querySelector("svg.lucide-x")).toBeNull();
  });
});
