import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "@/lib/notifications";
import { eventDetail, filedVersion } from "@/test/eventDetail";

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
  organization: null,
  read_at: null,
  invite_pending: false,
  reapprove_version: null,
  approved_version: null,
  review_request_id: null,
};
const follower: Notification = {
  id: "n1",
  kind: "new_follower",
  created_at: "2026-10-10T09:00:00Z",
  actor: { id: "u3", username: "cy", avatar_url: null },
  event: null,
  organization: null,
  read_at: "2026-10-11T09:00:00Z",
  invite_pending: false,
  reapprove_version: null,
  approved_version: null,
  review_request_id: null,
};
const orgInvite: Notification = {
  id: "n3",
  kind: "organization_invite",
  created_at: "2026-10-13T09:00:00Z",
  actor: { id: "u2", username: "bo", avatar_url: null },
  event: null,
  organization: { slug: "osw", name: "Open Source Watch", avatar_url: null },
  read_at: null,
  invite_pending: false,
  reapprove_version: null,
  approved_version: null,
  review_request_id: null,
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

  it("links an organization invite to the organization page", async () => {
    serve([orgInvite]);
    render(<NotificationsPage />);

    expect(
      await screen.findByRole("link", { name: /bo invited you to join Open Source Watch/ }),
    ).toHaveAttribute("href", "/organizations/osw");
  });

  it("marks the unread rows it shows read, then refreshes the dot", async () => {
    serve([fulfilled, follower]);
    render(<NotificationsPage />);

    await waitFor(() => expect(api.refresh).toHaveBeenCalled());
    expect(api.apiFetch).toHaveBeenCalledWith("/notifications/read", {
      method: "POST",
      body: JSON.stringify({ ids: ["n2"] }),
    });
  });

  it("marks nothing when every row is already read", async () => {
    serve([follower]);
    render(<NotificationsPage />);

    await screen.findByRole("link", { name: /cy followed you/ });
    expect(api.apiFetch).not.toHaveBeenCalled();
  });

  it("answers a pending geolocator invitation from its row, then reloads the feed", async () => {
    const invite: Notification = {
      ...follower,
      id: "n3",
      kind: "co_geolocator_invite",
      event: { id: "e9", title: "Bridge strike" },
      invite_pending: true,
    };
    serve([invite, { ...invite, id: "n4", invite_pending: false }]);
    render(<NotificationsPage />);

    expect(
      await screen.findAllByRole("link", {
        name: /cy invited you to share the credit of: Bridge strike/,
      }),
    ).toHaveLength(2);
    // Only the row still waiting for an answer carries the buttons.
    expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(1);
    const loads = api.apiFetchPage.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e9/geolocator-invites/accept", {
        method: "POST",
      }),
    );
    await waitFor(() => expect(api.apiFetchPage.mock.calls.length).toBeGreaterThan(loads));
  });

  it("lists what changed, then approves the version a re-approval request offers", async () => {
    const live = { ...eventDetail("e7", "Depot fire"), version_no: 3 };
    api.apiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/events/e7"
          ? live
          : path === "/events/e7/versions/2"
            ? filedVersion(live, 2, { title: "Fire near the depot" })
            : undefined,
      ),
    );
    const reapprove: Notification = {
      ...follower,
      id: "n5",
      kind: "re_approve_requested",
      event: { id: "e7", title: "Depot fire" },
      reapprove_version: 3,
      approved_version: 2,
    };
    serve([reapprove, { ...reapprove, id: "n6", reapprove_version: null, approved_version: null }]);
    render(<NotificationsPage />);

    expect(
      await screen.findByText(/Changed since version 2, which you approved: Title\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See version 2" })).toHaveAttribute(
      "href",
      "/events/e7/v2",
    );

    expect(
      await screen.findAllByRole("link", {
        name: /cy saved a new version of a geolocation you approved: Depot fire/,
      }),
    ).toHaveLength(2);
    const loads = api.apiFetchPage.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Approve version 3" }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e7/approvals", {
        method: "POST",
        body: JSON.stringify({ version_no: 3, note: null }),
      }),
    );
    await waitFor(() => expect(api.apiFetchPage.mock.calls.length).toBeGreaterThan(loads));
  });

  it("answers an open review request, and offers nothing once it is resolved", async () => {
    const asked: Notification = {
      ...follower,
      id: "n7",
      kind: "review_request_received",
      event: { id: "e8", title: "Bridge strike" },
      reapprove_version: 2,
      review_request_id: "r1",
    };
    serve([asked, { ...asked, id: "n8", reapprove_version: null, review_request_id: null }]);
    render(<NotificationsPage />);

    expect(
      await screen.findAllByRole("link", { name: /cy asked you to review: Bridge strike/ }),
    ).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Approve version 2" })).toHaveLength(1);
    const loads = api.apiFetchPage.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e8/review-requests/r1/decline", {
        method: "POST",
      }),
    );
    await waitFor(() => expect(api.apiFetchPage.mock.calls.length).toBeGreaterThan(loads));
  });

  it("explains the empty feed", async () => {
    serve([]);
    render(<NotificationsPage />);

    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
  });
});
