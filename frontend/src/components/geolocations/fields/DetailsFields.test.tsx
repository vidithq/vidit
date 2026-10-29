import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  apiFetch: vi.fn(),
}));

import { apiFetch } from "@/lib/api";
import type { Conflict } from "@/types";
import { DetailsFields } from "./DetailsFields";

const baseProps = {
  eventDate: "",
  setEventDate: () => {},
  eventTime: "",
  setEventTime: () => {},
  taxonomy: {
    conflicts: [],
    blockedMessage: null,
    tags: [],
    setTags: () => {},
    suggestedTags: [],
    reloadConflicts: () => {},
    conflictsError: null,
  },
  selectedTagIds: [],
  setSelectedTagIds: () => {},
  selectedConflictIds: [],
  setSelectedConflictIds: () => {},
  lat: "",
  lng: "",
};

const conflict = (id: string, name: string): Conflict => ({
  id,
  name,
  wikidata_id: null,
  start_year: null,
  end_year: null,
  is_ongoing: true,
  tier: null,
});

describe("DetailsFields", () => {
  it("suggests the conflicts of the published events near the coordinates, most frequent first", async () => {
    vi.useFakeTimers();
    vi.mocked(apiFetch).mockResolvedValue([
      { conflicts: [{ id: "c1" }] },
      { conflicts: [{ id: "c2" }] },
      { conflicts: [{ id: "c2" }] },
    ]);
    const taxonomy = {
      ...baseProps.taxonomy,
      conflicts: [conflict("c1", "Alpha war"), conflict("c2", "Beta war")],
    };
    render(<DetailsFields {...baseProps} taxonomy={taxonomy} lat="48.5" lng="37.8" />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    vi.useRealTimers();

    const path = String(vi.mocked(apiFetch).mock.calls[0][0]);
    expect(path).toMatch(/^\/events\?status=geolocated&limit=100&bbox=48\.25,37\.55,48\.75,38\.05$/);
    const group = screen.getByRole("group", { name: "Suggested conflict" });
    expect(group).toHaveTextContent(/Beta war.*Alpha war/);
  });

  it("reads no events while the coordinates hold no valid pair", async () => {
    vi.useFakeTimers();
    vi.mocked(apiFetch).mockClear();
    render(<DetailsFields {...baseProps} lat="48.5" lng="" />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    vi.useRealTimers();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("renders the two dates and their ? help", () => {
    render(<DetailsFields {...baseProps} />);
    expect(screen.getByText("Event date")).toBeInTheDocument();
    expect(screen.getByText("Event time")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is the event date?" })).toBeInTheDocument();
    // The sources carry their own links and times.
    expect(screen.queryByText(/Source posted/)).toBeNull();
  });

  it("carries no optional marker on the event date and event time", () => {
    render(<DetailsFields {...baseProps} />);
    for (const field of ["Event date", "Event time"]) {
      expect(screen.getByText(field).closest("label")).not.toHaveTextContent("optional");
    }
  });

  it("reports a typed date", () => {
    const setEventDate = vi.fn();
    render(<DetailsFields {...baseProps} setEventDate={setEventDate} />);
    fireEvent.change(document.getElementById("occurred_date")!, {
      target: { value: "2026-03-14" },
    });
    expect(setEventDate).toHaveBeenCalledWith("2026-03-14");
  });

  it("turns the provenance URL into a link, without an editable field", () => {
    render(<DetailsFields {...baseProps} detectedFromUrl="https://x.com/analyst/status/1" />);
    const link = screen.getByRole("link", { name: "https://x.com/analyst/status/1" });
    expect(link).toHaveAttribute("href", "https://x.com/analyst/status/1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByDisplayValue("https://x.com/analyst/status/1")).toBeNull();
    expect(screen.getByText(/provenance, can't change/)).toBeInTheDocument();
    expect(screen.getByText("Detected from")).toBeInTheDocument();
  });

  it("labels a bot-opened request's provenance as where it was requested from", () => {
    render(
      <DetailsFields {...baseProps} detectedFromUrl="https://x.com/a/status/1" openedAsRequest />
    );
    expect(screen.getByText("Requested from")).toBeInTheDocument();
  });

  it("renders no provenance field when there is no provenance URL", () => {
    render(<DetailsFields {...baseProps} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
