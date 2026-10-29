import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
};

describe("DetailsFields", () => {
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
