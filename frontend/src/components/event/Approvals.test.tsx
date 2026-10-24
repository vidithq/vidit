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
import { useEventApprovals } from "./EventApprovals";

const ANA = { id: "u1", username: "ana" };
const BO = { id: "u2", username: "bo" };
const CY = { id: "u3", username: "cy" };
const BELLINGCAT = { slug: "bellingcat", name: "Bellingcat", avatar_url: null };
const ALL = "/events/e1/approvals?all_versions=true";

const event = { ...eventDetail("e1", "Bridge strike"), version_no: 2, geolocators: [ANA] };

const approval = (over: Partial<Approval> = {}): Approval => ({
  id: "a1",
  version_no: 2,
  reviewer: BO,
  created_at: "2026-10-15T09:00:00Z",
  current: true,
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
  const { summary, requests } = useEventApprovals(geo, approvals);
  return (
    <>
      {summary}
      {requests}
    </>
  );
}

/** The stamps under the actions, as who signed each: the link name before *approved vN on*. */
const stampNames = async () =>
  within(await screen.findByRole("list", { name: "Approved by" }))
    .getAllByRole("link")
    .map((l) => l.getAttribute("aria-label")?.split(" approved ")[0]);

/** Confirm the approval the dialog asks about. */
const confirmApproval = () =>
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve" }));

/** How many times the card read the approval list. */
const listReads = () => api.apiFetch.mock.calls.filter(([path]) => path === ALL).length;

beforeEach(() => {
  api.apiFetch.mockReset();
  api.viewer = null;
  api.mayApprove = null;
});

describe("<ApprovalStamps>", () => {
  it("renders nothing for an empty list", () => {
    const { container } = render(<ApprovalStamps approvals={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links each current approval to its signer's page, oldest first, organizations as squares", () => {
    render(
      <ApprovalStamps
        approvals={[approval(), approval({ id: "a2", reviewer: CY, organization: BELLINGCAT })]}
       
      />,
    );
    const stamps = within(screen.getByRole("list", { name: "Approved by" })).getAllByRole("link");
    expect(stamps.map((s) => [s.getAttribute("aria-label"), s.getAttribute("href")])).toEqual([
      ["bo approved v2 on 15 Oct 2026", "/profile/bo"],
      ["Bellingcat (cy) approved v2 on 15 Oct 2026", "/organizations/bellingcat"],
    ]);
    expect(stamps[0].className).toContain("rounded-full");
    expect(stamps[1].className).toContain("rounded-md");
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("opens no card on a click", () => {
    render(<ApprovalStamps approvals={[approval()]} />);
    fireEvent.click(screen.getByRole("link", { name: /^bo approved/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("stamps an organization approval whose acting org manager was erased", () => {
    render(
      <ApprovalStamps
        approvals={[approval({ organization: BELLINGCAT, reviewer: null })]}
       
      />,
    );
    expect(
      screen.getByRole("link", { name: "Bellingcat approved v2 on 15 Oct 2026" }),
    ).toHaveAttribute(
      "href",
      "/organizations/bellingcat",
    );
  });
  it("shows every stamp with a check badge and no count", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      approval({ id: `a${i}`, reviewer: { id: `r${i}`, username: `r${i}` } }),
    );
    const { container } = render(<ApprovalStamps approvals={rows} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(20);
    expect(links.every((l) => l.querySelector("svg.lucide-check"))).toBe(true);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container).not.toHaveTextContent(/\d/);
  });
});

describe("useEventApprovals", () => {
  it("stamps the live version's standing approvals with no label, count or card", async () => {
    serve([approval(), approval({ id: "a2", reviewer: CY })]);
    render(<Panel />);

    expect(await stampNames()).toEqual(["bo", "cy"]);
    const summary = screen.getByRole("region", { name: "Approvals" });
    expect(summary).not.toHaveTextContent(/Approved by|approvals|\d/i);
    expect(summary.className).not.toMatch(/border|bg-/);
    expect(
      within(summary).getByRole("button", { name: "What is an approval?" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Skyline matches")).toBeNull();
  });
  it("shows nothing while no approval stands and the reader cannot approve", async () => {
    serve([approval({ id: "v1", version_no: 1, current: false })]);
    render(<Panel />);

    await waitFor(() => expect(listReads()).toBe(1));
    expect(screen.queryByRole("region", { name: "Approvals" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Approved by" })).toBeNull();
  });

  it("approves the version on screen after a confirmation step, with no banner after", async () => {
    api.viewer = CY;
    serve([]);
    render(<Panel />);

    const approve = await screen.findByRole("button", { name: "Approve" });
    expect(screen.queryByRole("list", { name: "Approved by" })).toBeNull();
    // The help sits beside Approve while no stamp shows.
    expect(approve.parentElement).toContainElement(
      screen.getByRole("button", { name: "What is an approval?" }),
    );
    fireEvent.click(approve);
    // Nothing is sent before the reader confirms: an approval is final.
    const dialog = screen.getByRole("dialog", { name: "Approve this version?" });
    expect(dialog).toHaveTextContent("You approve version 2 of this geolocation.");
    expect(dialog).toHaveTextContent("An approval is final.");
    expect(api.apiFetch).not.toHaveBeenCalledWith("/events/e1/approvals", expect.anything());
    expect(screen.queryByRole("textbox")).toBeNull();

    confirmApproval();
    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/approvals", {
        method: "POST",
        body: JSON.stringify({ version_no: 2 }),
      }),
    );
    await waitFor(() => expect(listReads()).toBe(2));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("sends nothing when the reader cancels the confirmation", async () => {
    api.viewer = CY;
    serve([]);
    render(<Panel />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      api.apiFetch.mock.calls.some(([, init]) => (init as { method?: string })?.method === "POST"),
    ).toBe(false);
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
    confirmApproval();

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
    confirmApproval();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
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
    confirmApproval();
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

    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
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

  // Outdated approvals are read on each version's page.
  it("shows only the live version's approvals", async () => {
    serve([approval({ id: "v1", version_no: 1, current: false, reviewer: CY }), approval()]);
    render(<Panel />);

    expect(await stampNames()).toEqual(["bo"]);
    expect(screen.queryByText(/outdated/i)).toBeNull();
  });

  const reviews = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      approval({ id: `a${i}`, reviewer: { id: `r${i}`, username: `r${i}` } }),
    );

  it("shows every stamp, with no bubble and no count", async () => {
    serve(reviews(20));
    render(<Panel />);

    expect(await stampNames()).toHaveLength(20);
    expect(screen.queryByRole("button", { name: /more approvals/ })).toBeNull();
    expect(screen.getByRole("region", { name: "Approvals" })).not.toHaveTextContent(/\d/);
  });

  it("stamps a closed event's approvals that stood when it closed", async () => {
    const closedEvent = { ...event, status: "closed" as const, before_closed_status: "geolocated" as const };
    serve([approval({ current: false })]);
    render(<Panel geo={closedEvent} />);

    expect(await stampNames()).toEqual(["bo"]);
  });

  it("lets a member approve as each organization they belong to, whatever their role", async () => {
    api.viewer = CY;
    const OSINT = { slug: "osint-lab", name: "OSINT Lab", avatar_url: null };
    serve([], {
      "/users/cy/organizations": [
        { organization: BELLINGCAT, role: "member", joined_at: "2026-10-01T00:00:00Z" },
        { organization: OSINT, role: "manager", joined_at: "2026-10-01T00:00:00Z" },
      ],
    });
    render(<Panel />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve as Bellingcat" }));
    expect(screen.getByRole("dialog", { name: "Approve as Bellingcat?" })).toHaveTextContent(
      "in the name of Bellingcat",
    );
    confirmApproval();
    expect(screen.getByRole("button", { name: "Approve as OSINT Lab" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/approvals", {
        method: "POST",
        body: JSON.stringify({ version_no: 2, organization: "bellingcat" }),
      }),
    );
  });

  it("closes Approve as the organization once it approved the version", async () => {
    api.viewer = CY;
    serve([approval({ organization: BELLINGCAT }), approval({ id: "a2", reviewer: ANA })], {
      "/users/cy/organizations": [
        { organization: BELLINGCAT, role: "member", joined_at: "2026-10-01T00:00:00Z" },
      ],
    });
    render(<Panel />);

    expect(await stampNames()).toEqual(["Bellingcat (bo)", "ana"]);
    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve as Bellingcat" })).toBeNull();
  });

  it("holds a geolocator's approval requests in a section of their own", async () => {
    api.viewer = ANA;
    serve([]);
    render(<Panel />);

    const section = await screen.findByRole("region", { name: "Approval requests" });
    expect(within(section).getByRole("heading", { name: "Approval requests" })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Request approval" })).toBeInTheDocument();
    // No stamp and no Approve for a geolocator: nothing shows under the actions.
    expect(screen.queryByRole("region", { name: "Approvals" })).toBeNull();
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
  it("stamps a filed version's approvals read-only", async () => {
    api.viewer = BO;
    api.apiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/events/e1/approvals?version_no=1"
          ? {
              viewer_can_approve: false,
              items: [
                approval({ version_no: 1, current: false }),
                approval({ id: "a2", version_no: 1, current: false, reviewer: CY }),
              ],
            }
          : [],
      ),
    );
    render(<VersionApprovals event={event} versionNo={1} />);

    expect(await stampNames()).toEqual(["bo", "cy"]);
    expect(screen.getByRole("link", { name: "cy approved v1 on 15 Oct 2026" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete approval|Approve/ })).toBeNull();
    expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/approvals?version_no=1", expect.anything());
  });
  it("stays hidden when the version held no approval", async () => {
    api.apiFetch.mockResolvedValue({ items: [], viewer_can_approve: false });
    const { container } = render(<VersionApprovals event={event} versionNo={1} />);
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
