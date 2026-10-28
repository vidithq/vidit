import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ARM_MS } from "@/hooks/useConfirmAction";
import { ConfirmButton } from "./ConfirmButton";

afterEach(() => vi.useRealTimers());

describe("<ConfirmButton>", () => {
  it("arms on the first click and acts on the second, as a red trash named by its label", () => {
    const onConfirm = vi.fn();
    const { container } = render(<ConfirmButton icon label="Remove bo" onConfirm={onConfirm} />);
    const button = screen.getByRole("button", { name: "Remove bo" });
    expect(button.className).toContain("text-red-400");
    expect(container.querySelector("svg.lucide-trash-2, svg.lucide-trash2")).not.toBeNull();

    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    const armed = screen.getByRole("button", { name: "Confirm remove bo" });
    expect(armed.className).toContain("!bg-red-500");

    fireEvent.click(armed);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Remove bo" })).toBeInTheDocument();
  });

  it("draws the icon of its action", () => {
    const { container } = render(
      <ConfirmButton icon action="hide" label="Withhold the site" onConfirm={() => {}} />,
    );
    expect(container.querySelector("svg.lucide-eye-off")).not.toBeNull();
  });

  it("keeps a labelled button's text and icon, and swaps the text while armed", () => {
    const onConfirm = vi.fn();
    const { container } = render(
      <ConfirmButton action="leave" label="Leave" onConfirm={onConfirm} />,
    );
    expect(container.querySelector("svg.lucide-log-out")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm leave" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("names a labelled button by `name` when the text alone is ambiguous", () => {
    render(<ConfirmButton label="Remove" name="Remove bo" onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove bo" }));
    expect(screen.getByRole("button", { name: "Confirm remove bo" })).toHaveTextContent(
      "Confirm remove",
    );
  });

  it("disarms on Escape and after the timeout, sending nothing", () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<ConfirmButton icon label="Remove bo" onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove bo" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Remove bo" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove bo" }));
    act(() => vi.advanceTimersByTime(ARM_MS));
    fireEvent.click(screen.getByRole("button", { name: "Remove bo" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
