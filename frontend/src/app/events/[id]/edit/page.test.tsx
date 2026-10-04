import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// jsdom cannot mount the map canvas (WebGL) or the Tiptap editor (DOM APIs); both keep a marker.
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
  geolocateEvent: vi.fn(),
  saveVersion: vi.fn(),
  updateEventRequest: vi.fn(),
  closeEvent: vi.fn(),
}));

import {
  closeEvent,
  geolocateEvent,
  saveVersion,
  updateEventRequest,
} from "@/lib/events";
import { ARM_MS } from "@/hooks/useConfirmAction";
import type { Conflict, EventDetail, Tag } from "@/types";

import EditEventPage from "./page";

const geolocateMock = vi.mocked(geolocateEvent);
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
    ongoing: true,
    tier: "major",
  },
];

const CURATED_TAGS: Tag[] = [
  { id: "t-drone", name: "Drone", category: "capture_source" },
];

function detectionFixture(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: "d1",
    title: "Strike near Bakhmut",
    event_coords: { lat: 48.5, lng: 37.8 },
    capture_source_coords: null,
    archived_source: null,
    archived_detected_from: null,
    event_date: "2026-06-01",
    event_time: null,
    source_posted_at: "2026-05-30T14:32:00Z",
    status: "detected",
    version_no: 1,
    is_graphic: false,
    close_reason: null,
    before_closed_status: null,
    detected_from_url: "https://x.com/analyst/status/1",
    detected_via: null,
    owner: { id: "u1", username: "ana" },
    tags: [],
    conflicts: [],
    source_url: "https://t.me/channel/12345",
    secondary_source_urls: [],
    archived_secondary_sources: [],
    proof: {
      type: "doc",
      content: [{ type: "image", attrs: { src: "https://cdn.test/p.jpg" } }],
    },
    created_at: "2026-06-02T10:00:00Z",
    geolocated_at: null,
    closed_at: null,
    media: [
      {
        id: "m1",
        storage_url: "/local-storage/evidence.jpg",
        media_type: "image",
        role: "source",
      },
    ],
    thumbnail: null,
    requested_by: null,
    geolocators: [],
    ...overrides,
  };
}

/** A published geolocation the owner is correcting, with the curated picks a publication required. */
function publishedFixture(overrides: Partial<EventDetail> = {}): EventDetail {
  return detectionFixture({
    status: "geolocated",
    version_no: 1,
    geolocated_at: "2026-06-02T11:00:00Z",
    // Both carry seconds, which the form inputs lack: an untouched save must not post the truncation back.
    source_posted_at: "2026-05-30T14:32:27Z",
    event_time: "14:32:27",
    tags: CURATED_TAGS,
    conflicts: CONFLICTS,
    ...overrides,
  });
}

