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
    event_coords: { lat: 48.5, lng: 37.8 },
    capture_source_coords: null,
    archived_source: null,
    archived_detected_from: null,
    event_date: "2026-06-01",
    event_time: null,
    source_posted_at: "2026-05-30T14:32:00Z",
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
    source_url: "https://t.me/channel/12345",
    secondary_source_urls: [],
    archived_secondary_sources: [],
    proof: null,
    created_at: "2026-06-02T10:00:00Z",
    geolocated_at: null,
    closed_at: null,
    media: [],
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
  const { actions, panels, rail, actionsCard } = useEventActions({
    event: eventFixture(status, beforeClosedStatus, versionNo),
    surface,
  });
  return (
    <>
      {actions && <header data-testid="header">{actions}</header>}
      {panels}
      {rail}
      {actionsCard}
    </>
  );
}

function renderAs(viewer: Viewer, props: Parameters<typeof Harness>[0]) {
  api.viewer = viewer;
  return render(<Harness {...props} />);
}

const header = () => screen.getByTestId("header");

const stamp = (id: string, username: string, over: Partial<Approval> = {}): Approval => ({
  id,
  version_no: 1,
  verdict: "approve",
  reviewer: { id: `r-${id}`, username },
  note: null,
  created_at: "2026-10-15T09:00:00Z",
  current: true,
  revoked_at: null,
  revoke_reason: null,
  revoked_as: null,
  organization: null,
  ...over,
});

/** The header's controls, buttons and links, left to right, by accessible name. */
const headerControls = () =>
  [...header().querySelectorAll<HTMLElement>("button, a")].map(
    (el) => el.getAttribute("aria-label") ?? el.textContent,
  );

