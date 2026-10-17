import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApiResource } from "@/hooks/useApiResource";
import { ApiError } from "@/lib/api";
import { allApprovalsPath, type Approval, type ApprovalList } from "@/lib/approvals";
import type { EventDetail } from "@/types";
import { eventDetail, filedVersion } from "@/test/eventDetail";

const api = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  viewer: null as { id: string; username: string } | null,
  // What the server says of the viewer; null derives it from the viewer and the credit.
  mayApprove: null as boolean | null,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  errorMessage: (_err: unknown, fallback: string) => fallback,
  ApiError: class extends Error {
    code: string | null;
    constructor(message: string, _status: number, code: string | null = null) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: api.viewer }),
}));

import { ApprovalStamps, VersionApprovals } from "./Approvals";
import { ApprovalsCard } from "./ApprovalsCard";

const ANA = { id: "u1", username: "ana" };
const BO = { id: "u2", username: "bo" };
const CY = { id: "u3", username: "cy" };
const BELLINGCAT = { slug: "bellingcat", name: "Bellingcat", avatar_url: null };
const ALL = "/events/e1/approvals?all_versions=true";

const event = { ...eventDetail("e1", "Bridge strike"), version_no: 2, geolocators: [ANA] };

const approval = (over: Partial<Approval> = {}): Approval => ({
  id: "a1",
  version_no: 2,
  verdict: "approve",
  reviewer: BO,
  note: null,
  created_at: "2026-10-15T09:00:00Z",
  current: true,
  revoked_at: null,
  revoke_reason: null,
  revoked_as: null,
  organization: null,
  ...over,
});

const listOf = (items: Approval[]): ApprovalList => ({
  items,
  viewer_can_approve:
    api.mayApprove ?? (api.viewer !== null && !event.geolocators.some((g) => g.id === api.viewer?.id)),
});

function serve(rows: Approval[], extra: Record<string, unknown> = {}) {
  api.apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === "POST") return Promise.resolve(approval());
    if (path in extra) return Promise.resolve(extra[path]);
    return Promise.resolve(path === ALL ? listOf(rows) : []);
  });
}

function Panel({ geo = event }: { geo?: EventDetail }) {
  const approvals = useApiResource<ApprovalList>(allApprovalsPath(geo.id));
  return <ApprovalsCard event={geo} approvals={approvals} />;
}

/** The stamps in the Approvals card, as their link names. */
const stampNames = async () =>
  within(await screen.findByRole("list", { name: "Approved by" }))
    .getAllByRole("link")
    .map((l) => l.getAttribute("aria-label"));

/** How many times the card read the approval list. */
const listReads = () => api.apiFetch.mock.calls.filter(([path]) => path === ALL).length;

beforeEach(() => {
  api.apiFetch.mockReset();
  api.viewer = null;
  api.mayApprove = null;
});

