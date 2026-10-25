import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// jsdom cannot mount the map canvas (WebGL); it and the proof editor (its own test) keep a marker.
vi.mock("@/components/map/Map", () => ({
  default: () => <div data-testid="map" />,
}));
vi.mock("@/components/editor/ProofEditor", () => ({
  default: () => <div data-testid="proof-editor" />,
}));

const push = vi.fn();
let queryParam: string | null = null;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: "d1" }),
  useSearchParams: () => new URLSearchParams(queryParam ? "queue=1" : ""),
}));

// Signed in as the row's owner, except where a test signs in someone else to reach the refusal.
const { auth, OWNER, VISITOR } = vi.hoisted(() => {
  const OWNER = { id: "u1", username: "ana" };
  const VISITOR = { id: "u2", username: "bo" };
  return { auth: { user: OWNER }, OWNER, VISITOR };
});

vi.mock("@/hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({ user: auth.user, loading: false }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", username: "ana" } }),
}));

vi.mock("@/contexts/DetectionsContext", () => ({
  useDetectionsCount: () => ({ count: 2, refresh: vi.fn() }),
}));

// Every read the surface makes, by path: the row, the review queue, the taxonomy.
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => ({
    data: path === null ? null : resource(path),
    error: null,
    refetch: () => {},
  }),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events")>()),
  saveVersion: vi.fn(),
  updateEventRequest: vi.fn(),
  closeEvent: vi.fn(),
}));

import { closeEvent, saveVersion, updateEventRequest } from "@/lib/events";
import { ARM_MS } from "@/hooks/useConfirmAction";
import type { Source } from "@/lib/sources";
import type { Conflict, EventDetail, Tag } from "@/types";

import EditEventPage from "./page";

const saveVersionMock = vi.mocked(saveVersion);
const updateRequestMock = vi.mocked(updateEventRequest);
const closeMock = vi.mocked(closeEvent);

const CONFLICTS: Conflict[] = [
  {
    id: "c1",
    name: "Russian invasion of Ukraine",
    wikidata_id: "Q110999040",
    start_year: 2022,
    end_year: null,
    is_ongoing: true,
    tier: "major",
  },
];

const TAGS: Tag[] = [{ id: "t-drone", name: "Drone" }];

/** The row's one source: its footage, posted once, with a seconds-precise post time. */
const source = (over: Partial<Source> = {}): Source => ({
  id: "s1",
  title: "",
  level: "direct",
  kind: "drone",
  captured_at: null,
  capture_position: null,
  is_graphic: false,
  links: [{ url: "https://t.me/channel/12345", posted_at: "2026-05-30T14:32:27Z", archived: null }],
  tags: [],
  media: {
    id: "m1",
    role: "source",
    storage_url: "/local-storage/evidence.jpg",
    kind: "image",
    sha256: "0".repeat(64),
  },
  warnings: [],
  ...over,
});

function detectionFixture(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: "d1",
    title: "Strike near Bakhmut",
    coords: { lat: 48.5, lng: 37.8 },
    occurred_date: "2026-06-01",
    occurred_time: null,
    status: "detected",
    version_no: 0,
    is_graphic: false,
    close_reason: null,
    before_closed_status: null,
    detected_from_url: "https://x.com/analyst/status/1",
    detected_via: null,
    owner: { id: "u1", username: "ana" },
    tags: [],
    conflicts: [],
    sources: [source({ kind: "unknown" })],
    proof: '<img src="https://cdn.test/p.jpg">',
    created_at: "2026-06-02T10:00:00Z",
    geolocated_at: null,
    closed_at: null,
    thumbnail: null,
    requested_by: null,
    geolocators: [],
    ...overrides,
  };
}

/** A published geolocation the owner is correcting, with the picks a publication required. */
function publishedFixture(overrides: Partial<EventDetail> = {}): EventDetail {
  return detectionFixture({
    status: "geolocated",
    version_no: 1,
    geolocated_at: "2026-06-02T11:00:00Z",
    // Both carry seconds, which the form inputs lack: an untouched save must not post the truncation back.
    occurred_time: "14:32:27",
    sources: [source()],
    tags: TAGS,
    conflicts: CONFLICTS,
    ...overrides,
  });
}

