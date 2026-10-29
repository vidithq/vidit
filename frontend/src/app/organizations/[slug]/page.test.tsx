import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Organization, OrganizationMember } from "@/lib/organizations";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "osw" }),
  usePathname: () => "/organizations/osw",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const useAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuth() }));

const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

const apiFetch = vi.fn();
const apiFetchPage = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  apiFetchPage: (...args: unknown[]) => apiFetchPage(...args),
}));

import OrganizationPage from "./page";

const ORG: Organization = {
  id: "o1",
  slug: "osw",
  name: "Open Source Watch",
  x_handle: "osw",
  bio: "We geolocate.",
  avatar_url: null,
  external_links: { website: "https://example.org" },
  created_at: "2026-01-01T00:00:00Z",
  member_count: 2,
  approval_request_audience: "following",
  viewer_role: null,
  viewer_invited: false,
  viewer_can_manage: false,
};

const MEMBERS: OrganizationMember[] = [
  {
    user: { id: "u1", username: "lead", avatar_url: null },
    role: "manager",
    joined_at: "2026-01-01T00:00:00Z",
  },
  {
    user: { id: "u2", username: "ana", avatar_url: null },
    role: "member",
    joined_at: "2026-02-01T00:00:00Z",
  },
];

const APPROVAL = {
  event: { id: "e1", title: "Bridge strike" },
  approval: {
    id: "a1",
    version_no: 2,
    reviewer: { id: "u1", username: "lead", avatar_url: null },
    organization: { slug: "osw", name: "Open Source Watch", avatar_url: null },
    note: "Skyline matches",
    created_at: "2026-10-15T09:00:00Z",
    current: true,
  },
};

const OPEN_REQUEST = {
  event: { id: "e2", title: "Port fire" },
  request: {
    id: "r1",
    event_id: "e2",
    version_no: 1,
    requester: { id: "u3", username: "cy", avatar_url: null },
    target: null,
    target_organization: { slug: "osw", name: "Open Source Watch", avatar_url: null },
    status: "open" as const,
    created_at: "2026-10-15T09:00:00Z",
    resolved_at: null,
  },
};

const INVITE = {
  user: { id: "u4", username: "dee", avatar_url: null },
  invited_by: { id: "u1", username: "lead", avatar_url: null },
  invited_at: "2026-10-15T09:00:00Z",
};

function serve(org: Organization, members: OrganizationMember[] = MEMBERS) {
  const refetch = vi.fn();
  useApiResource.mockImplementation((path: string | null) => {
    if (path === "/organizations/osw") return { data: org, error: null, loading: false, refetch };
    if (path === "/organizations/osw/members") {
      return { data: members, error: null, loading: false, refetch };
    }
    if (path === "/organizations/osw/approval-requests") {
      return { data: [OPEN_REQUEST], error: null, loading: false, refetch };
    }
    if (path === "/organizations/osw/invites") {
      return { data: [INVITE], error: null, loading: false, refetch };
    }
    return { data: [], error: null, loading: false, refetch };
  });
  apiFetchPage.mockImplementation((path: string) =>
    Promise.resolve({
      items: path === "/organizations/osw/approvals" ? [APPROVAL] : [],
      nextCursor: null,
    }),
  );
  return refetch;
}

function signIn(username: string | null) {
  useAuth.mockReturnValue({
    user: username ? { id: "x", username } : null,
    loading: false,
    refresh: vi.fn(),
  });
}

