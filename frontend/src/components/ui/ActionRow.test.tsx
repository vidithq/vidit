import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActionRow } from "./ActionRow";

describe("ActionRow", () => {
  it("is one button named by its action and target, with its verb at the edge", () => {
    const onAct = vi.fn();
    render(
      <ActionRow
        leading={<span>cover</span>}
        label="Kupiansk rail corridor"
        description="12 events"
        actionLabel="Add"
        aria-label="Add to Kupiansk rail corridor"
        onAct={onAct}
      />,
    );

    const row = screen.getByRole("button", { name: "Add to Kupiansk rail corridor" });
    expect(row).toHaveTextContent("cover");
    expect(row).toHaveTextContent("12 events");
    expect(row).toHaveTextContent("Add");
    fireEvent.click(screen.getByText("Kupiansk rail corridor"));
    expect(onAct).toHaveBeenCalledOnce();
  });

  it("shows its done state in the verb's place and stops acting", () => {
    const onAct = vi.fn();
    render(
      <ActionRow
        label="Dam breach"
        description="44 events"
        actionLabel="Add"
        aria-label="Add to Dam breach"
        onAct={onAct}
        done={<span>Added 44</span>}
      />,
    );

    const row = screen.getByRole("button", { name: /Dam breach.*Added 44/ });
    expect(row).toBeDisabled();
    fireEvent.click(row);
    expect(onAct).not.toHaveBeenCalled();
  });

  it("refuses the action while disabled", () => {
    const onAct = vi.fn();
    render(
      <ActionRow label="Dam breach" actionLabel="Add" onAct={onAct} disabled aria-label="Add" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAct).not.toHaveBeenCalled();
  });
});