describe("<ApprovalStamps>", () => {
  it("renders nothing for an empty list", () => {
    const { container } = render(<ApprovalStamps approvals={[]} onOverflow={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links each current approval to its signer's page, oldest first, organizations as squares", () => {
    render(
      <ApprovalStamps
        approvals={[approval(), approval({ id: "a2", reviewer: CY, organization: BELLINGCAT })]}
        onOverflow={vi.fn()}
      />,
    );
    const stamps = within(screen.getByRole("list", { name: "Approved by" })).getAllByRole("link");
    expect(stamps.map((s) => [s.getAttribute("aria-label"), s.getAttribute("href")])).toEqual([
      ["bo", "/profile/bo"],
      ["Bellingcat", "/organizations/bellingcat"],
    ]);
    expect(stamps[0].className).toContain("rounded-full");
    expect(stamps[1].className).toContain("rounded-md");
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("opens no card on a click and quotes no note", () => {
    render(
      <ApprovalStamps approvals={[approval({ note: "Skyline matches the ridge" })]} onOverflow={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("link", { name: "bo" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Skyline matches the ridge")).toBeNull();
  });
  it("stamps an organization approval whose acting org manager was erased", () => {
    render(
      <ApprovalStamps
        approvals={[approval({ organization: BELLINGCAT, reviewer: null })]}
        onOverflow={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: "Bellingcat" })).toHaveAttribute(
      "href",
      "/organizations/bellingcat",
    );
  });
  it("shows five and folds the rest into a bubble", () => {
    const onOverflow = vi.fn();
    const rows = Array.from({ length: 7 }, (_, i) =>
      approval({ id: `a${i}`, reviewer: { id: `r${i}`, username: `r${i}` } }),
    );
    render(<ApprovalStamps approvals={rows} onOverflow={onOverflow} />);
    expect(screen.getAllByRole("link")).toHaveLength(5);
    const more = screen.getByRole("button", { name: "Show 2 more approvals" });
    expect(more).toHaveTextContent("+2");
    fireEvent.click(more);
    expect(onOverflow).toHaveBeenCalledOnce();
  });
});

describe("<ApprovalsCard>", () => {
  it("stamps the live version's standing approvals, with no status line and no note", async () => {
    serve([approval({ note: "Skyline matches" }), approval({ id: "a2", reviewer: CY })]);
    render(<Panel />);

    expect(await stampNames()).toEqual(["bo", "cy"]);
    expect(screen.queryByText(/^Approved ·/)).toBeNull();
    expect(screen.queryByText("No approvals yet")).toBeNull();
    expect(screen.queryByText("Skyline matches")).toBeNull();
  });
  it("says when no approval stands yet, in place of the stamps", async () => {
    serve([approval({ id: "v1", version_no: 1, current: false })]);
    render(<Panel />);

    expect(await screen.findByText("No approvals yet")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Approved by" })).toBeNull();
  });

  it("approves the version on screen in one click, with no note, and confirms it", async () => {
    api.viewer = CY;
    serve([]);
    render(<Panel />);

    expect(await screen.findByText("No approvals yet")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/approvals", {
        method: "POST",
        body: JSON.stringify({ version_no: 2 }),
      }),
    );
    await waitFor(() => expect(listReads()).toBe(2));
    expect(await screen.findByRole("status")).toHaveTextContent("Approved version 2.");
  });
  it("offers a reload when the live version moved on since the page loaded", async () => {
    api.viewer = CY;
    api.apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === "POST")
        return Promise.reject(new ApiError("stale", 409, "version_mismatch"));
      return Promise.resolve(path === ALL ? listOf([]) : []);
    });
    render(<Panel />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("offers no reload for another approve error", async () => {
    api.viewer = CY;
    api.apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === "POST")
        return Promise.reject(new ApiError("taken", 409, "already_approved"));
      return Promise.resolve(path === ALL ? listOf([]) : []);
    });
    render(<Panel />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("tells a reviewer who revoked their approval of the live version they cannot approve it again", async () => {
    api.viewer = BO;
    serve([
      approval({
        current: false,
        revoked_at: "2026-10-16T09:00:00Z",
        revoked_as: "reviewer",
      }),
    ]);
    render(<Panel />);

    expect(
      await screen.findByText(
        "You revoked your approval of version 2. You cannot approve this version again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("says nothing of a revoked approval on an earlier version", async () => {
    api.viewer = BO;
    serve([
      approval({ version_no: 1, current: false, revoked_at: "2026-10-16T09:00:00Z", revoked_as: "reviewer" }),
    ]);
    render(<Panel />);

    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.queryByText(/cannot approve this version again/)).toBeNull();
  });

  it("holds the approve buttons until the list reloads after an approval", async () => {
    api.viewer = CY;
    let reads = 0;
    api.apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === "POST") return Promise.resolve(approval());
      if (path !== ALL) return Promise.resolve([]);
      reads += 1;
      return reads === 1 ? Promise.resolve(listOf([])) : new Promise(() => {});
    });
    render(<Panel />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });
  it("tells the reader what changed since the earlier version they approved", async () => {
    api.viewer = CY;
    serve([approval({ id: "a0", version_no: 1, current: false, reviewer: CY })], {
      "/events/e1/versions/1": filedVersion(event, 1, { title: "Bridge strike, first read" }),
    });
    render(<Panel />);

    const line = await screen.findByText(/Changed since: Title\./);
    expect(line).toHaveTextContent("You approved v1. Changed since: Title.");
    expect(within(line).getByRole("link", { name: "v1" })).toHaveAttribute("href", "/events/e1/v1");
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("says nothing of an earlier approval the reader does not hold", async () => {
    api.viewer = CY;
    serve([approval({ id: "a0", version_no: 1, current: false })]);
    render(<Panel />);

    expect(await screen.findByText("No approvals yet")).toBeInTheDocument();
    expect(screen.queryByText(/You approved/)).toBeNull();
  });

  it("offers no approval to an analyst the server refuses, such as a former geolocator", async () => {
    api.viewer = CY;
    api.mayApprove = false;
    serve([approval()]);
    render(<Panel />);

    expect(await stampNames()).toEqual(["bo"]);
    expect(screen.queryByRole("button", { name: /^Approve\b/ })).toBeNull();
  });
  it("stamps an organization approval whose acting org manager was erased", async () => {
    serve([approval({ organization: BELLINGCAT, reviewer: null })]);
    render(<Panel />);

    expect(await stampNames()).toEqual(["Bellingcat"]);
  });
  it("offers a geolocator no approval", async () => {
    api.viewer = ANA;
    serve([approval()]);
    render(<Panel />);

    expect(await stampNames()).toEqual(["bo"]);
    expect(screen.queryByRole("button", { name: /^Approve\b/ })).toBeNull();
  });

  // Outdated and revoked approvals are read on each version's page.
  it("shows only the live version's standing approvals", async () => {
    serve([
      approval({ id: "v1", version_no: 1, current: false, reviewer: CY, note: "Roof vents" }),
      approval({
        id: "gone",
        reviewer: ANA,
        current: false,
        revoked_at: "2026-10-16T09:00:00Z",
        revoke_reason: "Wrong bridge",
        revoked_as: "reviewer",
      }),
      approval({ note: "Skyline matches" }),
    ]);
    render(<Panel />);

    expect(await stampNames()).toEqual(["bo"]);
    expect(screen.queryByText("Roof vents")).toBeNull();
    expect(screen.queryByText(/Wrong bridge/)).toBeNull();
    expect(screen.queryByText(/outdated|revoked/i)).toBeNull();
  });

  const reviews = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      approval({ id: `a${i}`, reviewer: { id: `r${i}`, username: `r${i}` } }),
    );

  it("shows two rows of stamps in full rather than a +1 bubble", async () => {
    serve(reviews(14));
    render(<Panel />);

    expect(await stampNames()).toHaveLength(14);
    expect(screen.queryByRole("button", { name: /more approvals/ })).toBeNull();
  });

  it("shows every stamp from the overflow bubble", async () => {
    serve(reviews(15));
    render(<Panel />);

    fireEvent.click(await screen.findByRole("button", { name: "Show 2 more approvals" }));
    expect(await stampNames()).toHaveLength(15);
  });

  it("stamps a closed event's approvals that stood when it closed", async () => {
    const closedEvent = { ...event, status: "closed" as const, before_closed_status: "geolocated" as const };
    serve([approval({ current: false, note: "Skyline matches" })]);
    render(<Panel geo={closedEvent} />);

    expect(await stampNames()).toEqual(["bo"]);
    expect(screen.queryByText("No approvals yet")).toBeNull();
  });

  it("puts Revoke in place of Approve once the reader's approval stands, and confirms it", async () => {
    api.viewer = BO;
    serve([approval(), approval({ id: "a2", reviewer: CY })]);
    render(<Panel />);

    const revoke = await screen.findByRole("button", { name: "Revoke" });
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(revoke);
    expect(api.apiFetch).not.toHaveBeenCalledWith("/events/e1/approvals/a1/revoke", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Confirm revoke" }));
    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/approvals/a1/revoke", {
        method: "POST",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Approval revoked.");
  });

  it("offers no Revoke for someone else's approval", async () => {
    api.viewer = CY;
    serve([approval()]);
    render(<Panel />);

    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  });
  it("lets an org manager approve as each organization they manage", async () => {
    api.viewer = CY;
    const OSINT = { slug: "osint-lab", name: "OSINT Lab", avatar_url: null };
    serve([], {
      "/users/cy/organizations": [
        { organization: BELLINGCAT, role: "manager", joined_at: "2026-10-01T00:00:00Z" },
        { organization: OSINT, role: "member", joined_at: "2026-10-01T00:00:00Z" },
      ],
    });
    render(<Panel />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve as Bellingcat" }));
    expect(screen.queryByRole("button", { name: "Approve as OSINT Lab" })).toBeNull();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/approvals", {
        method: "POST",
        body: JSON.stringify({ version_no: 2, organization: "bellingcat" }),
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Approved version 2.");
  });

  it("gives an org manager no revoke control for their organization's approval", async () => {
    api.viewer = CY;
    serve([approval({ organization: BELLINGCAT }), approval({ id: "a2", reviewer: ANA })], {
      "/users/cy/organizations": [
        { organization: BELLINGCAT, role: "manager", joined_at: "2026-10-01T00:00:00Z" },
      ],
    });
    render(<Panel />);

    expect(await stampNames()).toEqual(["Bellingcat", "ana"]);
    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve as Bellingcat" })).toBeNull();
  });
  it("holds the approval requests of a published event", async () => {
    api.viewer = ANA;
    serve([]);
    render(<Panel />);

    expect(await screen.findByRole("heading", { name: "Approval requests" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request approval" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("names who asked the reader for approval, with Decline beside Approve", async () => {
    api.viewer = BO;
    serve([], {
      "/events/e1/approval-requests": [
        {
          id: "r1",
          event_id: "e1",
          version_no: 2,
          requester: ANA,
          target: BO,
          target_organization: null,
          status: "open",
          created_at: "2026-10-15T09:00:00Z",
          resolved_at: null,
        },
      ],
    });
    render(<Panel />);

    expect(await screen.findByText(/asked for your approval/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ana" })).toHaveAttribute("href", "/profile/ana");
    const decline = screen.getByRole("button", { name: "Decline" });
    expect(decline.closest("div")).toBe(screen.getByRole("button", { name: "Approve" }).parentElement);
    expect(screen.queryByRole("heading", { name: "Approval requests" })).toBeNull();
  });
});

describe("<VersionApprovals>", () => {
  it("shows a revoked approval with its public reason on a filed version", async () => {
    api.apiFetch.mockResolvedValue({
      viewer_can_approve: false,
      items: [
      approval({
        version_no: 1,
        current: false,
        revoked_at: "2026-10-16T09:00:00Z",
        revoke_reason: "Sockpuppet account",
        revoked_as: "site_admin",
      }),
      ],
    });
    render(<VersionApprovals event={event} versionNo={1} />);

    expect(await screen.findByText("Revoked")).toBeInTheDocument();
    expect(screen.getByText(/Revoked by a site admin on .*: Sockpuppet account/)).toBeInTheDocument();
    expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/approvals?version_no=1", expect.anything());
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
  });

  it("lists a filed version's approvals read-only, with no note", async () => {
    api.viewer = BO;
    api.apiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/events/e1/approvals?version_no=1"
          ? {
              viewer_can_approve: false,
              items: [
                approval({ version_no: 1, current: false, note: "Roof vents" }),
                approval({ id: "a2", version_no: 1, current: false, reviewer: CY }),
              ],
            }
          : [],
      ),
    );
    render(<VersionApprovals event={event} versionNo={1} />);

    expect(await screen.findAllByText("Outdated")).toHaveLength(2);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Roof vents")).toBeNull();
  });
  it("shows a revoked approval without a reason as a dated line", async () => {
    api.apiFetch.mockResolvedValue({
      viewer_can_approve: false,
      items: [approval({ version_no: 1, current: false, revoked_at: "2026-10-16T09:00:00Z", revoked_as: "site_admin" })],
    });
    render(<VersionApprovals event={event} versionNo={1} />);

    expect(await screen.findByText(/^Revoked by a site admin on .*\.$/)).toBeInTheDocument();
  });

  it("stays hidden when the version held no approval", async () => {
    api.apiFetch.mockResolvedValue({ items: [], viewer_can_approve: false });
    const { container } = render(<VersionApprovals event={event} versionNo={1} />);
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
