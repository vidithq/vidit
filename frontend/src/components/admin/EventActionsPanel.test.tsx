import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  errorMessage: (_err: unknown, fallback: string) => fallback,
  ApiError: class extends Error {},
}));

import { EventActionsPanel } from "./EventActionsPanel";

const ID = "11111111-1111-1111-1111-111111111111";

describe("<EventActionsPanel>", () => {
  it("enables the actions once an event ID is typed", () => {
    render(<EventActionsPanel />);
    const markGraphic = screen.getByRole("button", { name: "Mark graphic" });
    expect(markGraphic).toBeDisabled();
    expect(screen.getByRole("button", { name: "Soft delete" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Event ID (UUID)"), { target: { value: ID } });

    expect(markGraphic).toBeEnabled();
    expect(screen.getByRole("button", { name: "Soft delete" })).toBeEnabled();
  });

  it("hard deletes only on the confirming second click", async () => {
    api.apiFetch.mockResolvedValue({
      geolocation_id: ID,
      title: "Strike",
      mode: "hard",
      media_count: 2,
    });
    render(<EventActionsPanel />);
    fireEvent.change(screen.getByLabelText("Event ID (UUID)"), { target: { value: ID } });
    fireEvent.click(screen.getByRole("button", { name: "Hard delete (GDPR)" }));

    fireEvent.click(screen.getByRole("button", { name: "Hard delete" }));
    expect(api.apiFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith(`/admin/events/${ID}?hard=true`, {
        method: "DELETE",
      }),
    );
    expect(await screen.findByText("Swept 2 media rows (source and proof roles).")).toBeInTheDocument();
  });
});