/** An open request its owner is correcting: no coordinate, footage attached, no curated picks. */
function requestFixture(overrides: Partial<EventDetail> = {}): EventDetail {
  return detectionFixture({
    status: "requested",
    event_coords: null,
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
  if (path.startsWith("/events/d1")) return row;
  if (path.startsWith("/events/detections"))
    return { items: queueItems, total: queueItems.length, page: 1, per_page: 100 };
  if (path === "/tags?curated=true") return CURATED_TAGS;
  if (path === "/conflicts") return CONFLICTS;
  return null;
}

/** Make the two curated picks the publish floor asks for. */
function fillTheFloor() {
  fireEvent.click(
    screen.getByRole("button", { name: /Russian invasion of Ukraine/ })
  );
  fireEvent.click(screen.getByRole("button", { name: "Drone" }));
}

/** Fill the floor, then submit (the first click arms, the second writes). */
async function submitDetection() {
  fillTheFloor();
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm submit" }));
}

/** Close the detection on screen, through its confirm-with-reason panel. */
function closeDetection(reason: string) {
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.change(screen.getByLabelText(/Close reason/), {
    target: { value: reason },
  });
  fireEvent.click(screen.getByRole("button", { name: "Close this detection" }));
}

beforeEach(() => {
  push.mockReset();
  geolocateMock.mockReset();
  saveVersionMock.mockReset();
  updateRequestMock.mockReset();
  closeMock.mockReset();
  geolocateMock.mockResolvedValue(detectionFixture({ status: "geolocated" }));
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
  it("renders the form under a bare title, with Submit alone at the foot", () => {
    render(<EditEventPage />);

    expect(
      screen.getByRole("heading", { name: "Submit detection" })
    ).toBeInTheDocument();
    // No description line under the title: the fields say what they are.
    expect(screen.queryByText(/Submitting publishes the event/)).toBeNull();
    // The flow action stands alone at the foot: no Cancel, no Close.
    const submit = screen.getByRole("button", { name: "Submit" });
    expect(submit).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Cancel" })).toBeNull();

    // Close is a plain button in the action area, not behind a disclosure.
    const close = screen.getByRole("button", { name: "Close" });
    expect(
      close.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
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

  it("returns to the queue list after a submit made outside a pass", async () => {
    render(<EditEventPage />);
    await submitDetection();
    await waitFor(() => expect(geolocateMock).toHaveBeenCalledTimes(1));
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
    expect(geolocateMock).not.toHaveBeenCalled();
    // A real address per detection: a reload keeps the place and Back steps one detection.
    expect(push).toHaveBeenCalledWith("/events/d2/edit?queue=1");
  });

  it("hands over to the next detection after a submit", async () => {
    render(<EditEventPage />);
    await submitDetection();

    await waitFor(() => expect(geolocateMock).toHaveBeenCalledTimes(1));
    expect(geolocateMock.mock.calls[0][0]).toBe("d1");
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

describe("the submit confirm", () => {
  /** Render the form, fill the floor, and take the first (arming) click. */
  function armSubmit() {
    render(<EditEventPage />);
    fillTheFloor();
    const button = screen.getByRole("button", { name: "Submit" });
    fireEvent.click(button);
    return button;
  }

  it("arms the one button in place instead of swapping the row", () => {
    const button = armSubmit();

    // Same element, renamed: nothing is inserted before it, so the second click lands where the first did.
    expect(button).toHaveAccessibleName("Confirm submit");
    expect(screen.getByRole("button", { name: "Confirm submit" })).toBe(button);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(geolocateMock).not.toHaveBeenCalled();
  });

  it("announces the armed state and what the next click costs", () => {
    armSubmit();
    // A live region beside the button, not a renamed control, like every copy control.
    const announcement = screen.getByText(
      "Click again to submit. Submitting publishes the event; later changes become versions."
    );
    expect(announcement).toHaveAttribute("role", "status");
    expect(announcement).toHaveAttribute("aria-live", "polite");
  });

  it("writes on the second click", async () => {
    const button = armSubmit();
    fireEvent.click(button);
    await waitFor(() => expect(geolocateMock).toHaveBeenCalledTimes(1));
  });

  it("disarms on Escape", () => {
    const button = armSubmit();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(button).toHaveAccessibleName("Submit");
    expect(
      screen.queryByText(
        "Click again to submit. Submitting publishes the event; later changes become versions."
      )
    ).toBeNull();
  });

  it("disarms when the next click lands elsewhere", () => {
    const button = armSubmit();
    fireEvent.pointerDown(screen.getByRole("textbox", { name: /Title/ }));
    expect(button).toHaveAccessibleName("Submit");
    // And that click is spent disarming: nothing is written.
    expect(geolocateMock).not.toHaveBeenCalled();
  });

  it("disarms on its own after a few seconds", () => {
    vi.useFakeTimers();
    try {
      const button = armSubmit();
      act(() => {
        vi.advanceTimersByTime(ARM_MS);
      });
      expect(button).toHaveAccessibleName("Submit");
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
    // Neither verb belongs here: the row is not skippable and its close is on the detail page.
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("offers the evidence anchor for correction, seeded from the row", () => {
    render(<EditEventPage />);

    // The import often picks the wrong media, so both halves stay editable after publication; the filed version keeps the old ones.
    expect(screen.getByRole("textbox", { name: /Source URL/ })).toHaveValue(
      "https://t.me/channel/12345"
    );
    // Remove opens the picker: an event carries one source media, so a swap is a removal then an upload.
    expect(
      screen.getByRole("button", { name: "Remove media" })
    ).toBeInTheDocument();
  });

  it("saves on the click that made it, then lands on the event", async () => {
    render(<EditEventPage />);

    fireEvent.change(screen.getByRole("textbox", { name: /Title/ }), {
      target: { value: "Corrected title" },
    });
    // No arming step: a version is the ordinary way a published event changes.
    fireEvent.click(screen.getByRole("button", { name: "Save version 2" }));
    await waitFor(() => expect(saveVersionMock).toHaveBeenCalledTimes(1));
    expect(geolocateMock).not.toHaveBeenCalled();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/d1"));
  });

  it("keeps the seconds of an untouched source post time and event time", async () => {
    render(<EditEventPage />);

    // Untouched inputs must not post the truncation back: the instant is omitted (keep the row's), the time goes back at its own precision.
    fireEvent.change(screen.getByRole("textbox", { name: /Title/ }), {
      target: { value: "Corrected title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save version 2" }));
    await waitFor(() => expect(saveVersionMock).toHaveBeenCalledTimes(1));

    const [, input] = saveVersionMock.mock.calls[0];
    expect(input.source_posted_at).toBe("");
    expect(input.event_time).toBe("14:32:27");
  });

  it("posts a source post time the editor actually moved", async () => {
    render(<EditEventPage />);

    // The label carries its own `?` button, so the query is narrowed to the input.
    fireEvent.change(screen.getByLabelText(/^Source posted/, { selector: "input" }), {
      target: { value: "2026-05-30T15:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save version 2" }));
    await waitFor(() => expect(saveVersionMock).toHaveBeenCalledTimes(1));

    expect(saveVersionMock.mock.calls[0][1].source_posted_at).toBe("2026-05-30T15:00");
  });

  it("posts the version note beside the evidence anchor", async () => {
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
    // The anchor rides along (the endpoint declares it): an untouched form posts the held source, no media swap.
    expect(input.source_url).toBe("https://t.me/channel/12345");
    expect(input.files).toEqual([]);
    expect(input.remove_media_ids).toEqual([]);
  });

  it("corrects the source URL as a version of its own", async () => {
    render(<EditEventPage />);

    fireEvent.change(screen.getByRole("textbox", { name: /Source URL/ }), {
      target: { value: "https://t.me/channel/999" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save version 2" }));
    await waitFor(() => expect(saveVersionMock).toHaveBeenCalledTimes(1));

    expect(saveVersionMock.mock.calls[0][1].source_url).toBe(
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

  it("opens the request form instead of refusing the edit", () => {
    render(<EditEventPage />);

    expect(
      screen.getByRole("heading", { name: "Edit request" })
    ).toBeInTheDocument();
    expect(screen.queryByText(/no edit form/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Save request" })
    ).toBeInTheDocument();
    // A request files no version and is answered through the submit form, so neither published verb applies.
    expect(screen.queryByRole("button", { name: /Save version/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
  });

  it("offers the fields the request was opened with, seeded from the row", () => {
    render(<EditEventPage />);

    expect(screen.getByRole("textbox", { name: /Title/ })).toHaveValue(
      "Strike near Bakhmut"
    );
    expect(screen.getByRole("textbox", { name: /Source URL/ })).toHaveValue(
      "https://t.me/channel/12345"
    );
    // Footage is swappable as on the published edit: Remove opens the picker.
    expect(
      screen.getByRole("button", { name: "Remove media" })
    ).toBeInTheDocument();
  });

  it("overwrites the request and lands back on it", async () => {
    render(<EditEventPage />);

    fireEvent.change(screen.getByRole("textbox", { name: /Title/ }), {
      target: { value: "Corrected ask" },
    });
    // No arming step and no version: the edit overwrites the question.
    fireEvent.click(screen.getByRole("button", { name: "Save request" }));
    await waitFor(() => expect(updateRequestMock).toHaveBeenCalledTimes(1));
    expect(updateRequestMock.mock.calls[0][0]).toBe("d1");
    expect(updateRequestMock.mock.calls[0][1]).toMatchObject({
      title: "Corrected ask",
      source_url: "https://t.me/channel/12345",
    });
    expect(saveVersionMock).not.toHaveBeenCalled();
    expect(geolocateMock).not.toHaveBeenCalled();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/requests/d1"));
  });

  it("saves a request the bot opened with no source instant", async () => {
    // The bot may open a request with no readable source date, so the instant is not in the floor.
    row = requestFixture({ source_posted_at: null });
    render(<EditEventPage />);

    fireEvent.click(screen.getByRole("button", { name: "Save request" }));
    await waitFor(() => expect(updateRequestMock).toHaveBeenCalledTimes(1));
    expect(updateRequestMock.mock.calls[0][1].source_posted_at).toBe("");
  });

  it("covers the footage of a flagged request behind the age gate", () => {
    // The owner can meet footage here they have never seen: a flagged row's media is covered as on other pages.
    row = requestFixture({ is_graphic: true });
    render(<EditEventPage />);

    expect(
      screen.getByRole("button", { name: "Show graphic content (18 or older)" })
    ).toBeInTheDocument();
  });

  it("sends a visitor to the request rather than an edit form", () => {
    auth.user = VISITOR;
    render(<EditEventPage />);

    // Owner-only (403 server-side); the way out names the surface a request reads on.
    expect(screen.queryByRole("button", { name: "Save request" })).toBeNull();
    expect(screen.getByRole("link", { name: "View this request" })).toHaveAttribute(
      "href",
      "/requests/d1"
    );
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
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
  });
});
