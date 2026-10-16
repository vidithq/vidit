import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApiResource } from "@/hooks/useApiResource";
import { allApprovalsPath, type Approval, type ApprovalList } from "@/lib/approvals";
import type { EventDetail } from "@/types";
import { eventDetail, filedVersion } from "@/test/eventDetail";

const api = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  viewer: null as { id: string; username: string } | null,
  isAdmin: false,
  // What the server says of the viewer; null derives it from the viewer and the credit.
  mayApprove: null as boolean | null,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  errorMessage: (_err: unknown, fallback: string) => fallback,
  ApiError: class extends Error {},
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: api.viewer }),
}));
vi.mock("@/hooks/useAdmin", () => ({
  useAdmin: () => ({ isAdmin: api.isAdmin, loading: false }),
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

/** Opens a stamp's card by its signer's name and returns it. */
async function openStamp(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: `Approved by ${name}` }));
  return screen.getByRole("dialog", { name });
}

/** Expands the approve form from the card's compact **Approve**. */
async function openApproveForm() {
  fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
}

/** How many times the card read the approval list. */
const listReads = () => api.apiFetch.mock.calls.filter(([path]) => path === ALL).length;

beforeEach(() => {
  api.apiFetch.mockReset();
  api.viewer = null;
  api.isAdmin = false;
  api.mayApprove = null;
});

