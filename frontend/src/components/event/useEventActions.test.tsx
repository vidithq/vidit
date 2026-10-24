import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEventActions, type ActionSurface } from "./useEventActions";
import type { Approval } from "@/lib/approvals";
import type { BeforeClosedStatus, EventDetail, EventStatus } from "@/types";

type Viewer = { id: string; username: string } | null;

const api = vi.hoisted(() => ({
  approvals: [] as unknown[],
  apiFetch: vi.fn(),
  viewer: null as { id: string; username: string } | null,
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: api.apiFetch,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: api.viewer }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const OWNER = { id: "u1", username: "ana" };
const CO_GEOLOCATOR = { id: "u2", username: "bo" };
const ANALYST = { id: "u3", username: "cy" };

beforeEach(() => {
  api.approvals = [];
  api.viewer = OWNER;
  api.apiFetch.mockReset();
  api.apiFetch.mockImplementation((path: string) =>
    Promise.resolve(
      path === "/events/e1/approvals?all_versions=true"
        ? {
            items: api.approvals,
            // What the server says: signed in and outside the credit.
            viewer_can_approve: api.viewer !== null && ![OWNER.id, CO_GEOLOCATOR.id].includes(api.viewer.id),
          }
        : [],
    ),
  );
});

function eventFixture(
  status: EventStatus,
  beforeClosedStatus: BeforeClosedStatus | null = null,
  versionNo = 1,
): EventDetail {
  return {
    id: "e1",
    title: "Strike near Bakhmut",
    coords: { lat: 48.5, lng: 37.8 },
    occurred_date: "2026-06-01",
    occurred_time: null,
    status,
    version_no: versionNo,
    is_graphic: false,
    close_reason: null,
    before_closed_status: beforeClosedStatus,
    detected_from_url: null,
    detected_via: null,
    owner: OWNER,
    tags: [],
    conflicts: [],
    sources: [{ id: "s1", title: "", level: "direct", kind: "unknown", captured_at: null, capture_position: null, is_graphic: false, links: [{ url: "https://t.me/channel/12345", posted_at: null, archived: null }], tags: [], media: null }],
    proof: null,
    created_at: "2026-06-02T10:00:00Z",
    geolocated_at: null,
    closed_at: null,
    thumbnail: null,
    requested_by: null,
    geolocators: status === "geolocated" ? [OWNER, CO_GEOLOCATOR] : [],
  };
}

function Harness({
  status,
  surface,
  beforeClosedStatus = null,
  versionNo = 1,
}: {
  status: EventStatus;
  surface: ActionSurface;
  beforeClosedStatus?: BeforeClosedStatus | null;
  versionNo?: number;
}) {
  const { panels, actions, approvalRequests } = useEventActions({
    event: eventFixture(status, beforeClosedStatus, versionNo),
    surface,
  });
  return (
    <>
      {actions}
      {approvalRequests}
      {panels}
    </>
  );
}

function renderAs(viewer: Viewer, props: Parameters<typeof Harness>[0]) {
  api.viewer = viewer;
  return render(<Harness {...props} />);
}

const row = () => screen.getByRole("group", { name: "Event actions" });

/** Waits until the approvals the event page reads have landed. */
const approvalsRead = () =>
  waitFor(() =>
    expect(api.apiFetch).toHaveBeenCalledWith(
      "/events/e1/approvals?all_versions=true",
      expect.anything(),
    ),
  );

const stamp = (id: string, username: string, over: Partial<Approval> = {}): Approval => ({
  id,
  version_no: 1,
  reviewer: { id: `r-${id}`, username },
  created_at: "2026-10-15T09:00:00Z",
  current: true,
  organization: null,
  ...over,
});

/** The row of controls, buttons and links, left to right, by accessible name. */
const rowControls = () =>
  [...row().querySelectorAll<HTMLElement>("button, a")].map(
    (el) => el.getAttribute("aria-label") ?? el.textContent,
  );

describe("the event actions per reader", () => {
  it("gives the owner the version, Edit, Share and Add to collection, and no report", async () => {
    renderAs(OWNER, { status: "geolocated", surface: "event" });
    expect(rowControls()).toEqual([
      "v1: choose a version",
      "Edit",
      "Share",
      "Add to collection",
    ]);
    expect(within(row()).getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/events/e1/edit",
    );
    await approvalsRead();
  });

  // Approving starts from the approvals under the row, after reading the record.
  it("gives an analyst who may approve the version, Share and Report; Approve waits under the row", async () => {
    renderAs(ANALYST, { status: "geolocated", surface: "event" });
    const card = await screen.findByRole("region", { name: "Approvals" });
    expect(await within(card).findByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(rowControls()).toEqual(["v1: choose a version", "Share", "Report"]);
  });

  // Credit only: a co-geolocator shelves the row and reads its geolocators (where they leave),
  // and never edits, closes or approves it.
  it("gives a co-geolocator Add to collection and Geolocators beside Share and Report", async () => {
    renderAs(CO_GEOLOCATOR, { status: "geolocated", surface: "event" });
    await approvalsRead();
    expect(rowControls()).toEqual([
      "v1: choose a version",
      "Share",
      "Add to collection",
      "Geolocators",
      "Report",
    ]);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("gives a signed-out reader the version, Share and Report", async () => {
    renderAs(null, { status: "geolocated", surface: "event" });
    await approvalsRead();
    expect(rowControls()).toEqual(["v1: choose a version", "Share", "Report"]);
  });

  it("carries no menu, no close, no stamps and no approve control in the row", async () => {
    api.approvals = [stamp("a1", "maya")];
    renderAs(OWNER, { status: "geolocated", surface: "event" });
    await screen.findByRole("link", { name: /^maya approved/ });
    expect(within(row()).queryByRole("button", { name: "More actions" })).toBeNull();
    expect(within(row()).queryByRole("button", { name: /^Close/ })).toBeNull();
    expect(within(row()).queryByRole("list", { name: "Approved by" })).toBeNull();
    expect(within(row()).queryByRole("button", { name: /^Approve\b/ })).toBeNull();
  });
});

describe("the owner's edit", () => {
  it.each<EventStatus>(["requested", "detected", "geolocated"])(
    "leads the owner of a %s row to the edit page, where they also close it",
    (status) => {
      renderAs(OWNER, { status, surface: "event" });
      expect(within(row()).getByRole("link", { name: "Edit" })).toHaveAttribute(
        "href",
        "/events/e1/edit",
      );
    },
  );

  it("offers no edit on a closed row", () => {
    renderAs(OWNER, { status: "closed", surface: "event", beforeClosedStatus: "geolocated" });
    expect(within(row()).queryByRole("link", { name: "Edit" })).toBeNull();
  });

  it("puts the asker's Edit and Geolocate in the request page's actions, with no card around them", () => {
    renderAs(OWNER, { status: "requested", surface: "request" });
    expect(rowControls()).toEqual(["Edit", "Share"]);
    expect(screen.getByRole("link", { name: "Geolocate" })).toHaveAttribute(
      "href",
      "/submit?request_id=e1",
    );
    expect(screen.queryByRole("heading", { name: "Actions" })).toBeNull();
    expect(row().closest("section")).toBeNull();
  });

  it("shows a visitor Share and Report on the request page, then Geolocate", () => {
    renderAs(ANALYST, { status: "requested", surface: "request" });
    expect(rowControls()).toEqual(["Share", "Report"]);
    expect(screen.getByRole("link", { name: "Geolocate" })).toBeInTheDocument();
  });

  it("gives a closed request Share and Report, and no Geolocate", () => {
    renderAs(ANALYST, { status: "closed", surface: "request", beforeClosedStatus: "requested" });
    expect(screen.queryByRole("link", { name: "Geolocate" })).toBeNull();
    expect(rowControls()).toEqual(["Share", "Report"]);
  });

  // Destruction is admin-only, so no surface and no status shows a delete.
  it.each<EventStatus>(["requested", "detected", "geolocated", "closed"])(
    "offers no delete for a %s row on either detail surface",
    (status) => {
      for (const surface of ["event", "request"] as const) {
        const { unmount } = renderAs(OWNER, { status, surface });
        expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
        unmount();
      }
    },
  );

});

describe("panels the row opens", () => {
  it("opens and closes the collection picker, marking its toggle while open", async () => {
    renderAs(OWNER, { status: "geolocated", surface: "event" });
    const toggle = within(row()).getByRole("button", { name: "Add to collection" });
    fireEvent.click(toggle);
    expect(screen.getByRole("heading", { name: "Add to collection" })).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(document.getElementById("add-to-collection-panel")).toHaveFocus());

    fireEvent.click(toggle);
    expect(screen.queryByRole("heading", { name: "Add to collection" })).toBeNull();
  });

  it("opens the geolocators panel for a co-geolocator, where they leave", () => {
    renderAs(CO_GEOLOCATOR, { status: "geolocated", surface: "event" });
    fireEvent.click(within(row()).getByRole("button", { name: "Geolocators" }));
    expect(screen.getByRole("heading", { name: "Geolocators" })).toBeInTheDocument();
  });

  it.each<EventStatus>(["requested", "detected"])("offers no geolocators panel on a %s row", (status) => {
    renderAs(CO_GEOLOCATOR, { status, surface: "event" });
    expect(within(row()).queryByRole("button", { name: "Geolocators" })).toBeNull();
  });

  it("opens the report form, signed out", () => {
    renderAs(null, { status: "geolocated", surface: "event" });
    fireEvent.click(within(row()).getByRole("button", { name: "Report" }));
    expect(screen.getByRole("heading", { name: "Report this event" })).toBeInTheDocument();
  });
});

describe("the version selector", () => {
  it("names the version on screen and lists every version newest first, then the history", () => {
    renderAs(null, { status: "geolocated", surface: "event", versionNo: 3 });
    const trigger = within(row()).getByRole("button", { name: "v3: choose a version" });
    expect(trigger).toHaveTextContent("v3");
    fireEvent.click(trigger);

    const items = within(screen.getByRole("menu", { name: "Versions" })).getAllByRole("menuitem");
    const name = (item: HTMLElement) => item.getAttribute("aria-label") ?? item.textContent;
    expect(items.map((item) => [name(item), item.getAttribute("href")])).toEqual([
      ["v3", "/events/e1"],
      ["v2", "/events/e1/v2"],
      ["v1", "/events/e1/v1"],
      ["History", "/events/e1/history"],
    ]);
    expect(items[3]).toHaveTextContent("");
    expect(items[0]).toHaveAttribute("aria-current", "page");
    expect(items[0]).toHaveFocus();
  });

  // A retraction keeps the record it took back, so its versions are what a reader most needs after one.
  it("stays on a retracted row", () => {
    renderAs(null, { status: "closed", surface: "event", beforeClosedStatus: "geolocated" });
    expect(within(row()).getByRole("button", { name: "v1: choose a version" })).toBeInTheDocument();
  });

  it.each<[EventStatus, BeforeClosedStatus | null]>([
    ["requested", null],
    ["detected", null],
    ["closed", "requested"],
    ["closed", "detected"],
  ])("is absent from a %s row, which never published", (status, before) => {
    renderAs(OWNER, { status, surface: "event", beforeClosedStatus: before });
    expect(within(row()).queryByRole("button", { name: /choose a version/ })).toBeNull();
  });

  it("is absent from the request page", () => {
    renderAs(null, { status: "geolocated", surface: "request" });
    expect(within(row()).queryByRole("button", { name: /choose a version/ })).toBeNull();
  });
});

describe("the approvals under the actions row", () => {
  it("comes with the event page of a published row, right under the row", async () => {
    api.approvals = [stamp("a1", "maya")];
    renderAs(null, { status: "geolocated", surface: "event" });
    const approvals = await screen.findByRole("region", { name: "Approvals" });
    expect(approvals.previousElementSibling).toBe(row());
  });

  it.each<[ActionSurface, EventStatus]>([
    ["request", "geolocated"],
    ["event", "requested"],
  ])("is absent from the %s surface of a %s row, which reads no approvals", (surface, status) => {
    renderAs(null, { status, surface });
    expect(screen.queryByRole("region", { name: "Approvals" })).toBeNull();
    expect(api.apiFetch).not.toHaveBeenCalledWith(
      "/events/e1/approvals?all_versions=true",
      expect.anything(),
    );
  });
});
