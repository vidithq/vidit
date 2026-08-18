import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The two surfaces jsdom can't mount: the map canvas needs WebGL and the Tiptap
// editor needs DOM APIs it lacks. Both keep a marker, since "the review is the
// whole edit form, proof editor included" is one of the things this covers.
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

vi.mock("@/hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({ user: { id: "u1", username: "ana" }, loading: false }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", username: "ana" } }),
}));

vi.mock("@/contexts/DetectionsContext", () => ({
  useDetectionsCount: () => ({ count: 2, refresh: vi.fn() }),
}));

// Every read the surface makes, answered by path: the row itself, the queue it
// is being reviewed in, and the taxonomy the Classification block offers.
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
  closeEvent: vi.fn(),
}));

import { closeEvent, geolocateEvent } from "@/lib/events";
import { ARM_MS } from "@/hooks/useConfirmAction";
import type { Conflict, EventDetail, Tag } from "@/types";

import EditEventPage from "./page";

const geolocateMock = vi.mocked(geolocateEvent);
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
    is_graphic: false,
    close_reason: null,
    before_closed_status: null,
    detected_from_url: "https://x.com/analyst/status/1",
    detected_via: null,
    detected_post_at: "2026-05-30T15:00:00Z",
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
    updated_at: "2026-06-02T10:00:00Z",
    requested_at: null,
    detected_at: "2026-06-02T10:00:00Z",
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

/** The queue this detection is being walked through: itself, then two more. */
let queueItems: EventDetail[] = [];

function resource(path: string) {
  if (path.startsWith("/events/d1")) return detectionFixture();
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

/** Fill the floor, then submit: the first click arms the button in place, the
 *  second one writes. */
async function submitDetection() {
  fillTheFloor();
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm submit" }));
}

/** Reject the detection on screen, through its confirm-with-reason panel. */
function rejectDetection(reason: string) {
  fireEvent.click(screen.getByRole("button", { name: "Reject" }));
  fireEvent.change(screen.getByLabelText(/Reject reason/), {
    target: { value: reason },
  });
  fireEvent.click(screen.getByRole("button", { name: "Reject this detection" }));
}

beforeEach(() => {
  push.mockReset();
  geolocateMock.mockReset();
  closeMock.mockReset();
  geolocateMock.mockResolvedValue(detectionFixture({ status: "geolocated" }));
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
    expect(screen.queryByText(/Submitting freezes the row/)).toBeNull();
    // The flow action stands alone at the foot: no Cancel, and no Reject
    // beside it.
    const submit = screen.getByRole("button", { name: "Submit" });
    expect(submit).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Cancel" })).toBeNull();

    // Reject is a plain button up in the action area, ahead of the fields, and
    // never a menu entry behind a ⋯ disclosure.
    const reject = screen.getByRole("button", { name: "Reject" });
    expect(
      reject.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });

  it("rejects the detection behind its reason panel", async () => {
    closeMock.mockResolvedValue(detectionFixture({ status: "closed" }));
    render(<EditEventPage />);

    rejectDetection("Not a strike.");
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
    // A real address per detection: a reload keeps the place, and Back steps back
    // one detection.
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

  it("hands over to the next detection after a rejection", async () => {
    closeMock.mockResolvedValue(detectionFixture({ status: "closed" }));
    render(<EditEventPage />);

    rejectDetection("Duplicate of an earlier detection.");
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
    // A row deep in the queue opens at its own position and walks on from
    // there, rather than restarting the pass at the head.
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
    // Published or rejected in another tab: the flag is stale, so the page is
    // a plain edit again rather than claiming a position it doesn't have.
    expect(screen.queryByText(/Detection \d+ of/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  });
});

describe("the submit confirm", () => {
  /** Render the form, fill the floor, and take the first click, which arms
   *  the button. */
  function armSubmit() {
    render(<EditEventPage />);
    fillTheFloor();
    const button = screen.getByRole("button", { name: "Submit" });
    fireEvent.click(button);
    return button;
  }

  it("arms the one button in place instead of swapping the row", () => {
    const button = armSubmit();

    // Same element, renamed: no confirm pair appears beside it and nothing is
    // inserted before it, so the second click lands where the first one did.
    expect(button).toHaveAccessibleName("Confirm submit");
    expect(screen.getByRole("button", { name: "Confirm submit" })).toBe(button);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(geolocateMock).not.toHaveBeenCalled();
  });

  it("announces the armed state and what the next click costs", () => {
    armSubmit();
    // A live region beside the button, not a renamed control: the reader hears
    // the state and what it costs, in the shape `<CopyButton>` already uses.
    const announcement = screen.getByText(
      "Click again to submit. Submitting freezes the event."
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
      screen.queryByText("Click again to submit. Submitting freezes the event.")
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
