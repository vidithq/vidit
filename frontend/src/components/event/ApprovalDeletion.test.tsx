import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApiResource } from "@/hooks/useApiResource";
import { allApprovalsPath, type Approval, type ApprovalList } from "@/lib/approvals";
import { eventDetail } from "@/test/eventDetail";

const api = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  admin: false,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  errorMessage: (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback),
  ApiError: class extends Error {
    status: number;
    code: string | null;
    constructor(message: string, status: number, code: string | null = null) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u9", username: "root" } }),
}));
vi.mock("@/contexts/AdminContext", () => ({
  useAdmin: () => ({ isAdmin: api.admin, loading: false }),
}));

import { ApiError } from "@/lib/api";
import { VersionApprovals } from "./Approvals";
import { useEventApprovals } from "./EventApprovals";

const ALL = "/events/e1/approvals?all_versions=true";
const event = { ...eventDetail("e1", "Bridge strike"), version_no: 2, geolocators: [] };
const approval: Approval = {
  id: "a1",
  version_no: 2,
  reviewer: { id: "u2", username: "bo" },
  created_at: "2026-10-15T09:00:00Z",
  current: true,
  organization: null,
};

function Panel() {
  const approvals = useApiResource<ApprovalList>(allApprovalsPath(event.id));
  return <>{useEventApprovals(event, approvals).summary}</>;
}

let rows: Approval[];

beforeEach(() => {
  api.apiFetch.mockReset();
  api.admin = false;
  rows = [approval];
  api.apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === "DELETE") {
      rows = [];
      return Promise.resolve(undefined);
    }
    return Promise.resolve(path === ALL ? { items: rows, viewer_can_approve: false } : []);
  });
});

const deleteCalls = () => api.apiFetch.mock.calls.filter(([, init]) => init?.method === "DELETE");
const trash = () => screen.findByRole("button", { name: "Delete approval by bo" });

describe("deleting an approval", () => {
  it("is hidden from a reader who is not a site admin", async () => {
    render(<Panel />);
    await screen.findByRole("list", { name: "Approved by" });
    expect(screen.queryByRole("button", { name: /Delete approval/ })).toBeNull();
  });

  it("puts a delete control on each stamp for a site admin", async () => {
    api.admin = true;
    render(<Panel />);
    const control = await trash();
    const stamp = within(screen.getByRole("list", { name: "Approved by" })).getByRole("listitem");
    expect(stamp).toContainElement(control);
    expect(control.className).toContain("group-hover:opacity-100");
  });

  it("deletes from a filed version's stamps", async () => {
    api.admin = true;
    const V1 = "/events/e1/approvals?version_no=1";
    rows = [{ ...approval, version_no: 1, current: false }];
    api.apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === "DELETE") {
        rows = [];
        return Promise.resolve(undefined);
      }
      return Promise.resolve(path === V1 ? { items: rows, viewer_can_approve: false } : []);
    });
    const { container } = render(<VersionApprovals event={event} versionNo={1} />);
    fireEvent.click(await trash());
    expect(screen.getByRole("dialog")).toHaveTextContent("approval of version 1 by bo");
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete approval" }),
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(deleteCalls()).toEqual([["/admin/approvals/a1", { method: "DELETE" }]]);
  });

  it("deletes after the confirmation and refreshes the list", async () => {
    api.admin = true;
    render(<Panel />);
    fireEvent.click(await trash());
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("This cannot be undone");
    expect(dialog).toHaveTextContent("can approve this version again");
    expect(deleteCalls()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete approval" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deleteCalls()).toEqual([["/admin/approvals/a1", { method: "DELETE" }]]);
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Approved by" })).toBeNull(),
    );
  });

  it("sends nothing on cancel", async () => {
    api.admin = true;
    render(<Panel />);
    fireEvent.click(await trash());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteCalls()).toHaveLength(0);
  });

  it("explains an approval that no longer exists inside the dialog", async () => {
    api.admin = true;
    api.apiFetch.mockImplementation((path: string, init?: { method?: string }) =>
      init?.method === "DELETE"
        ? Promise.reject(new ApiError("not found", 404, "approval_not_found"))
        : Promise.resolve(path === ALL ? { items: rows, viewer_can_approve: false } : []),
    );
    render(<Panel />);
    fireEvent.click(await trash());
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete approval" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer exists");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