describe("the event header per reader", () => {
  it("gives the owner the version, Edit, Share and Add to collection, and no report", async () => {
    renderAs(OWNER, { status: "geolocated", surface: "event" });
    expect(headerControls()).toEqual([
      "v1: choose a version",
      "Edit",
      "Share",
      "Add to collection",
    ]);
    expect(within(header()).getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/events/e1/edit",
    );
    await screen.findByText("No approvals yet");
  });

  // Approving starts from the Approvals card, after reading the record.
  it("gives an analyst who may approve the version, Share and Report; Approve waits in the card", async () => {
    renderAs(ANALYST, { status: "geolocated", surface: "event" });
    const card = await screen.findByRole("region", { name: "Approvals" });
    expect(await within(card).findByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(headerControls()).toEqual(["v1: choose a version", "Share", "Report"]);
  });

  // Credit only: a co-geolocator shelves the row and reads its geolocators (where they leave),
  // and never edits, closes or approves it.
  it("gives a co-geolocator Add to collection and Geolocators beside Share and Report", async () => {
    renderAs(CO_GEOLOCATOR, { status: "geolocated", surface: "event" });
    await screen.findByText("No approvals yet");
    expect(headerControls()).toEqual([
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
    await screen.findByText("No approvals yet");
    expect(headerControls()).toEqual(["v1: choose a version", "Share", "Report"]);
  });

  it("carries no menu, no close, no stamps and no approve control in the header", async () => {
    api.approvals = [stamp("a1", "maya")];
    renderAs(OWNER, { status: "geolocated", surface: "event" });
    await screen.findByRole("link", { name: "maya" });
    expect(within(header()).queryByRole("button", { name: "More actions" })).toBeNull();
    expect(within(header()).queryByRole("button", { name: /^Close/ })).toBeNull();
    expect(within(header()).queryByRole("list", { name: "Approved by" })).toBeNull();
    expect(within(header()).queryByRole("button", { name: /^Approve\b/ })).toBeNull();
  });
});

describe("the owner's edit", () => {
  it.each<EventStatus>(["requested", "detected", "geolocated"])(
    "leads the owner of a %s row to the edit page, where they also close it",
    (status) => {
      renderAs(OWNER, { status, surface: "event" });
      expect(within(header()).getByRole("link", { name: "Edit" })).toHaveAttribute(
        "href",
        "/events/e1/edit",
      );
    },
  );

  it("offers no edit on a closed row", () => {
    renderAs(OWNER, { status: "closed", surface: "event", beforeClosedStatus: "geolocated" });
    expect(within(header()).queryByRole("link", { name: "Edit" })).toBeNull();
  });

  it("puts Geolocate in the request page's Actions card, the asker's Edit in the header", () => {
    renderAs(OWNER, { status: "requested", surface: "request" });
    expect(headerControls()).toEqual(["Edit", "Share"]);
    const card = screen.getByRole("heading", { name: "Actions" }).closest("section")!;
    expect(within(card).getByRole("link", { name: "Geolocate" })).toHaveAttribute(
      "href",
      "/submit?request_id=e1",
    );
  });

  it("shows a visitor Share and Report on the request page, Geolocate in the card", () => {
    renderAs(ANALYST, { status: "requested", surface: "request" });
    expect(headerControls()).toEqual(["Share", "Report"]);
    expect(screen.getByRole("link", { name: "Geolocate" })).toBeInTheDocument();
  });

  it("gives a closed request no Actions card", () => {
    renderAs(ANALYST, { status: "closed", surface: "request", beforeClosedStatus: "requested" });
    expect(screen.queryByRole("link", { name: "Geolocate" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Actions" })).toBeNull();
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

  it.each<ActionSurface>(["edit", "panel"])("gives the %s surface no header at all", (surface) => {
    const { container } = renderAs(OWNER, { status: "geolocated", surface });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("panels the header opens", () => {
  it("opens and closes the collection picker, marking its toggle while open", async () => {
    renderAs(OWNER, { status: "geolocated", surface: "event" });
    const toggle = within(header()).getByRole("button", { name: "Add to collection" });
    fireEvent.click(toggle);
    expect(screen.getByRole("heading", { name: "Add to collection" })).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(document.getElementById("add-to-collection-panel")).toHaveFocus());

    fireEvent.click(toggle);
    expect(screen.queryByRole("heading", { name: "Add to collection" })).toBeNull();
  });

  it("opens the geolocators panel for a co-geolocator, where they leave", () => {
    renderAs(CO_GEOLOCATOR, { status: "geolocated", surface: "event" });
    fireEvent.click(within(header()).getByRole("button", { name: "Geolocators" }));
    expect(screen.getByRole("heading", { name: "Geolocators" })).toBeInTheDocument();
  });

  it.each<EventStatus>(["requested", "detected"])("offers no geolocators panel on a %s row", (status) => {
    renderAs(CO_GEOLOCATOR, { status, surface: "event" });
    expect(within(header()).queryByRole("button", { name: "Geolocators" })).toBeNull();
  });

  it("opens the report form, signed out", () => {
    renderAs(null, { status: "geolocated", surface: "event" });
    fireEvent.click(within(header()).getByRole("button", { name: "Report" }));
    expect(screen.getByRole("heading", { name: "Report this event" })).toBeInTheDocument();
  });
});

describe("the version selector", () => {
  it("names the version on screen and lists every version newest first, then the history", () => {
    renderAs(null, { status: "geolocated", surface: "event", versionNo: 3 });
    const trigger = within(header()).getByRole("button", { name: "v3: choose a version" });
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
    expect(within(header()).getByRole("button", { name: "v1: choose a version" })).toBeInTheDocument();
  });

  it.each<[EventStatus, BeforeClosedStatus | null]>([
    ["requested", null],
    ["detected", null],
    ["closed", "requested"],
    ["closed", "detected"],
  ])("is absent from a %s row, which never published", (status, before) => {
    renderAs(OWNER, { status, surface: "event", beforeClosedStatus: before });
    expect(within(header()).queryByRole("button", { name: /choose a version/ })).toBeNull();
  });

  it("is absent from the request page", () => {
    renderAs(null, { status: "geolocated", surface: "request" });
    expect(within(header()).queryByRole("button", { name: /choose a version/ })).toBeNull();
  });
});

describe("the Approvals card", () => {
  it("comes with the event page of a published row", async () => {
    renderAs(null, { status: "geolocated", surface: "event" });
    expect(await screen.findByRole("region", { name: "Approvals" })).toBeInTheDocument();
  });

  it.each<[ActionSurface, EventStatus]>([
    ["request", "geolocated"],
    ["panel", "geolocated"],
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
