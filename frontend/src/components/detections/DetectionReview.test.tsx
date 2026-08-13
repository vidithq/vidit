import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DetectionReview } from "./DetectionReview";
import { geolocateEvent } from "@/lib/events";
import type { Conflict, EventDetail, Tag } from "@/types";

// The map canvas needs WebGL, which jsdom has none of, and the review only
// reads a point off it. The rest of the flow is what these tests are about.
vi.mock("@/components/map/Map", () => ({
  default: () => <div data-testid="map" />,
}));

// Only the publish call is faked: the floor computation, the payload assembly
// and the sticky picks are the code under test.
vi.mock("@/lib/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events")>()),
  geolocateEvent: vi.fn(),
}));

const geolocateMock = vi.mocked(geolocateEvent);

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
    thumbnail: {
      id: "m1",
      storage_url: "/local-storage/evidence.jpg",
      media_type: "image",
      role: "source",
    },
    requested_by: null,
    geolocators: [],
    investigator_count: 0,
    investigators: [],
    ...overrides,
  };
}

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
  { id: "t-free", name: "Artillery", category: "free" },
];

function renderReview(drafts: EventDetail[], total = drafts.length) {
  return render(
    <DetectionReview
      drafts={drafts}
      total={total}
      curatedTags={CURATED_TAGS}
      conflicts={CONFLICTS}
      queueHref="/profile/ana/detections"
      onReload={() => {}}
    />
  );
}

// Role-scoped, because every field label carries a `?` help button whose
// accessible name repeats the label text.
const titleField = () => screen.getByRole("textbox", { name: /Title/ });
const captureSourceField = () =>
  screen.getByRole("combobox", { name: /Capture source/ });

/** Make the two human picks the floor asks for on the draft on screen. */
function pickConflictAndCaptureSource() {
  fireEvent.click(screen.getByRole("button", { name: /Russian invasion of Ukraine/ }));
  fireEvent.change(captureSourceField(), { target: { value: "t-drone" } });
}

beforeEach(() => {
  geolocateMock.mockReset();
  geolocateMock.mockResolvedValue(draftFixture({ status: "geolocated" }));
});

describe("DetectionReview", () => {
  it("shows one draft at a time with its position in the queue", () => {
    renderReview([draftFixture(), draftFixture({ id: "d2", title: "Second draft" })]);
    expect(screen.getByText("Draft 1 of 2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Strike near Bakhmut")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Second draft")).not.toBeInTheDocument();
  });

  it("heads the session with the shortcut legend, above the draft", () => {
    renderReview([draftFixture()]);
    const legend = screen.getByText("publish");
    expect(legend).toBeInTheDocument();
    expect(screen.getByText("skip")).toBeInTheDocument();
    expect(screen.getByText("reject")).toBeInTheDocument();
    // Above the draft body, so it is on screen without a scroll: a shortcut
    // parked under the fold is one nobody learns.
    expect(
      legend.compareDocumentPosition(titleField()) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("publishes through the single-row geolocate transition and advances", async () => {
    renderReview([draftFixture(), draftFixture({ id: "d2", title: "Second draft" })]);
    pickConflictAndCaptureSource();
    fireEvent.change(titleField(), { target: { value: "Reviewed title" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(geolocateMock).toHaveBeenCalledTimes(1));
    const [id, input] = geolocateMock.mock.calls[0];
    expect(id).toBe("d1");
    expect(input).toMatchObject({
      title: "Reviewed title",
      lat: 48.5,
      lng: 37.8,
      source_url: "https://t.me/channel/12345",
      event_date: "2026-06-01",
      conflict_ids: ["c1"],
      tag_ids: ["t-drone"],
      // The review writes no media and no proof files: the draft keeps what the
      // import gave it.
      remove_media_ids: [],
      files: [],
      proof_files: [],
    });

    // The published row is behind us; the next draft is on screen.
    await waitFor(() =>
      expect(screen.getByDisplayValue("Second draft")).toBeInTheDocument()
    );
    expect(screen.getByText("Draft 2 of 2")).toBeInTheDocument();
  });

  it("carries the conflict and capture source to the next draft", async () => {
    renderReview([draftFixture(), draftFixture({ id: "d2", title: "Second draft" })]);
    pickConflictAndCaptureSource();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() =>
      expect(screen.getByDisplayValue("Second draft")).toBeInTheDocument()
    );

    // Both picks are still made, so the second draft publishes with no further
    // input.
    expect(captureSourceField()).toHaveValue("t-drone");
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(geolocateMock).toHaveBeenCalledTimes(2));
    expect(geolocateMock.mock.calls[1][1]).toMatchObject({
      conflict_ids: ["c1"],
      tag_ids: ["t-drone"],
    });
  });

  it("keeps the draft's own tags and replaces only the capture source", async () => {
    renderReview([
      draftFixture({
        tags: [
          { id: "t-free", name: "Artillery", category: "free" },
          { id: "t-old", name: "Ground", category: "capture_source" },
        ],
      }),
    ]);
    pickConflictAndCaptureSource();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(geolocateMock).toHaveBeenCalledTimes(1));
    expect(geolocateMock.mock.calls[0][1].tag_ids).toEqual(["t-free", "t-drone"]);
  });

  it("blocks a draft missing evidence the review can't supply", () => {
    renderReview([draftFixture({ media: [], source_url: null })]);
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(
      screen.getByText(/missing source url, source media/i)
    ).toBeInTheDocument();
    // Skip is the way past it, and the full form is offered by name.
    expect(screen.getByRole("button", { name: "Skip" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "open the full form" })).toHaveAttribute(
      "href",
      "/events/d1/edit"
    );
  });

  it("lists the picks still missing instead of publishing a half-filled row", () => {
    renderReview([draftFixture()]);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(geolocateMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Conflict");
    expect(screen.getByRole("alert")).toHaveTextContent("Capture source tag");
  });

  it("drives the queue from the keyboard", async () => {
    renderReview([draftFixture(), draftFixture({ id: "d2", title: "Second draft" })]);

    // S skips without publishing.
    fireEvent.keyDown(window, { key: "s" });
    expect(geolocateMock).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Second draft")).toBeInTheDocument();

    // X opens the disposal panel, and the shortcuts stand down while it is up.
    fireEvent.keyDown(window, { key: "x" });
    expect(screen.getByLabelText("Reject reason")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(geolocateMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    pickConflictAndCaptureSource();
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(geolocateMock).toHaveBeenCalledTimes(1));
    expect(geolocateMock.mock.calls[0][0]).toBe("d2");
  });

  it("leaves the shortcuts alone while a field has focus", () => {
    renderReview([draftFixture(), draftFixture({ id: "d2", title: "Second draft" })]);
    fireEvent.keyDown(titleField(), { key: "s" });
    expect(screen.getByDisplayValue("Strike near Bakhmut")).toBeInTheDocument();
  });

  it("closes the session when the batch runs out", () => {
    renderReview([draftFixture()], 4);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByText("You reached the end of this batch.")).toBeInTheDocument();
    expect(screen.getByText(/3 more drafts are waiting/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Review the next batch" })
    ).toBeInTheDocument();
  });
});
