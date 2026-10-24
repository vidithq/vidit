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
import { ApprovalsCard } from "./ApprovalsCard";

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
  return <ApprovalsCard event={event} approvals={approvals} />;
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

  it("shows a delete control per approval to a site admin", async () => {
    api.admin = true;
    render(<Panel />);
    expect(await trash()).toBeInTheDocument();
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
    expect(await screen.findByText("No approvals yet")).toBeInTheDocument();
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
