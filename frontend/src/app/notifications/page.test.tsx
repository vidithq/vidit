import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "@/lib/notifications";

const api = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiFetchPage: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  apiFetchPage: api.apiFetchPage,
  ApiError: class extends Error {},
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({ user: { id: "u1", username: "ana" }, loading: false }),
}));
vi.mock("@/contexts/NotificationsContext", () => ({
  useUnreadNotifications: () => ({ unread: 0, refresh: api.refresh }),
}));

import NotificationsPage from "./page";

const fulfilled: Notification = {
  id: "n2",
  kind: "request_fulfilled",
  created_at: "2026-10-12T09:00:00Z",
  actor: { id: "u2", username: "bo", avatar_url: null },
  event: { id: "e1", title: "Strike on the depot" },
  unread: true,
};
const follower: Notification = {
  id: "n1",
  kind: "new_follower",
  created_at: "2026-10-10T09:00:00Z",
  actor: { id: "u3", username: "cy", avatar_url: null },
  event: null,
  unread: false,
};

function serve(items: Notification[]) {
  api.apiFetchPage.mockResolvedValue({ items, nextCursor: null });
}

describe("NotificationsPage", () => {
  beforeEach(() => {
    api.apiFetch.mockReset().mockResolvedValue(undefined);
    api.apiFetchPage.mockReset();
    api.refresh.mockReset();
  });

  it("lists rows under New and Earlier, each linking to what it names", async () => {
    serve([fulfilled, follower]);
    render(<NotificationsPage />);

    const fulfilledRow = await screen.findByRole("link", {
      name: /bo geolocated your request: Strike on the depot/,
    });
    expect(fulfilledRow).toHaveAttribute("href", "/events/e1");
    expect(screen.getByRole("link", { name: /cy followed you/ })).toHaveAttribute(
      "href",
      "/profile/cy",
    );

    const fresh = screen.getByRole("heading", { name: "New" }).parentElement!;
    expect(fresh).toContainElement(fulfilledRow);
    expect(screen.getByRole("heading", { name: "Earlier" })).toBeInTheDocument();
  });

  it("advances the marker to the newest row shown, then refreshes the dot", async () => {
    serve([fulfilled, follower]);
    render(<NotificationsPage />);

    await waitFor(() => expect(api.refresh).toHaveBeenCalled());
    expect(api.apiFetch).toHaveBeenCalledWith("/notifications/read", {
      method: "POST",
      body: JSON.stringify({ up_to: "2026-10-12T09:00:00Z" }),
    });
  });

  it("leaves the marker alone when nothing is unread", async () => {
    serve([follower]);
    render(<NotificationsPage />);

    await screen.findByRole("link", { name: /cy followed you/ });
    expect(api.apiFetch).not.toHaveBeenCalled();
  });

  it("explains the empty feed", async () => {
    serve([]);
    render(<NotificationsPage />);

    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
  });
});