/** An open request its owner is correcting: no coordinate, footage attached, no curated picks. */
function requestFixture(overrides: Partial<EventDetail> = {}): EventDetail {
  return detectionFixture({
    status: "requested",
    coords: null,
    detected_from_url: null,
    requested_by: { id: "u1", username: "ana" },
    proof: null,
    ...overrides,
  });
}

/** The row `/events/d1` serves, set per test. */
let row: EventDetail;

/** The queue being walked: this detection, then two more. */
let queueItems: EventDetail[] = [];

function resource(path: string) {
  if (path.endsWith("/geolocator-invites")) return [];
  if (path.startsWith("/events/d1")) return row;
  if (path.startsWith("/events/detections"))
    return { items: queueItems, total: queueItems.length, page: 1, per_page: 100 };
  if (path === "/conflicts") return CONFLICTS;
  return null;
}

/** Make the two picks a review makes: the conflict, and the kind the import left unknown. */
function fillTheFloor() {
  fireEvent.focus(screen.getByRole("combobox", { name: "Conflict" }));
  fireEvent.click(screen.getByRole("option", { name: /Russian invasion of Ukraine/ }));
  fireEvent.change(screen.getByRole("combobox", { name: /Kind/ }), {
    target: { value: "drone" },
  });
}

/** Fill the floor, then publish (the first click arms, the second writes). */
async function publishDetection() {
  fillTheFloor();
  fireEvent.click(screen.getByRole("button", { name: "Publish" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm publish" }));
}

/** Open the byline's add popover and pick `username` by its exact name. */
function pickCoGeolocator(username: string) {
  const add = screen.getByRole("button", { name: "Invite a geolocator" });
  if (add.getAttribute("aria-expanded") !== "true") fireEvent.click(add);
  const popover = screen.getByRole("dialog", { name: "Invite a geolocator" });
  const field = within(popover).getByRole("combobox");
  fireEvent.change(field, { target: { value: username } });
  fireEvent.keyDown(field, { key: "Enter" });
}

/** True when `later` comes after `earlier` in document order. */
function follows(earlier: Element, later: Element): boolean {
  return !!(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** Close the row on screen: More actions, its close item, then the reason dialog. */
function closeRow(label: string, reason: string) {
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
  const dialog = screen.getByRole("dialog", { name: label });
  fireEvent.change(within(dialog).getByLabelText(/Close reason/), {
    target: { value: reason },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: label }));
}

/** Close the detection on screen. */
function closeDetection(reason: string) {
  closeRow("Close this detection", reason);
}

beforeEach(() => {
  push.mockReset();
  saveVersionMock.mockReset();
  updateRequestMock.mockReset();
  closeMock.mockReset();
  saveVersionMock.mockResolvedValue(publishedFixture({ version_no: 2 }));
  updateRequestMock.mockResolvedValue(requestFixture());
  row = detectionFixture();
  auth.user = OWNER;
  queryParam = null;
  queueItems = [
    detectionFixture(),
    detectionFixture({ id: "d2", title: "Second" }),
    detectionFixture({ id: "d3", title: "Third" }),
  ];
});

describe("the detection edit surface", () => {
  it("labels the provenance link Detected from", () => {
    render(<EditEventPage />);

    expect(screen.getByText("Detected from")).toBeInTheDocument();
    expect(screen.queryByText("Requested from")).toBeNull();
  });

  it("renders the form under a bare title, with Publish and More actions in the sticky actions", () => {
    render(<EditEventPage />);

    expect(
      screen.getByRole("heading", { name: "Publish detection" })
    ).toBeInTheDocument();
    // No description line under the title: the fields say what they are.
    expect(screen.queryByText(/Publishing makes the event public/)).toBeNull();
    // The sticky actions come before the fields; no Cancel, and no bare Close.
    const rail = screen.getByRole("complementary", { name: "Actions" });
    const submit = within(rail).getByRole("button", { name: "Publish" });
    expect(screen.queryByRole("link", { name: "Cancel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(follows(submit, document.getElementById("event-edit-form")!)).toBe(true);

    // The close waits behind More actions, after Publish.
    const more = within(rail).getByRole("button", { name: "More actions" });
    expect(follows(submit, more)).toBe(true);
    expect(screen.queryByRole("button", { name: "Close this detection" })).toBeNull();
    fireEvent.click(more);
    expect(screen.getByRole("menuitem", { name: "Close this detection" })).toBeInTheDocument();
  });

  it("closes the detection behind its reason panel", async () => {
    closeMock.mockResolvedValue(detectionFixture({ status: "closed" }));
    render(<EditEventPage />);

    closeDetection("Not a strike.");
    // Off a review pass, a disposed detection leaves for the queue list.
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/profile/ana/detections")
    );
  });

  it("carries no queue position or Skip when it is not a review pass", () => {
    render(<EditEventPage />);
    expect(screen.queryByText(/Detection \d+ of/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  });

  it("counts on Publish what publishing still needs", () => {
    render(<EditEventPage />);

    const rail = screen.getByRole("complementary", { name: "Actions" });
    // The import left no conflict: Publish counts it, and not the title it holds.
    const publish = within(rail).getByRole("button", { name: "Publish" });
    expect(publish).toHaveAccessibleDescription(/^\d+ missing: .*Conflict/);
    expect(publish).not.toHaveAccessibleDescription(/Title/);
  });

  it("publishes through the versioned write, naming version 0", async () => {
    render(<EditEventPage />);
    await publishDetection();
    await waitFor(() => expect(saveVersionMock).toHaveBeenCalledTimes(1));
    const [id, input] = saveVersionMock.mock.calls[0];
    expect(id).toBe("d1");
    expect(input.version_no).toBe(0);
    expect(input.note).toBeUndefined();
    expect(input.geolocator_invites).toEqual([]);
  });

  it("invites the co-geolocators picked in the byline with the publish", async () => {
    render(<EditEventPage />);
    pickCoGeolocator("dee");
    pickCoGeolocator("eve");
    // The picks join the byline, faded until the publish invites them, and one goes on a click.
    expect(screen.getByRole("link", { name: "dee, invited when you publish" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove eve" }));
    expect(screen.queryByRole("link", { name: /^eve/ })).toBeNull();

    await publishDetection();
    await waitFor(() => expect(saveVersionMock).toHaveBeenCalledTimes(1));
    expect(saveVersionMock.mock.calls[0][1].geolocator_invites).toEqual(["dee"]);
  });

  it("returns to the queue list after a publish made outside a pass", async () => {
    render(<EditEventPage />);
    await publishDetection();
    await waitFor(() => expect(saveVersionMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/profile/ana/detections")
    );
  });
});

describe("a review pass over the queue", () => {
  beforeEach(() => {
    queryParam = "queue=1";
  });

  it("is the same form, proof editor included, plus its position", async () => {
    render(<EditEventPage />);

    expect(screen.getByText("Detection 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Title/ })).toHaveValue(
      "Strike near Bakhmut"
    );
    expect(await screen.findByTestId("proof-editor")).toBeInTheDocument();
  });

  it("skips to the next detection's own URL, flag kept", () => {
    render(<EditEventPage />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(saveVersionMock).not.toHaveBeenCalled();
    // A real address per detection: a reload keeps the place and Back steps one detection.
    expect(push).toHaveBeenCalledWith("/events/d2/edit?queue=1");
  });

  it("hands over to the next detection after a publish", async () => {
    render(<EditEventPage />);
    await publishDetection();

    await waitFor(() => expect(saveVersionMock).toHaveBeenCalledTimes(1));
    expect(saveVersionMock.mock.calls[0][0]).toBe("d1");
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/events/d2/edit?queue=1")
    );
  });

  it("hands over to the next detection after a close", async () => {
    closeMock.mockResolvedValue(detectionFixture({ status: "closed" }));
    render(<EditEventPage />);

    closeDetection("Duplicate of an earlier detection.");
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/events/d2/edit?queue=1")
    );
  });

  it("starts where the queue row was clicked", () => {
    queueItems = [
      detectionFixture({ id: "d0", title: "Earlier" }),
      detectionFixture(),
      detectionFixture({ id: "d2", title: "Second" }),
    ];
    render(<EditEventPage />);
    // A deep row opens at its own position rather than restarting at the head.
    expect(screen.getByText("Detection 2 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(push).toHaveBeenCalledWith("/events/d2/edit?queue=1");
  });

  it("ends the pass on the queue list once this was the last detection", () => {
    queueItems = [detectionFixture()];
    render(<EditEventPage />);
    expect(screen.getByText("Detection 1 of 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(push).toHaveBeenCalledWith("/profile/ana/detections");
  });

  it("drops the position for a detection the queue no longer holds", () => {
    queueItems = [detectionFixture({ id: "d9", title: "Someone else's turn" })];
    render(<EditEventPage />);
    // Published or closed in another tab: the flag is stale, so the page is a plain edit again.
    expect(screen.queryByText(/Detection \d+ of/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  });
});

describe("the publish confirm", () => {
  /** Render the form, fill the floor, and take the first (arming) click. */
  function armSubmit() {
    render(<EditEventPage />);
    fillTheFloor();
    const button = screen.getByRole("button", { name: "Publish" });
    fireEvent.click(button);
    return button;
  }

  it("arms the one button in place instead of swapping the row", () => {
    const button = armSubmit();

    // Same element, renamed: nothing is inserted before it, so the second click lands where the first did.
    expect(button).toHaveAccessibleName("Confirm publish");
    expect(screen.getByRole("button", { name: "Confirm publish" })).toBe(button);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(saveVersionMock).not.toHaveBeenCalled();
  });

  it("announces the armed state and what the next click costs", () => {
    armSubmit();
    // A live region beside the button, not a renamed control, like every copy control.
    const announcement = screen.getByText(
      "Click again to publish. Publishing makes the event public as version 1; later changes become versions."
    );
    expect(announcement).toHaveAttribute("role", "status");
    expect(announcement).toHaveAttribute("aria-live", "polite");
  });

  it("writes on the second click", async () => {
    const button = armSubmit();
    fireEvent.click(button);
    await waitFor(() => expect(saveVersionMock).toHaveBeenCalledTimes(1));
  });

  it("disarms on Escape", () => {
    const button = armSubmit();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(button).toHaveAccessibleName("Publish");
    expect(
      screen.queryByText(
        "Click again to publish. Publishing makes the event public as version 1; later changes become versions."
      )
    ).toBeNull();
  });

  it("disarms when the next click lands elsewhere", () => {
    const button = armSubmit();
    fireEvent.pointerDown(screen.getByRole("textbox", { name: /Title/ }));
    expect(button).toHaveAccessibleName("Publish");
    // And that click is spent disarming: nothing is written.
    expect(saveVersionMock).not.toHaveBeenCalled();
  });

  it("disarms on its own after a few seconds", () => {
    vi.useFakeTimers();
    try {
      const button = armSubmit();
      act(() => {
        vi.advanceTimersByTime(ARM_MS);
      });
      expect(button).toHaveAccessibleName("Publish");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("editing a published geolocation", () => {
  beforeEach(() => {
    row = publishedFixture();
  });

  it("opens the correction form instead of refusing the edit", () => {
    render(<EditEventPage />);

    // A published row reaches the form under its own title and action.
    expect(
      screen.getByRole("heading", { name: "Edit geolocation" })
    ).toBeInTheDocument();
    expect(screen.queryByText(/no longer be edited/)).toBeNull();
    expect(screen.getByRole("button", { name: "Save version 2" })).toBeInTheDocument();
    // Neither detection verb belongs here: the row is not skippable, and its close is named for the row.
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("holds the save and More actions in the actions, the note under them, the geolocators beside the byline", () => {
    render(<EditEventPage />);

    const rail = screen.getByRole("complementary", { name: "Actions" });
    const save = within(rail).getByRole("button", { name: "Save version 2" });
    const more = within(rail).getByRole("button", { name: "More actions" });
    expect(follows(save, more)).toBe(true);
    // The note is a field under the actions, not an action, over the body.
    const note = screen.getByRole("textbox", { name: "Version note" });
    expect(rail.contains(note)).toBe(false);
    const location = screen.getByRole("heading", { name: /^Location/ });
    expect(follows(note, location)).toBe(true);
    // The title section: the page heading (visually hidden), the Title field in the event title's
    // place, which joins the form from outside it, then the byline and its add button.
    const pageTitle = screen.getByRole("heading", { level: 1, name: "Edit geolocation" });
    expect(pageTitle).toHaveClass("sr-only");
    const add = screen.getByRole("button", { name: "Invite a geolocator" });
    const title = screen.getByRole("textbox", { name: /Title/ });
    expect(follows(pageTitle, title) && follows(title, add)).toBe(true);
    const form = document.getElementById("event-edit-form") as HTMLFormElement;
    expect(form.contains(title)).toBe(false);
    expect((title as HTMLInputElement).form).toBe(form);
    // The picker floats in a popover outside the edit form; nothing opens in the page.
    fireEvent.click(add);
    expect(add).toHaveAttribute("aria-expanded", "true");
    const popover = screen.getByRole("dialog", { name: "Invite a geolocator" });
    expect(form.contains(popover)).toBe(false);
    expect(screen.queryByRole("heading", { name: /^Geolocators/ })).toBeNull();
  });

  it("closes the geolocation behind its reason, then lands on the event", async () => {
    closeMock.mockResolvedValue(publishedFixture({ status: "closed" }));
    render(<EditEventPage />);

    closeRow("Close this geolocation", "Wrong town.");
    await waitFor(() => expect(closeMock).toHaveBeenCalledWith("d1", "Wrong town."));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/d1"));
  });

  it("offers the sources for correction, seeded from the row", () => {
    render(<EditEventPage />);

    // The import often picks the wrong media, so every source stays editable after publication; the
    // filed version keeps the old ones.
    expect(screen.getByRole("textbox", { name: "Source 1 link 1" })).toHaveValue(
      "https://t.me/channel/12345"
    );
    expect(screen.getByRole("button", { name: "Remove media" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a source" })).toBeInTheDocument();
  });

  it("saves on the click that made it, then lands on the event", async () => {
    render(<EditEventPage />);

    fireEvent.change(screen.getByRole("textbox", { name: /Title/ }), {
      target: { value: "Corrected title" },
    });
    // No arming step: a version is the ordinary way a published event changes.
    fireEvent.click(screen.getByRole("button", { name: "Save version 2" }));
    await waitFor(() => expect(saveVersionMock).toHaveBeenCalledTimes(1));
    expect(saveVersionMock.mock.calls[0][1].version_no).toBe(1);
    // A published row invites through its Geolocators panel, never with the save.
    expect(saveVersionMock.mock.calls[0][1]).not.toHaveProperty("geolocator_invites");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/d1"));
  });

  it("labels the provenance link of a fulfilled bot-opened request Requested from", () => {
    row = publishedFixture({ requested_by: { id: "u2", username: "bo" } });
    render(<EditEventPage />);

    expect(screen.getByText("Requested from")).toBeInTheDocument();
    expect(screen.queryByText("Detected from")).toBeNull();
  });

  it("keeps the seconds of an untouched post time and event time", async () => {
    render(<EditEventPage />);

    // Untouched inputs must not post the truncation back: each goes back at the row's own precision.
    fireEvent.change(screen.getByRole("textbox", { name: /Title/ }), {
      target: { value: "Corrected title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save version 2" }));
    await waitFor(() => expect(saveVersionMock).toHaveBeenCalledTimes(1));

    const [, input] = saveVersionMock.mock.calls[0];
    expect(input.sources[0].links[0].posted_at).toBe("2026-05-30T14:32:27Z");
    expect(input.occurred_time).toBe("14:32:27");
  });

  it("posts a post time the editor actually moved, as a version", async () => {
    render(<EditEventPage />);

    fireEvent.change(screen.getByLabelText(/^Posted \(UTC\), source 1/), {
      target: { value: "2026-05-30T15:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save version 2" }));
    await waitFor(() => expect(saveVersionMock).toHaveBeenCalledTimes(1));

    expect(saveVersionMock.mock.calls[0][1].sources[0].links[0].posted_at).toBe(
      "2026-05-30T15:00"
    );
  });

  it("posts the version note beside the whole source list", async () => {
    render(<EditEventPage />);

    fireEvent.change(screen.getByRole("textbox", { name: /Title/ }), {
      target: { value: "Corrected title" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Version note" }), {
      target: { value: "Coordinates were off by a block." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save version 2" }));
    await waitFor(() => expect(saveVersionMock).toHaveBeenCalledTimes(1));

    const [id, input] = saveVersionMock.mock.calls[0];
    expect(id).toBe("d1");
    expect(input.note).toBe("Coordinates were off by a block.");
    // An untouched source goes back with its id and its file, so it is kept, not re-filed.
    expect(input.sources).toEqual([
      expect.objectContaining({ id: "s1", media_id: "m1", kind: "drone" }),
    ]);
  });

  it("corrects a source URL as a version of its own", async () => {
    render(<EditEventPage />);

    fireEvent.change(screen.getByRole("textbox", { name: "Source 1 link 1" }), {
      target: { value: "https://t.me/channel/999" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save version 2" }));
    await waitFor(() => expect(saveVersionMock).toHaveBeenCalledTimes(1));

    expect(saveVersionMock.mock.calls[0][1].sources[0].links[0].url).toBe(
      "https://t.me/channel/999"
    );
  });

  it("refuses a save that would change nothing, without a request", async () => {
    render(<EditEventPage />);

    // The form posts the whole editable state, so an untouched save would mint a version with no changed fields; the note alone does not lift the refusal.
    fireEvent.change(screen.getByRole("textbox", { name: "Version note" }), {
      target: { value: "Read it again." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save version 2" }));

    expect(
      await screen.findByText("Nothing changed since version 1.")
    ).toBeInTheDocument();
    expect(saveVersionMock).not.toHaveBeenCalled();

    // A moved field makes it a correction again.
    fireEvent.change(screen.getByRole("textbox", { name: /Title/ }), {
      target: { value: "Corrected title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save version 2" }));
    await waitFor(() => expect(saveVersionMock).toHaveBeenCalledTimes(1));
  });

  it("still holds the published floor before it posts", async () => {
    row = publishedFixture({ conflicts: [] });
    render(<EditEventPage />);

    fireEvent.click(screen.getByRole("button", { name: "Save version 2" }));
    // The notice names the miss and writes nothing; the server enforces the same floor.
    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("Conflict");
    expect(saveVersionMock).not.toHaveBeenCalled();
  });
});

describe("editing an open request", () => {
  beforeEach(() => {
    row = requestFixture();
  });

  it("opens the one form with Publish, Save request and the close for its owner", () => {
    render(<EditEventPage />);

    expect(
      screen.getByRole("heading", { name: "Edit request" })
    ).toBeInTheDocument();
    expect(screen.queryByText(/no edit form/)).toBeNull();
    const rail = screen.getByRole("complementary", { name: "Actions" });
    expect(within(rail).getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: "Save request" })).toBeInTheDocument();
    fireEvent.click(within(rail).getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Close this request" })).toBeInTheDocument();
    // A request is version 0: nothing to supersede yet.
    expect(screen.queryByRole("button", { name: /Save version/ })).toBeNull();
  });

  it("publishes the request as version 1 and opens the event", async () => {
    row = requestFixture({ coords: { lat: 48.5, lng: 37.8 }, proof: '<img src="https://cdn.test/p.jpg">' });
    render(<EditEventPage />);

    fillTheFloor();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm publish" }));
    await waitFor(() => expect(saveVersionMock).toHaveBeenCalledTimes(1));
    expect(saveVersionMock.mock.calls[0][1].version_no).toBe(0);
    expect(updateRequestMock).not.toHaveBeenCalled();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/d1"));
  });

  it("closes the request from More actions, then lands on the request", async () => {
    closeMock.mockResolvedValue(requestFixture({ status: "closed" }));
    render(<EditEventPage />);

    closeRow("Close this request", "Found it.");
    await waitFor(() => expect(closeMock).toHaveBeenCalledWith("d1", "Found it."));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/requests/d1"));
  });

  it("offers the fields the request was opened with, seeded from the row", () => {
    render(<EditEventPage />);

    expect(screen.getByRole("textbox", { name: /Title/ })).toHaveValue("Strike near Bakhmut");
    expect(screen.getByRole("textbox", { name: "Source 1 link 1" })).toHaveValue(
      "https://t.me/channel/12345"
    );
    // A request's sources are not locked: footage is swappable as on the published edit.
    expect(screen.getByRole("button", { name: "Remove media" })).toBeInTheDocument();
  });

  it("overwrites the request and lands back on it", async () => {
    render(<EditEventPage />);
    // Saving the request sends no invitation: only the publish does.
    pickCoGeolocator("dee");

    fireEvent.change(screen.getByRole("textbox", { name: /Title/ }), {
      target: { value: "Corrected ask" },
    });
    // No arming step and no version: the edit overwrites the question.
    fireEvent.click(screen.getByRole("button", { name: "Save request" }));
    await waitFor(() => expect(updateRequestMock).toHaveBeenCalledTimes(1));
    expect(updateRequestMock.mock.calls[0][0]).toBe("d1");
    expect(updateRequestMock.mock.calls[0][1]).toMatchObject({
      title: "Corrected ask",
      sources: [{ id: "s1", media_id: "m1", links: [{ url: "https://t.me/channel/12345" }] }],
    });
    expect(updateRequestMock.mock.calls[0][1]).not.toHaveProperty("geolocator_invites");
    expect(saveVersionMock).not.toHaveBeenCalled();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/requests/d1"));
  });

  it("saves a request whose source is of unknown kind", async () => {
    // Unknown is a kind like any other: the request saves with it.
    render(<EditEventPage />);

    fireEvent.click(screen.getByRole("button", { name: "Save request" }));
    await waitFor(() => expect(updateRequestMock).toHaveBeenCalledTimes(1));
    expect(updateRequestMock.mock.calls[0][1].sources[0].kind).toBe("unknown");
  });

  it("labels the post the bot opened the request from Requested from", () => {
    row = requestFixture({ detected_from_url: "https://x.com/analyst/status/1" });
    render(<EditEventPage />);

    expect(screen.getByText("Requested from")).toBeInTheDocument();
    expect(screen.queryByText("Detected from")).toBeNull();
  });

  it("covers the footage of a flagged source behind the age gate", () => {
    // The owner can meet footage here they have never seen: a flagged source's file is covered as on other pages.
    row = requestFixture({ sources: [source({ kind: "unknown", is_graphic: true })] });
    render(<EditEventPage />);

    expect(
      screen.getByRole("button", { name: "Show graphic content (18 or older)" })
    ).toBeInTheDocument();
  });

  it("lets a visitor publish it, without the owner's save and close", () => {
    auth.user = VISITOR;
    render(<EditEventPage />);

    expect(
      screen.getByRole("heading", { name: "Geolocate request" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close this request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });

  it("holds the request floor before it posts", () => {
    render(<EditEventPage />);

    fireEvent.change(screen.getByRole("textbox", { name: /Title/ }), {
      target: { value: "  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save request" }));
    expect(updateRequestMock).not.toHaveBeenCalled();
  });
});

describe("a state with no owner edit", () => {
  it("says so instead of offering a form", () => {
    row = detectionFixture({ status: "closed", close_reason: "AI-generated." });
    render(<EditEventPage />);

    expect(screen.getByText(/no edit form/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save version 2" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });

  it("sends a visitor of someone else's detection to the event", () => {
    auth.user = VISITOR;
    render(<EditEventPage />);

    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.getByRole("link", { name: "View this event" })).toHaveAttribute(
      "href",
      "/events/d1"
    );
  });
});
