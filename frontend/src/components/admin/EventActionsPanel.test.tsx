import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  errorMessage: (_err: unknown, fallback: string) => fallback,
  ApiError: class extends Error {},
}));

import { EventActionsPanel } from "./EventActionsPanel";

const ID = "11111111-1111-1111-1111-111111111111";
const FIELD = "Event (title, ID or link)";

beforeEach(() => {
  api.apiFetch.mockReset();
});

describe("<EventActionsPanel>", () => {
  it("enables the actions once an event ID or link is pasted", () => {
    render(<EventActionsPanel />);
    const markGraphic = screen.getByRole("button", { name: "Mark graphic" });
    expect(markGraphic).toBeDisabled();
    expect(screen.getByRole("button", { name: "Soft delete" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(FIELD), {
      target: { value: `https://example.org/events/${ID}/v2` },
    });

    expect(screen.getByTitle(`Remove ${ID}`)).toBeInTheDocument();
    expect(markGraphic).toBeEnabled();
    expect(screen.getByRole("button", { name: "Soft delete" })).toBeEnabled();
  });

  it("picks an event from a title search", async () => {
    api.apiFetch.mockResolvedValue({
      geolocations: [{ id: ID, title: "Strike on the depot", owner: { username: "ana" } }],
      requests: [],
    });
    render(<EventActionsPanel />);
    const field = screen.getByLabelText(FIELD);
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "depot" } });

    fireEvent.click(await screen.findByRole("option", { name: /Strike on the depot/ }));
    expect(api.apiFetch.mock.calls[0][0]).toMatch(/^\/search\?q=depot&type=event/);
    expect(screen.getByTitle("Remove Strike on the depot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark graphic" })).toBeEnabled();
  });

  it("hard deletes only from the confirm dialog", async () => {
    api.apiFetch.mockResolvedValue({
      geolocation_id: ID,
      title: "Strike",
      mode: "hard",
      media_count: 2,
    });
    render(<EventActionsPanel />);
    fireEvent.change(screen.getByLabelText(FIELD), { target: { value: ID } });
    fireEvent.click(screen.getByRole("button", { name: "Hard delete (GDPR)" }));

    fireEvent.click(screen.getByRole("button", { name: "Hard delete" }));
    expect(api.apiFetch).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Hard delete is irreversible.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Hard delete" }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith(`/admin/events/${ID}?hard=true`, {
        method: "DELETE",
      }),
    );
    expect(await screen.findByText("Swept 2 media rows (source and proof roles).")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
