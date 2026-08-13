import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The review renders the shared edit form, so the two surfaces jsdom can't
// mount are stubbed: the map canvas needs WebGL, and the Tiptap editor needs
// DOM APIs jsdom lacks. Both keep a marker, since "the proof editor is on the
// page" is one of the things these tests are about.
vi.mock("@/components/map/Map", () => ({
  default: () => <div data-testid="map" />,
}));
vi.mock("@/components/editor/ProofEditor", () => ({
  default: () => <div data-testid="proof-editor" />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ username: "ana" }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", username: "ana" } }),
}));

const refreshDetectionCount = vi.fn();
vi.mock("@/contexts/DetectionsContext", () => ({
  useDetectionsCount: () => ({ count: 2, refresh: refreshDetectionCount }),
}));

// The taxonomy the form's Classification block fetches. Everything else the
// form reads comes from the draft it is given.
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => ({
    data:
      path === "/tags?curated=true"
        ? CURATED_TAGS
        : path === "/conflicts"
          ? CONFLICTS
          : null,
    error: null,
    refetch: () => {},
  }),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: vi.fn().mockResolvedValue([]),
}));

// Only the publish call is faked: the payload assembly and the queue's own
// stepping are the code under test.
vi.mock("@/lib/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events")>()),
  geolocateEvent: vi.fn(),
  closeEvent: vi.fn(),
}));

import { closeEvent, geolocateEvent } from "@/lib/events";
import type { Conflict, EventDetail, Tag } from "@/types";

import { DetectionReview } from "./DetectionReview";

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

function draftFixture(overrides: Partial<EventDetail> = {}): EventDetail {
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

function renderReview(drafts: EventDetail[], total = drafts.length) {
  return render(
    <DetectionReview
      drafts={drafts}
      total={total}
      queueHref="/profile/ana/detections"
      onReload={() => {}}
    />
  );
}

// Role-scoped, because every field label carries a `?` help button whose
// accessible name repeats the label text.
const titleField = () => screen.getByRole("textbox", { name: /Title/ });

/** Make the two curated picks the publish floor asks for, then submit through
 *  the form's confirm step. */
async function publishCurrentDraft() {
  fireEvent.click(
    screen.getByRole("button", { name: /Russian invasion of Ukraine/ })
  );
  fireEvent.click(screen.getByRole("button", { name: "Drone" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Confirm & submit" })
  );
}

beforeEach(() => {
  geolocateMock.mockReset();
  closeMock.mockReset();
  geolocateMock.mockResolvedValue(draftFixture({ status: "geolocated" }));
});

describe("DetectionReview", () => {
  it("reviews a draft on the shared edit form, proof editor included", async () => {
    renderReview([draftFixture()]);

    // The whole edit surface, not a subset: its header, its source media, its
    // location, its details, its classification, and the proof editor the
    // review used to render read-only.
    expect(
      screen.getByRole("heading", { name: "Submit detection" })
    ).toBeInTheDocument();
    expect(titleField()).toHaveValue("Strike near Bakhmut");
    expect(
      screen.getByDisplayValue("https://t.me/channel/12345")
    ).toBeInTheDocument();
    expect(await screen.findByTestId("proof-editor")).toBeInTheDocument();
  });

  it("shows the position in the queue and no way back but the arrow", () => {
    renderReview([draftFixture(), draftFixture({ id: "d2", title: "Second" })]);
    expect(screen.getByText(/Draft 1 of 2/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Strike near Bakhmut")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Second")).not.toBeInTheDocument();
    // Leaving the session is the header's back arrow, so the flow carries
    // neither a queue link nor the form's own Cancel.
    expect(screen.queryByText("Back to the queue")).toBeNull();
    expect(screen.queryByRole("link", { name: "Cancel" })).toBeNull();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("publishes through the geolocate transition and advances to the next draft", async () => {
    renderReview([draftFixture(), draftFixture({ id: "d2", title: "Second" })]);
    fireEvent.change(titleField(), { target: { value: "Reviewed title" } });
    await publishCurrentDraft();

    await waitFor(() => expect(geolocateMock).toHaveBeenCalledTimes(1));
    const [id, input] = geolocateMock.mock.calls[0];
    expect(id).toBe("d1");
    expect(input).toMatchObject({
      title: "Reviewed title",
      lat: 48.5,
      lng: 37.8,
      source_url: "https://t.me/channel/12345",
      conflict_ids: ["c1"],
      tag_ids: ["t-drone"],
    });

    // The published row is behind us; the next draft is on screen, on a fresh
    // form.
    await waitFor(() =>
      expect(screen.getByDisplayValue("Second")).toBeInTheDocument()
    );
    expect(screen.getByText(/Draft 2 of 2/)).toBeInTheDocument();
  });

  it("skips to the next draft without writing", () => {
    renderReview([draftFixture(), draftFixture({ id: "d2", title: "Second" })]);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(geolocateMock).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Second")).toBeInTheDocument();
    expect(screen.getByText(/Draft 2 of 2/)).toBeInTheDocument();
  });

  it("advances after a rejection instead of leaving for the queue", async () => {
    closeMock.mockResolvedValue(draftFixture({ status: "closed" }));
    renderReview([draftFixture(), draftFixture({ id: "d2", title: "Second" })]);
    fireEvent.click(screen.getByRole("button", { name: "Reject detection" }));
    fireEvent.change(screen.getByLabelText(/Reject reason/), {
      target: { value: "Not a strike." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Reject this detection" })
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue("Second")).toBeInTheDocument()
    );
  });

  it("closes the session when the batch runs out", () => {
    renderReview([draftFixture()], 4);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(
      screen.getByText("You reached the end of this batch.")
    ).toBeInTheDocument();
    expect(screen.getByText(/3 more drafts are waiting/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Review the next batch" })
    ).toBeInTheDocument();
  });
});
