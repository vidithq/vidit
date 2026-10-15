import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Approval } from "@/lib/approvals";
import { eventDetail, filedVersion } from "@/test/eventDetail";

const api = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  viewer: null as { id: string; username: string } | null,
  isAdmin: false,
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

import { ApprovalsSection } from "./ApprovalsSection";

const ANA = { id: "u1", username: "ana" };
const BO = { id: "u2", username: "bo" };
const CY = { id: "u3", username: "cy" };

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

function serve(rows: Approval[]) {
  api.apiFetch.mockImplementation((path: string, init?: { method?: string }) =>
    Promise.resolve(init?.method === "POST" ? approval() : rows),
  );
}

describe("<ApprovalsSection>", () => {
  beforeEach(() => {
    api.apiFetch.mockReset();
    api.viewer = null;
    api.isAdmin = false;
  });

  it("lets an analyst outside the geolocators approve the version on screen", async () => {
    api.viewer = CY;
    serve([]);
    render(<ApprovalsSection event={event} versionNo={2} live />);

    expect(await screen.findByText("No approvals of this version yet.")).toBeInTheDocument();
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
  });

  it("tells a reviewer of an earlier version what changed since", async () => {
    api.viewer = CY;
    api.apiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/events/e1/approvals?reviewer=cy"
          ? [approval({ id: "a0", version_no: 1, current: false, reviewer: CY })]
          : path === "/events/e1/versions/1"
            ? filedVersion(event, 1, { title: "Bridge strike, first read" })
            : [],
      ),
    );
    render(<ApprovalsSection event={event} versionNo={2} live />);

    expect(
      await screen.findByText(/Changed since version 1, which you approved: Title\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See version 1" })).toHaveAttribute(
      "href",
      "/events/e1/v1",
    );
    expect(screen.getByRole("button", { name: "Approve version 2" })).toBeInTheDocument();
  });

  it("offers a geolocator no approval and stays hidden with nothing to show", async () => {
    api.viewer = ANA;
    serve([]);
    const { container } = render(<ApprovalsSection event={event} versionNo={2} live />);

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/approvals?version_no=2", expect.anything()),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lets the reviewer revoke with a reason and no one else", async () => {
    api.viewer = BO;
    serve([approval(), approval({ id: "a2", reviewer: CY })]);
    render(<ApprovalsSection event={event} versionNo={2} live />);

    const revoke = await screen.findAllByRole("button", { name: "Revoke" });
    expect(revoke).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Approve version 2" })).toBeNull();
    fireEvent.click(revoke[0]);

    const confirm = screen.getByRole("button", { name: "Revoke approval" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason, shown publicly on the approval"), {
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
    render(<ApprovalsSection event={event} versionNo={2} live />);

    expect(await screen.findAllByRole("button", { name: "Revoke" })).toHaveLength(2);
  });

  it("lets an org manager approve as each organization they manage", async () => {
    api.viewer = CY;
    const BELLINGCAT = { slug: "bellingcat", name: "Bellingcat", avatar_url: null };
    const OSINT = { slug: "osint-lab", name: "OSINT Lab", avatar_url: null };
    api.apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === "POST") return Promise.resolve(approval());
      if (path === "/users/cy/organizations") {
        return Promise.resolve([
          { organization: BELLINGCAT, role: "manager", joined_at: "2026-10-01T00:00:00Z" },
          { organization: OSINT, role: "member", joined_at: "2026-10-01T00:00:00Z" },
        ]);
      }
      return Promise.resolve([]);
    });
    render(<ApprovalsSection event={event} versionNo={2} live />);

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

  it("signs an organization approval with its name and gives its org managers revoke", async () => {
    api.viewer = CY;
    const BELLINGCAT = { slug: "bellingcat", name: "Bellingcat", avatar_url: null };
    api.apiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/users/cy/organizations"
          ? [{ organization: BELLINGCAT, role: "manager", joined_at: "2026-10-01T00:00:00Z" }]
          : [approval({ organization: BELLINGCAT }), approval({ id: "a2", reviewer: ANA })],
      ),
    );
    render(<ApprovalsSection event={event} versionNo={2} live />);

    expect(await screen.findByRole("link", { name: "Bellingcat" })).toHaveAttribute(
      "href",
      "/organizations/bellingcat",
    );
    expect(screen.getByRole("link", { name: "bo" })).toHaveAttribute("href", "/profile/bo");
    expect(await screen.findAllByRole("button", { name: "Revoke" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Approve as Bellingcat" })).toBeNull();
  });

  it("keeps an organization approval whose acting org manager was erased", async () => {
    const BELLINGCAT = { slug: "bellingcat", name: "Bellingcat", avatar_url: null };
    serve([approval({ organization: BELLINGCAT, reviewer: null })]);
    render(<ApprovalsSection event={event} versionNo={2} live />);

    expect(await screen.findByText("on behalf of Bellingcat")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bellingcat" })).toBeInTheDocument();
  });

  it("shows a revoked approval with its public reason on a filed version", async () => {
    serve([
      approval({
        version_no: 1,
        current: false,
        revoked_at: "2026-10-16T09:00:00Z",
        revoke_reason: "Sockpuppet account",
        revoked_as: "site_admin",
      }),
    ]);
    render(<ApprovalsSection event={event} versionNo={1} live={false} />);

    expect(await screen.findByText("Revoked")).toBeInTheDocument();
    expect(screen.getByText(/Revoked by a site admin on .*: Sockpuppet account/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
  });
});