describe("OrganizationPage", () => {
  beforeEach(() => {
    apiFetch.mockReset().mockResolvedValue(undefined);
    useApiResource.mockClear();
  });

  it("shows a visitor the profile and the members, with no controls", () => {
    signIn(null);
    serve(ORG);
    render(<OrganizationPage />);

    expect(screen.getByRole("heading", { name: "Open Source Watch" })).toBeInTheDocument();
    expect(screen.getByText("2 members")).toBeInTheDocument();
    const lead = screen.getByRole("link", { name: /^lead/ });
    expect(lead).toHaveAttribute("href", "/profile/lead");
    expect(within(lead).getByText("Org manager")).toBeInTheDocument();
    expect(within(lead).getByText(/^Joined/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove|Leave|Make/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit profile" })).toBeNull();
    expect(screen.queryByText("Invites")).toBeNull();
    expect(screen.queryByText("Approval requests")).toBeNull();
  });

  it("lists the approvals placed in the organization's name", async () => {
    signIn(null);
    serve(ORG);
    render(<OrganizationPage />);

    expect(await screen.findByRole("link", { name: "Bridge strike" })).toHaveAttribute(
      "href",
      "/events/e1",
    );
    const row = within(screen.getByRole("heading", { name: "Bridge strike" }).closest("li")!);
    expect(row.getByRole("link", { name: "lead" })).toHaveAttribute("href", "/profile/lead");
    expect(row.getByText("v2")).toBeInTheDocument();
    expect(row.getByText("15 Oct 2026")).toBeInTheDocument();
    expect(row.getByText("Current")).toBeInTheDocument();
    expect(screen.queryByText("Skyline matches")).toBeNull();
  });

  it("lets an invited analyst accept from the header's actions", async () => {
    signIn("bo");
    const refetch = serve({ ...ORG, viewer_invited: true });
    render(<OrganizationPage />);

    expect(screen.getByText(/You are invited to join/)).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Invitation" })).toBeNull();
    const accept = screen.getByRole("button", { name: "Accept" });
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    // In the title's action cluster, before the page's first section.
    expect(
      accept.compareDocumentPosition(screen.getByText(/You are invited to join/)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(accept);
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/organizations/osw/invite/accept", {
        method: "POST",
      }),
    );
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it("gives a member Leave on their own row only", () => {
    signIn("ana");
    serve({ ...ORG, viewer_role: "member" });
    render(<OrganizationPage />);

    expect(screen.getAllByRole("button", { name: "Leave" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });

  it("gives an org manager the role controls, the invites and the edit", () => {
    signIn("lead");
    serve({ ...ORG, viewer_role: "manager", viewer_can_manage: true });
    render(<OrganizationPage />);

    const makeManager = screen.getByRole("button", { name: "Make org manager" });
    expect(makeManager.closest("a")).toBeNull();
    expect(screen.getByRole("button", { name: /^Remove / }).closest("a")).toBeNull();
    expect(screen.getByText("Invites")).toBeInTheDocument();
    fireEvent.focus(screen.getByLabelText("Analyst"));
    expect(screen.getByText("No mutual follow to invite.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit profile" })).toBeInTheDocument();
  });

  it("lists pending invites as rows to the invitee's profile, Withdraw outside the link", async () => {
    signIn("lead");
    serve({ ...ORG, viewer_role: "manager", viewer_can_manage: true });
    render(<OrganizationPage />);

    const invite = screen.getByRole("link", { name: /^dee/ });
    expect(invite).toHaveAttribute("href", "/profile/dee");
    expect(within(invite).getByText(/^Invited .* by lead$/)).toBeInTheDocument();
    const withdraw = screen.getByRole("button", { name: "Withdraw" });
    expect(withdraw.closest("a")).toBeNull();
    fireEvent.click(withdraw);
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/organizations/osw/invites/dee", { method: "DELETE" }),
    );
  });

  it("offers the last org manager neither leave nor demotion, and says why", () => {
    signIn("lead");
    serve({ ...ORG, viewer_role: "manager", viewer_can_manage: true });
    render(<OrganizationPage />);

    expect(screen.queryByRole("button", { name: "Make member" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Leave" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Why can the last org manager not leave?" }),
    ).toBeInTheDocument();
  });

  it("lets one of two org managers leave or be demoted", () => {
    signIn("lead");
    const second = { ...MEMBERS[1], role: "manager" as const };
    serve({ ...ORG, viewer_role: "manager", viewer_can_manage: true }, [MEMBERS[0], second]);
    render(<OrganizationPage />);

    expect(screen.getAllByRole("button", { name: "Make member" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Why can the last org manager not leave?" })).toBeNull();
  });

  it("saves the organization's profile without refreshing the reader's own account", async () => {
    const refreshAuth = vi.fn();
    useAuth.mockReturnValue({ user: { id: "x", username: "lead" }, loading: false, refresh: refreshAuth });
    const refetch = serve({ ...ORG, viewer_role: "manager", viewer_can_manage: true });
    render(<OrganizationPage />);

    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(refreshAuth).not.toHaveBeenCalled();
  });

  it("gives an org manager the open approval requests and the audience control", async () => {
    signIn("lead");
    const refetch = serve({ ...ORG, viewer_role: "manager", viewer_can_manage: true });
    render(<OrganizationPage />);

    expect(screen.getByText("Approval requests")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Port fire" })).toHaveAttribute("href", "/events/e2");
    const request = within(screen.getByRole("heading", { name: "Port fire" }).closest("li")!);
    expect(request.getByRole("link", { name: "cy" })).toBeInTheDocument();
    expect(request.getByText("v1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" }).closest("a")).toBeNull();
    expect(screen.getByRole("button", { name: "People our org managers follow" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Everyone" }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/organizations/osw", {
        method: "PATCH",
        body: JSON.stringify({ approval_request_audience: "everyone" }),
      }),
    );
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it("gives a member the open approval requests with Decline, without the audience control", () => {
    signIn("ana");
    serve({ ...ORG, viewer_role: "member" });
    render(<OrganizationPage />);

    expect(screen.getByRole("link", { name: "Port fire" })).toHaveAttribute("href", "/events/e2");
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Everyone" })).toBeNull();
  });

  it("shows a site admin who is not a member no role controls, requests or invites", () => {
    signIn("mod");
    serve(ORG);
    render(<OrganizationPage />);

    expect(screen.getByRole("link", { name: /^lead/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove|Leave|Make/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit profile" })).toBeNull();
    expect(screen.queryByText("Approval requests")).toBeNull();
    expect(screen.queryByText("Invites")).toBeNull();
    expect(useApiResource).not.toHaveBeenCalledWith("/organizations/osw/approval-requests");
    expect(useApiResource).not.toHaveBeenCalledWith("/organizations/osw/invites");
  });
});
