import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToggleMatrix } from "./ToggleMatrix";

const COLUMNS = [
  { id: "email", label: "Email" },
  { id: "push", label: "Push" },
];
const REASON = "Push is off on this server.";

function renderMatrix(onToggle = vi.fn()) {
  render(
    <ToggleMatrix
      columns={COLUMNS}
      rows={[
        { id: "follow", label: "New follower", description: "Someone follows you.", on: { email: true } },
        {
          id: "invite",
          label: "Invitation",
          on: { email: false, push: true },
          disabled: { push: REASON },
        },
        { id: "credit", label: "Credit removed", on: {}, disabled: { push: REASON } },
      ]}
      onToggle={onToggle}
    />,
  );
  return onToggle;
}

describe("ToggleMatrix", () => {
  it("prints the column headers once and one named switch per cell", () => {
    renderMatrix();

    expect(screen.getAllByText("Email")).toHaveLength(1);
    expect(screen.getAllByRole("switch")).toHaveLength(6);
    const follow = screen.getByRole("switch", { name: "New follower, Email" });
    expect(follow).toHaveAttribute("aria-checked", "true");
    expect(follow).toHaveAccessibleDescription("Someone follows you.");
    expect(screen.getByRole("switch", { name: "New follower, Push" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("reports the row, the column and the next state on a click", () => {
    const onToggle = renderMatrix();

    fireEvent.click(screen.getByRole("switch", { name: "New follower, Email" }));
    fireEvent.click(screen.getByRole("switch", { name: "Invitation, Email" }));

    expect(onToggle.mock.calls).toEqual([
      ["follow", "email", false],
      ["invite", "email", true],
    ]);
  });

  it("refuses a disabled cell, keeps its state and prints a shared reason once", () => {
    const onToggle = renderMatrix();

    const invitePush = screen.getByRole("switch", { name: "Invitation, Push" });
    expect(invitePush).toBeDisabled();
    expect(invitePush).toHaveAttribute("aria-checked", "true");
    expect(invitePush).toHaveAccessibleDescription(REASON);
    expect(screen.getByRole("switch", { name: "Credit removed, Push" })).toBeDisabled();
    expect(screen.getAllByText(REASON)).toHaveLength(1);

    fireEvent.click(invitePush);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
