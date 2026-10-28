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
const OTHER = "22222222-2222-2222-2222-222222222222";
const REQUEST = "33333333-3333-3333-3333-333333333333";
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

  it("tells apart two events with the same title by date and author", async () => {
    api.apiFetch.mockResolvedValue({
      geolocations: [
        { id: ID, title: "Strike on the depot", occurred_date: "2026-03-01", owner: { username: "ana" } },
        { id: OTHER, title: "Strike on the depot", occurred_date: null, owner: { username: "bo" } },
      ],
      requests: [
        { id: REQUEST, title: "Strike on the depot", created_at: "2026-04-02T10:00:00Z", owner: { username: "cy" } },
      ],
    });
    render(<EventActionsPanel />);
    const field = screen.getByLabelText(FIELD);
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "depot" } });

    expect(await screen.findByText("1 Mar 2026 · ana")).toBeInTheDocument();
    expect(screen.getByText("Undated · bo")).toBeInTheDocument();
    expect(screen.getByText("Requested 2 Apr 2026 · cy")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Undated · bo/ }));
    expect(api.apiFetch.mock.calls[0][0]).toMatch(/^\/search\?q=depot&type=event/);
    expect(screen.getByTitle("Remove Strike on the depot")).toHaveTextContent("Undated · bo");
    expect(screen.getByRole("button", { name: "Mark graphic" })).toBeEnabled();
  });

  it.each([
    ["Hide", { hidden: true }, "Hidden", "2026-10-28T09:00:00Z"],
    ["Restore", { hidden: false }, "Restored", null],
  ])("names the action on the receipt after %s", async (button, body, badge, hiddenAt) => {
    api.apiFetch.mockResolvedValue({ id: ID, is_graphic: false, hidden_at: hiddenAt });
    render(<EventActionsPanel />);
    fireEvent.change(screen.getByLabelText(FIELD), { target: { value: ID } });

    fireEvent.click(screen.getByRole("button", { name: button }));
    const dialog = screen.queryByRole("dialog");
    if (dialog) fireEvent.click(within(dialog).getByRole("button", { name: button }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith(`/admin/events/${ID}/moderation`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    );
    expect(await screen.findByText(badge)).toBeInTheDocument();
    expect(screen.queryByText("hard")).toBeNull();
    expect(screen.queryByText("soft")).toBeNull();
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
