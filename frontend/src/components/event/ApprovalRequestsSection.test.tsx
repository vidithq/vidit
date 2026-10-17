import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovalRequest } from "@/lib/approvalRequests";
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

import {
  ApprovalRequestsSection,
  DeclineRequests,
  IncomingRequests,
  useApprovalRequests,
} from "./ApprovalRequestsSection";

const ANA = { id: "u1", username: "ana" };
const BO = { id: "u2", username: "bo" };
const CY = { id: "u3", username: "cy" };

const event = { ...eventDetail("e1", "Bridge strike"), version_no: 2, geolocators: [ANA] };

const request = (over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
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
  rows: ApprovalRequest[],
  targets: {
    analysts: (typeof CY)[];
    organizations: (typeof BELLINGCAT)[];
    refusal?: string | null;
  } = {
    analysts: [CY],
    organizations: [BELLINGCAT],
  },
  managed: (typeof BELLINGCAT)[] = [],
) {
  api.apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === "POST") return Promise.resolve(request({ status: "declined" }));
    if (path.includes("approval-request-targets")) return Promise.resolve(targets);
    if (path.endsWith("/organizations")) {
      return Promise.resolve(
        managed.map((organization) => ({
          organization,
          role: "manager",
          joined_at: "2026-10-01T00:00:00Z",
        })),
      );
    }
    return Promise.resolve(rows);
  });
}

/** The requests as the Approvals card lays them out: who asked the reader, Decline, and the
 *  geolocator's section. */
function Requests() {
  const requests = useApprovalRequests(event, 0);
  const { mine } = requests;
  return (
    <>
      {mine.length > 0 && <IncomingRequests requests={mine} />}
      {mine.length > 0 && (
        <DeclineRequests eventId="e1" requests={mine} onAnswered={requests.requests.refetch} />
      )}
      <ApprovalRequestsSection event={event} requests={requests} />
    </>
  );
}

describe("<ApprovalRequestsSection>", () => {
  beforeEach(() => {
    api.apiFetch.mockReset();
    api.viewer = null;
  });

  it("lets a geolocator pick an eligible analyst and ask for approval", async () => {
    api.viewer = ANA;
    serve([request()]);
    render(<Requests />);

    expect(await screen.findByText(/asked by ana/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Request approval" }));
    fireEvent.click(await screen.findByRole("option", { name: "cy" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask cy" }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/approval-requests", {
        method: "POST",
        body: JSON.stringify({ username: "cy" }),
      }),
    );
    // Sent: the form collapses back to its button.
    expect(await screen.findByRole("button", { name: "Request approval" })).toBeInTheDocument();
  });

  it("keeps the request form collapsed until asked, and Cancel collapses it again", async () => {
    api.viewer = ANA;
    serve([]);
    render(<Requests />);

    expect(await screen.findByText("No open requests.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Ask an analyst or an organization/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Request approval" }));
    expect(screen.getByLabelText(/Ask an analyst or an organization/)).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText(/Ask an analyst or an organization/)).toBeNull();
  });

  it("lets a geolocator ask an organization", async () => {
    api.viewer = ANA;
    serve([request({ target: null, target_organization: BELLINGCAT })]);
    render(<Requests />);

    expect(await screen.findByRole("link", { name: "Bellingcat" })).toHaveAttribute(
      "href",
      "/organizations/bellingcat",
    );
    fireEvent.click(screen.getByRole("button", { name: "Request approval" }));
    fireEvent.click(await screen.findByRole("option", { name: /Bellingcat/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ask Bellingcat" }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/approval-requests", {
        method: "POST",
        body: JSON.stringify({ organization: "bellingcat" }),
      }),
    );
  });

  it("says so when no analyst or organization would accept a request", async () => {
    api.viewer = ANA;
    serve([], { analysts: [], organizations: [] });
    render(<Requests />);

    expect(await screen.findByText("No open requests.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Request approval" }));
    expect(await screen.findByText(/No analyst or organization to suggest/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask for approval" })).toBeDisabled();
  });

  it("shows why an exact match cannot be asked, and drops a send error once the query changes", async () => {
    api.viewer = ANA;
    serve([], {
      analysts: [CY],
      organizations: [],
      refusal: "This analyst already reviewed the live version",
    });
    api.apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === "POST") return Promise.reject(new Error("refused"));
      if (path.includes("approval-request-targets")) {
        return Promise.resolve(
          path.endsWith("q=bo")
            ? { analysts: [], organizations: [], refusal: "This analyst already reviewed the live version" }
            : { analysts: [CY], organizations: [], refusal: null },
        );
      }
      return Promise.resolve([]);
    });
    render(<Requests />);

    fireEvent.click(await screen.findByRole("button", { name: "Request approval" }));
    fireEvent.click(await screen.findByRole("option", { name: "cy" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask cy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to send the approval request");

    fireEvent.click(screen.getByRole("button", { name: "cy" }));
    const field = screen.getByLabelText(/Ask an analyst or an organization/);
    fireEvent.change(field, { target: { value: "bo" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      await screen.findByText("This analyst already reviewed the live version"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("lets the analyst asked decline", async () => {
    api.viewer = BO;
    serve([request()]);
    render(<Requests />);

    expect(await screen.findByText(/asked for your approval/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ana" })).toHaveAttribute("href", "/profile/ana");
    expect(screen.queryByRole("button", { name: "Request approval" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/approval-requests/r1/decline", {
        method: "POST",
      }),
    );
  });

  it("lets an org manager of the organization asked decline for it", async () => {
    api.viewer = CY;
    serve([request({ target: null, target_organization: BELLINGCAT })], undefined, [BELLINGCAT]);
    render(<Requests />);

    expect(await screen.findByRole("link", { name: "Bellingcat" })).toHaveAttribute(
      "href",
      "/organizations/bellingcat",
    );
    expect(screen.getByText(/for approval/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/approval-requests/r1/decline", {
        method: "POST",
      }),
    );
  });

  it("lists every requester on one line and declines each request", async () => {
    api.viewer = BO;
    serve([request(), request({ id: "r2", requester: CY })]);
    render(<Requests />);

    const line = await screen.findByText(/asked for your approval/);
    expect(within(line).getByRole("link", { name: "ana" })).toBeInTheDocument();
    expect(within(line).getByRole("link", { name: "cy" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => {
      for (const id of ["r1", "r2"]) {
        expect(api.apiFetch).toHaveBeenCalledWith(`/events/e1/approval-requests/${id}/decline`, {
          method: "POST",
        });
      }
    });
  });

  it("stays hidden for a reader neither credited nor asked", async () => {
    api.viewer = CY;
    serve([]);
    const { container } = render(<Requests />);

    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
