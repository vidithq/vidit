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
    version_no: 1,
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
}: {
  status: EventStatus;
  surface: ActionSurface;
  beforeClosedStatus?: BeforeClosedStatus | null;
}) {
  const { actions, panels, verification } = useEventActions({
    event: eventFixture(status, beforeClosedStatus),
    surface,
  });
  return (
    <>
      {actions && <header data-testid="header">{actions}</header>}
      {panels}
      {verification}
    </>
  );
}

function renderAs(viewer: Viewer, props: Parameters<typeof Harness>[0]) {
  api.viewer = viewer;
  return render(<Harness {...props} />);
}

const header = () => screen.getByTestId("header");

/** The More menu's items, by name, after opening it; empty when the header has no menu. */
function moreItems(): string[] {
  const trigger = within(header()).queryByRole("button", { name: "More actions" });
  if (!trigger) return [];
  fireEvent.click(trigger);
  const names = screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  return names;
}

function chooseMore(name: string) {
  fireEvent.click(within(header()).getByRole("button", { name: "More actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

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

describe("the event header per reader", () => {
  it("gives the owner Edit as the primary action, Share, and their verbs under More", async () => {
    renderAs(OWNER, { status: "geolocated", surface: "event" });
    const edit = within(header()).getByRole("link", { name: "Edit this geolocation" });
    expect(edit).toHaveAttribute("href", "/events/e1/edit");
    expect(edit).toHaveTextContent("Edit");
    expect(within(header()).getByRole("button", { name: "Share" })).toBeInTheDocument();
    expect(moreItems()).toEqual([
      "Version history",
      "Geolocators",
      "Add to collection",
      "Close this geolocation",
      "Report",
    ]);
    await screen.findByText("Not approved yet");
    expect(within(header()).queryByRole("button", { name: /^Approve/ })).toBeNull();
  });

  it("gives an analyst who may approve Approve version N, which focuses the approve form", async () => {
    renderAs(ANALYST, { status: "geolocated", surface: "event" });
    const approve = await within(header()).findByRole("button", { name: "Approve version 1" });
    expect(within(header()).queryByRole("link", { name: /^Edit/ })).toBeNull();
    expect(moreItems()).toEqual(["Version history", "Report"]);

    fireEvent.click(approve);
    expect(screen.getByLabelText("Note (optional)")).toHaveFocus();
  });

  it("gives an analyst who already approved no primary action", async () => {
    api.approvals = [stamp("a1", ANALYST.username, { reviewer: ANALYST })];
    renderAs(ANALYST, { status: "geolocated", surface: "event" });
    await screen.findByText("Approved · 1 · version 1");
    expect(within(header()).queryByRole("button", { name: /^Approve/ })).toBeNull();
  });

  // Credit only: a co-geolocator shelves the row and sees its geolocators, and never edits,
  // closes or approves it.
  it("gives a co-geolocator no primary action and the two credit controls under More", async () => {
    renderAs(CO_GEOLOCATOR, { status: "geolocated", surface: "event" });
    await screen.findByText("Not approved yet");
    expect(within(header()).queryByRole("link", { name: /^Edit/ })).toBeNull();
    expect(within(header()).queryByRole("button", { name: /^Approve/ })).toBeNull();
    expect(moreItems()).toEqual([
      "Version history",
      "Geolocators",
      "Add to collection",
      "Report",
    ]);
  });

  it("gives a signed-out reader Share and More with the history and the report", async () => {
    renderAs(null, { status: "geolocated", surface: "event" });
    await screen.findByText("Not approved yet");
    expect(within(header()).getAllByRole("button").map((b) => b.textContent || b.getAttribute("aria-label"))).toEqual([
      "Share",
      "More actions",
    ]);
    expect(moreItems()).toEqual(["Version history", "Report"]);
  });

  it("carries no approval stamps and no Approvals trigger in the header", async () => {
    api.approvals = [stamp("a1", "maya")];
    renderAs(null, { status: "geolocated", surface: "event" });
    await screen.findByText("Approved · 1 · version 1");
    expect(within(header()).queryByRole("list", { name: "Approved by" })).toBeNull();
    expect(within(header()).queryByRole("button", { name: "Approvals" })).toBeNull();
  });
});

describe("owner management: correcting, taking back, and never destroying", () => {
  it.each<EventStatus>(["requested", "closed", "detected"])(
    "shows no published edit on the event surface for a %s row",
    (status) => {
      renderAs(OWNER, { status, surface: "event" });
      expect(screen.queryByRole("link", { name: "Edit this geolocation" })).toBeNull();
    },
  );

  // Overwritten rather than versioned, so the label promises no version.
  it("makes the request edit the owner's primary action on the event surface", () => {
    renderAs(OWNER, { status: "requested", surface: "event" });
    expect(within(header()).getByRole("link", { name: "Edit this request" })).toHaveAttribute(
      "href",
      "/events/e1/edit",
    );
    expect(moreItems()).toEqual(["Close this request", "Report"]);
  });

  // Geolocate is the request page's primary action for everyone, so the asker's edit moves to More.
  it("keeps Geolocate primary on the request page and moves the asker's edit to More", () => {
    renderAs(OWNER, { status: "requested", surface: "request" });
    expect(within(header()).getByRole("link", { name: "Geolocate" })).toHaveAttribute(
      "href",
      "/submit?request_id=e1",
    );
    expect(moreItems()).toEqual(["Edit this request", "Close this request", "Report"]);
  });

  it("shows a visitor Geolocate and no owner verb on the request page", () => {
    renderAs(ANALYST, { status: "requested", surface: "request" });
    expect(within(header()).getByRole("link", { name: "Geolocate" })).toBeInTheDocument();
    expect(moreItems()).toEqual(["Report"]);
  });

  // One verb closes all three live states; the noun names the row.
  it.each<[EventStatus, string]>([
    ["requested", "Close this request"],
    ["detected", "Close this detection"],
    ["geolocated", "Close this geolocation"],
  ])("names the row a %s close applies to", (status, label) => {
    renderAs(OWNER, { status, surface: "event" });
    expect(moreItems()).toContain(label);
  });

  // Closing is terminal with no owner un-close, so the verb goes once taken.
  it.each<ActionSurface>(["event", "request"])(
    "offers nothing to close on a closed row (%s surface)",
    (surface) => {
      renderAs(OWNER, { status: "closed", surface, beforeClosedStatus: "requested" });
      expect(moreItems().some((name) => name.startsWith("Close"))).toBe(false);
    },
  );

  // Destruction is admin-only, so no surface and no status shows a delete.
  it.each<EventStatus>(["requested", "detected", "geolocated", "closed"])(
    "offers no delete for a %s row on either detail surface",
    (status) => {
      for (const surface of ["event", "request"] as const) {
        const { unmount } = renderAs(OWNER, { status, surface });
        expect(moreItems().some((name) => /delete/i.test(name))).toBe(false);
        expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
        unmount();
      }
    },
  );

  // The reason makes a closed row a decision, not a disappearance, so its panel opens named for
  // the row, and focus moves to it.
  it("opens the close panel named for the row it closes and focuses it", async () => {
    renderAs(OWNER, { status: "geolocated", surface: "event" });
    chooseMore("Close this geolocation");
    expect(screen.getByLabelText("Close reason")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close this geolocation" })).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("close-request-form")).toHaveFocus());
  });

  it.each<ActionSurface>(["edit", "panel"])("gives the %s surface no header at all", (surface) => {
    const { container } = renderAs(OWNER, { status: "geolocated", surface });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("panels the More menu opens", () => {
  it("opens and closes the geolocators panel, marking its item while open", async () => {
    renderAs(OWNER, { status: "geolocated", surface: "event" });
    chooseMore("Geolocators");
    expect(screen.getByRole("heading", { name: "Geolocators" })).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("geolocators-panel")).toHaveFocus());

    fireEvent.click(within(header()).getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Geolocators" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Geolocators" }));
    expect(screen.queryByRole("heading", { name: "Geolocators" })).toBeNull();
  });

  it.each<EventStatus>(["requested", "detected"])("offers no geolocators panel on a %s row", (status) => {
    renderAs(OWNER, { status, surface: "event" });
    expect(moreItems()).not.toContain("Geolocators");
  });

  it("opens the report form from More, signed out", () => {
    renderAs(null, { status: "geolocated", surface: "event" });
    chooseMore("Report");
    expect(screen.getByRole("heading", { name: "Report this event" })).toBeInTheDocument();
  });
});

describe("the version history", () => {
  // A retraction keeps the record it took back, so the history is what a reader most needs after one.
  it("links the history from More on a published or retracted row", () => {
    for (const before of [null, "geolocated"] as const) {
      const { unmount } = renderAs(null, {
        status: before ? "closed" : "geolocated",
        surface: "event",
        beforeClosedStatus: before,
      });
      fireEvent.click(within(header()).getByRole("button", { name: "More actions" }));
      expect(screen.getByRole("menuitem", { name: "Version history" })).toHaveAttribute(
        "href",
        "/events/e1/history",
      );
      unmount();
    }
  });

  it.each<[EventStatus, BeforeClosedStatus | null]>([
    ["requested", null],
    ["detected", null],
    ["closed", "requested"],
    ["closed", "detected"],
  ])("offers no version history for a %s row, which never published", (status, before) => {
    renderAs(null, { status, surface: "event", beforeClosedStatus: before });
    expect(moreItems()).not.toContain("Version history");
  });

  it("carries no version history on the request page", () => {
    renderAs(null, { status: "geolocated", surface: "request" });
    expect(moreItems()).not.toContain("Version history");
  });
});

describe("the Verification card", () => {
  it("comes with the event page of a published row", async () => {
    renderAs(null, { status: "geolocated", surface: "event" });
    expect(await screen.findByRole("region", { name: "Verification" })).toBeInTheDocument();
  });

  it.each<[ActionSurface, EventStatus]>([
    ["request", "geolocated"],
    ["panel", "geolocated"],
    ["event", "requested"],
  ])("is absent from the %s surface of a %s row, which reads no approvals", (surface, status) => {
    renderAs(null, { status, surface });
    expect(screen.queryByRole("region", { name: "Verification" })).toBeNull();
    expect(api.apiFetch).not.toHaveBeenCalledWith(
      "/events/e1/approvals?all_versions=true",
      expect.anything(),
    );
  });
});
