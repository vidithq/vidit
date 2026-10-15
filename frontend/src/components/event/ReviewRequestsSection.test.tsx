import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReviewRequest } from "@/lib/reviewRequests";
import { eventDetail } from "@/test/eventDetail";

const api = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  viewer: null as { id: string; username: string } | null,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  errorMessage: (_err: unknown, fallback: string) => fallback,
  ApiError: class extends Error {},
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: api.viewer }),
}));

import { ReviewRequestsSection } from "./ReviewRequestsSection";

const ANA = { id: "u1", username: "ana" };
const BO = { id: "u2", username: "bo" };
const CY = { id: "u3", username: "cy" };

const event = { ...eventDetail("e1", "Bridge strike"), version_no: 2, geolocators: [ANA] };

const request = (over: Partial<ReviewRequest> = {}): ReviewRequest => ({
  id: "r1",
  event_id: "e1",
  version_no: 2,
  requester: ANA,
  target: BO,
  target_organization: null,
  status: "open",
  created_at: "2026-10-15T09:00:00Z",
  resolved_at: null,
  ...over,
});

const BELLINGCAT = { slug: "bellingcat", name: "Bellingcat", avatar_url: null };

function serve(
  rows: ReviewRequest[],
  targets: { analysts: (typeof CY)[]; organizations: (typeof BELLINGCAT)[] } = {
    analysts: [CY],
    organizations: [BELLINGCAT],
  },
  administered: (typeof BELLINGCAT)[] = [],
) {
  api.apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === "POST") return Promise.resolve(request({ status: "declined" }));
    if (path.includes("review-request-targets")) return Promise.resolve(targets);
    if (path.endsWith("/organizations")) {
      return Promise.resolve(
        administered.map((organization) => ({
          organization,
          role: "admin",
          joined_at: "2026-10-01T00:00:00Z",
        })),
      );
    }
    return Promise.resolve(rows);
  });
}

describe("<ReviewRequestsSection>", () => {
  beforeEach(() => {
    api.apiFetch.mockReset();
    api.viewer = null;
  });

  it("lets a geolocator pick an eligible analyst and ask for a review", async () => {
    api.viewer = ANA;
    serve([request()]);
    render(<ReviewRequestsSection event={event} refreshKey={0} />);

    expect(await screen.findByText(/asked by ana/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Request a review" }));
    fireEvent.click(await screen.findByRole("button", { name: "cy" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask cy" }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/review-requests", {
        method: "POST",
        body: JSON.stringify({ username: "cy" }),
      }),
    );
  });

  it("lets a geolocator ask an organization", async () => {
    api.viewer = ANA;
    serve([request({ target: null, target_organization: BELLINGCAT })]);
    render(<ReviewRequestsSection event={event} refreshKey={0} />);

    expect(await screen.findByRole("link", { name: "Bellingcat" })).toHaveAttribute(
      "href",
      "/organizations/bellingcat",
    );
    fireEvent.click(screen.getByRole("button", { name: "Request a review" }));
    fireEvent.click(await screen.findByRole("button", { name: "Bellingcat" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask Bellingcat" }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/review-requests", {
        method: "POST",
        body: JSON.stringify({ organization: "bellingcat" }),
      }),
    );
  });

  it("says so when no analyst or organization would accept a request", async () => {
    api.viewer = ANA;
    serve([], { analysts: [], organizations: [] });
    render(<ReviewRequestsSection event={event} refreshKey={0} />);

    expect(await screen.findByText("No open requests.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Request a review" }));
    expect(await screen.findByText(/No analyst or organization to suggest/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask for a review" })).toBeDisabled();
  });

  it("lets the analyst asked decline", async () => {
    api.viewer = BO;
    serve([request()]);
    render(<ReviewRequestsSection event={event} refreshKey={0} />);

    expect(await screen.findByText(/asks you to review this geolocation/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request a review" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/review-requests/r1/decline", {
        method: "POST",
      }),
    );
  });

  it("lets an org-admin of the organization asked decline for it", async () => {
    api.viewer = CY;
    serve([request({ target: null, target_organization: BELLINGCAT })], undefined, [BELLINGCAT]);
    render(<ReviewRequestsSection event={event} refreshKey={0} />);

    expect(await screen.findByText(/asks Bellingcat to review this geolocation/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/review-requests/r1/decline", {
        method: "POST",
      }),
    );
  });

  it("stays hidden for a reader neither credited nor asked", async () => {
    api.viewer = CY;
    serve([]);
    const { container } = render(<ReviewRequestsSection event={event} refreshKey={0} />);

    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