describe("<ApprovalStamps>", () => {
  it("renders nothing for an empty list", () => {
    const { container } = render(<ApprovalStamps approvals={[]} onOverflow={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("labels the row and names each current approval, oldest first, organizations as squares", () => {
    render(
      <ApprovalStamps
        approvals={[approval(), approval({ id: "a2", reviewer: CY, organization: BELLINGCAT })]}
        onOverflow={vi.fn()}
      />,
    );
    const stamps = within(screen.getByRole("list", { name: "Approved by" })).getAllByRole("button");
    expect(stamps.map((s) => s.getAttribute("aria-label"))).toEqual([
      "Approved by bo",
      "Approved by Bellingcat",
    ]);
    expect(stamps[0].className).toContain("rounded-full");
    expect(stamps[1].className).toContain("rounded-md");
  });

  it("opens a card with the version, date, note and profile link on a click", () => {
    render(
      <ApprovalStamps approvals={[approval({ note: "Skyline matches the ridge" })]} onOverflow={vi.fn()} />,
    );
    const stamp = screen.getByRole("button", { name: "Approved by bo" });
    fireEvent.click(stamp);

    const card = screen.getByRole("dialog", { name: "bo" });
    expect(stamp).toHaveAttribute("aria-expanded", "true");
    expect(within(card).getByText("bo")).toBeInTheDocument();
    expect(within(card).getByText(/^Version 2 · /)).toBeInTheDocument();
    expect(within(card).getByText("Skyline matches the ridge")).toBeInTheDocument();
    const link = within(card).getByRole("link", { name: "View profile" });
    expect(link).toHaveAttribute("href", "/profile/bo");
    expect(link).toHaveFocus();
  });

  it("names the acting org manager and links to the organization", () => {
    render(
      <ApprovalStamps
        approvals={[approval({ organization: BELLINGCAT })]}
        onOverflow={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approved by Bellingcat" }));
    const card = screen.getByRole("dialog", { name: "Bellingcat" });
    expect(within(card).getByText("bo on behalf of Bellingcat")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "View organization" })).toHaveAttribute(
      "href",
      "/organizations/bellingcat",
    );
  });

  it("stamps an organization approval whose acting org manager was erased", () => {
    render(
      <ApprovalStamps
        approvals={[approval({ organization: BELLINGCAT, reviewer: null })]}
        onOverflow={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approved by Bellingcat" }));
    expect(screen.getByText("on behalf of Bellingcat")).toBeInTheDocument();
  });

  it("opens the card on keyboard focus and closes it on Escape", () => {
    render(<ApprovalStamps approvals={[approval()]} onOverflow={vi.fn()} />);
    const stamp = screen.getByRole("button", { name: "Approved by bo" });
    fireEvent.focus(stamp);
    expect(screen.getByRole("dialog", { name: "bo" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the card on a tap, where no hover comes first", () => {
    render(<ApprovalStamps approvals={[approval()]} onOverflow={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Approved by bo" }));
    expect(screen.getByRole("dialog", { name: "bo" })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows five and folds the rest into a bubble", () => {
    const onOverflow = vi.fn();
    const rows = Array.from({ length: 7 }, (_, i) =>
      approval({ id: `a${i}`, reviewer: { id: `r${i}`, username: `r${i}` } }),
    );
    render(<ApprovalStamps approvals={rows} onOverflow={onOverflow} />);
    expect(screen.getAllByRole("button", { name: /^Approved by/ })).toHaveLength(5);
    const more = screen.getByRole("button", { name: "Show 2 more approvals" });
    expect(more).toHaveTextContent("+2");
    fireEvent.click(more);
    expect(onOverflow).toHaveBeenCalledOnce();
  });
});

describe("<ApprovalsCard>", () => {
  it("says the live version stands approved, with the count and the version", async () => {
    serve([approval(), approval({ id: "a2", reviewer: CY })]);
    render(<Panel />);

    expect(await screen.findByText("Approved · 2 · version 2")).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Approved by" })).getAllByRole("button"),
    ).toHaveLength(2);
  });

  it("says when no approval stands yet", async () => {
    serve([approval({ id: "v1", version_no: 1, current: false })]);
    render(<Panel />);

    expect(await screen.findByText("Not approved yet")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Approved by" })).toBeNull();
  });

  it("quotes the latest note among the current approvals, with its author", async () => {
    serve([
      approval({ note: "Skyline matches", created_at: "2026-10-15T09:00:00Z" }),
      approval({ id: "a2", reviewer: CY, note: "Roof vents too", created_at: "2026-10-16T09:00:00Z" }),
    ]);
    render(<Panel />);

    const quote = (await screen.findByText("Roof vents too")).closest("figure")!;
    expect(within(quote).getByRole("link", { name: "cy" })).toHaveAttribute("href", "/profile/cy");
    expect(screen.queryByText("Skyline matches")).toBeNull();
  });

  it("lets an analyst outside the geolocators approve the version on screen", async () => {
    api.viewer = CY;
    serve([]);
    render(<Panel />);

    expect(await screen.findByText("Not approved yet")).toBeInTheDocument();
    expect(screen.queryByLabelText("Note (optional)")).toBeNull();
    await openApproveForm();
    expect(screen.getByLabelText("Note (optional)")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Note (optional)"), {
      target: { value: "Skyline matches" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve version 2" }));
    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/approvals", {
        method: "POST",
        body: JSON.stringify({ version_no: 2, note: "Skyline matches" }),
      }),
    );
    await waitFor(() => expect(listReads()).toBe(2));
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
    await openApproveForm();

    fireEvent.click(screen.getByRole("button", { name: "Approve version 2" }));
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.getByRole("button", { name: "Approve version 2" })).toBeDisabled();
  });

  it("keeps the approve form collapsed until asked, and Cancel collapses it again", async () => {
    api.viewer = CY;
    serve([]);
    render(<Panel />);

    await openApproveForm();
    expect(screen.getByRole("button", { name: "Approve version 2" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Note (optional)")).toBeNull();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
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

    expect(await screen.findByText("Not approved yet")).toBeInTheDocument();
    expect(screen.queryByText(/You approved/)).toBeNull();
  });

  it("offers no approval to an analyst the server refuses, such as a former geolocator", async () => {
    api.viewer = CY;
    api.mayApprove = false;
    serve([approval()]);
    render(<Panel />);

    expect(await screen.findByText("Approved · 1 · version 2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Approve\b/ })).toBeNull();
    expect(screen.queryByLabelText("Note (optional)")).toBeNull();
  });

  it("stamps an organization approval whose acting org manager was erased", async () => {
    serve([approval({ organization: BELLINGCAT, reviewer: null })]);
    render(<Panel />);

    const card = await openStamp("Bellingcat");
    expect(within(card).getByText("on behalf of Bellingcat")).toBeInTheDocument();
  });

  it("offers a geolocator no approval", async () => {
    api.viewer = ANA;
    serve([approval()]);
    render(<Panel />);

    expect(await screen.findByText("Approved · 1 · version 2")).toBeInTheDocument();
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

    expect(await screen.findByText("Approved · 1 · version 2")).toBeInTheDocument();
    const stamps = within(screen.getByRole("list", { name: "Approved by" })).getAllByRole("button");
    expect(stamps.map((b) => b.getAttribute("aria-label"))).toEqual(["Approved by bo"]);
    expect(screen.queryByText("Roof vents")).toBeNull();
    expect(screen.queryByText(/Wrong bridge/)).toBeNull();
    expect(screen.queryByText(/outdated|revoked/i)).toBeNull();
  });

  it("shows every stamp from the overflow bubble", async () => {
    serve(Array.from({ length: 7 }, (_, i) => approval({ id: `a${i}`, reviewer: { id: `r${i}`, username: `r${i}` } })));
    render(<Panel />);

    fireEvent.click(await screen.findByRole("button", { name: "Show 2 more approvals" }));
    expect(screen.getAllByRole("button", { name: /^Approved by/ })).toHaveLength(7);
  });

  it("stamps a closed event's approvals that stood when it closed", async () => {
    const closedEvent = { ...event, status: "closed" as const, before_closed_status: "geolocated" as const };
    serve([approval({ current: false, note: "Skyline matches" })]);
    render(<Panel geo={closedEvent} />);

    expect(await screen.findByText("Closed · 1 stood at closing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approved by bo" })).toBeInTheDocument();
  });

  it("lets the reviewer revoke from their stamp's card, and no one else's", async () => {
    api.viewer = BO;
    serve([approval(), approval({ id: "a2", reviewer: CY })]);
    render(<Panel />);

    const other = await openStamp("cy");
    expect(within(other).queryByRole("button", { name: "Revoke" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });

    const own = await openStamp("bo");
    fireEvent.click(within(own).getByRole("button", { name: "Revoke" }));
    const confirm = screen.getByRole("button", { name: "Revoke approval" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/shown publicly on the approval/), {
      target: { value: "Wrong bridge" },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/approvals/a1/revoke", {
        method: "POST",
        body: JSON.stringify({ reason: "Wrong bridge" }),
      }),
    );
  });

  it("gives a site admin revoke on every standing approval", async () => {
    api.viewer = { id: "u9", username: "mod" };
    api.isAdmin = true;
    serve([approval(), approval({ id: "a2", reviewer: CY })]);
    render(<Panel />);

    expect(within(await openStamp("bo")).getByRole("button", { name: "Revoke" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(await openStamp("cy")).getByRole("button", { name: "Revoke" })).toBeInTheDocument();
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
    await openApproveForm();

    fireEvent.click(await screen.findByRole("button", { name: "Approve as Bellingcat" }));
    expect(screen.queryByRole("button", { name: "Approve as OSINT Lab" })).toBeNull();
    expect(screen.getByRole("button", { name: "Approve version 2" })).toBeInTheDocument();
    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/approvals", {
        method: "POST",
        body: JSON.stringify({ version_no: 2, note: null, organization: "bellingcat" }),
      }),
    );
  });

  it("gives an org manager revoke on their organization's approval, not on others'", async () => {
    api.viewer = CY;
    serve([approval({ organization: BELLINGCAT }), approval({ id: "a2", reviewer: ANA })], {
      "/users/cy/organizations": [
        { organization: BELLINGCAT, role: "manager", joined_at: "2026-10-01T00:00:00Z" },
      ],
    });
    render(<Panel />);

    const org = await openStamp("Bellingcat");
    expect(within(org).getByRole("link", { name: "View organization" })).toHaveAttribute(
      "href",
      "/organizations/bellingcat",
    );
    expect(await within(org).findByRole("button", { name: "Revoke" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(await openStamp("ana")).queryByRole("button", { name: "Revoke" })).toBeNull();
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

  it("lists an outdated approval and gives its reviewer revoke on a filed version", async () => {
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

    expect(await screen.findAllByText("Outdated")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(screen.getByRole("button", { name: "Revoke approval" })).toBeDisabled();
  });

  it("stays hidden when the version held no approval", async () => {
    api.apiFetch.mockResolvedValue({ items: [], viewer_can_approve: false });
    const { container } = render(<VersionApprovals event={event} versionNo={1} />);
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
