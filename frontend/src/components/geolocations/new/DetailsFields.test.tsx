import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FORM_INVALID_LABEL } from "@/components/ui/form-styles";

import { DetailsFields } from "./DetailsFields";

const baseProps = {
  sourceUrl: "",
  setSourceUrl: () => {},
  secondarySourceUrls: [] as string[],
  setSecondarySourceUrls: () => {},
  eventDate: "",
  setEventDate: () => {},
  eventTime: "",
  setEventTime: () => {},
  sourcePostedAt: "",
  setSourcePostedAt: () => {},
  sourceSnapshotUrl: "",
  setSourceSnapshotUrl: () => {},
  isGraphic: false,
  setIsGraphic: () => {},
  sourceUrlLocked: false,
};

const SOURCE_PLACEHOLDER = "https://t.me/channel/12345";
const SNAPSHOT_PLACEHOLDER = "https://archive.ph/…";

describe("DetailsFields", () => {
  it("renders the Details heading, the date + source fields, and their ? help", () => {
    render(<DetailsFields {...baseProps} />);
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText("Event date")).toBeInTheDocument();
    expect(screen.getByText("Event time")).toBeInTheDocument();
    expect(screen.getByText("Source posted (UTC)")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(SOURCE_PLACEHOLDER)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What is the event date?" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What is the source post time?" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What is the source?" })
    ).toBeInTheDocument();
  });

  it("carries no optional marker on the event date and event time", () => {
    render(<DetailsFields {...baseProps} />);
    for (const field of ["Event date", "Event time"]) {
      expect(screen.getByText(field).closest("label")).not.toHaveTextContent(
        "optional"
      );
    }
  });

  it("does not render a title field (the title leads the form)", () => {
    render(<DetailsFields {...baseProps} />);
    expect(
      screen.queryByRole("button", { name: "What makes a good title?" })
    ).toBeNull();
  });

  it("leaves the source URL editable by default", () => {
    render(<DetailsFields {...baseProps} />);
    expect(screen.getByPlaceholderText(SOURCE_PLACEHOLDER)).not.toHaveAttribute(
      "readonly"
    );
  });

  it("locks the source URL in request-fulfilment mode", () => {
    render(
      <DetailsFields {...baseProps} sourceUrlLocked sourceUrl="https://t.me/c/1" />
    );
    expect(screen.getByPlaceholderText(SOURCE_PLACEHOLDER)).toHaveAttribute(
      "readonly"
    );
  });

  // A locked field is non-editable, never unreachable: the value it holds is
  // still a link an analyst has to be able to open.
  describe("locked URL fields stay openable", () => {
    it("opens the locked source URL without unlocking the field", () => {
      render(
        <DetailsFields {...baseProps} sourceUrlLocked sourceUrl="https://t.me/c/1" />
      );
      const link = screen.getByRole("link", { name: "Open the source link" });
      expect(link).toHaveAttribute("href", "https://t.me/c/1");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      // The affordance is additive: the field itself did not become editable.
      expect(screen.getByPlaceholderText(SOURCE_PLACEHOLDER)).toHaveAttribute(
        "readonly"
      );
      expect(screen.getByText("from request")).toBeInTheDocument();
    });

    it("opens the provenance URL without unlocking the field", () => {
      render(
        <DetailsFields
          {...baseProps}
          detectedFromUrl="https://x.com/analyst/status/1"
        />
      );
      const link = screen.getByRole("link", {
        name: "Open the post it came from",
      });
      expect(link).toHaveAttribute("href", "https://x.com/analyst/status/1");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(
        screen.getByDisplayValue("https://x.com/analyst/status/1")
      ).toHaveAttribute("readonly");
      expect(screen.getByText(/provenance, can't change/)).toBeInTheDocument();
    });

    it("offers no open affordance while the source URL is editable", () => {
      render(<DetailsFields {...baseProps} sourceUrl="https://t.me/c/1" />);
      expect(
        screen.queryByRole("link", { name: "Open the source link" })
      ).toBeNull();
    });

    it("offers no open affordance when there is no provenance URL", () => {
      render(<DetailsFields {...baseProps} />);
      expect(
        screen.queryByRole("link", { name: "Open the post it came from" })
      ).toBeNull();
    });
  });

  it("flags a missing field's label red, same as its input outline", () => {
    render(
      <DetailsFields
        {...baseProps}
        sourcePostedAtInvalid
        sourceUrlInvalid
      />
    );
    // Every invalid field's own label turns red, matching the outline already
    // applied to its input (via `Input`'s `invalid` prop): the same
    // treatment, not just one or the other.
    expect(screen.getByText("Source posted (UTC)").closest("label")).toHaveClass(
      FORM_INVALID_LABEL
    );
    expect(screen.getByText("Source URL").closest("label")).toHaveClass(
      FORM_INVALID_LABEL
    );
    // Event date and time are never required, so they never get flagged.
    expect(screen.getByText("Event date").closest("label")).not.toHaveClass(
      FORM_INVALID_LABEL
    );
    expect(screen.getByText("Event time").closest("label")).not.toHaveClass(
      FORM_INVALID_LABEL
    );
  });

  it("offers the secondary sources list, empty and collapsed to its add button", () => {
    render(<DetailsFields {...baseProps} />);
    expect(screen.getByText("Secondary sources")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What are secondary sources?" })
    ).toBeInTheDocument();
    // No rows until one is added: an optional field starts out of the way.
    expect(screen.queryByLabelText("Secondary source 1")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add secondary source" })
    ).toBeEnabled();
  });

  it("renders one field per secondary source, in order", () => {
    render(
      <DetailsFields
        {...baseProps}
        secondarySourceUrls={["https://t.me/c/2", "https://x.com/u/status/3"]}
      />
    );
    expect(screen.getByLabelText("Secondary source 1")).toHaveValue(
      "https://t.me/c/2"
    );
    expect(screen.getByLabelText("Secondary source 2")).toHaveValue(
      "https://x.com/u/status/3"
    );
  });

  // ── the archival affordance under the source URL ──────────────────────

  it("offers the archival field, marked optional, with its ? help", () => {
    render(<DetailsFields {...baseProps} />);
    expect(screen.getByPlaceholderText(SNAPSHOT_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByText("Archived copy").closest("label")).toHaveTextContent(
      "optional"
    );
    expect(
      screen.getByRole("button", { name: "What are the archived copies?" })
    ).toBeInTheDocument();
  });

  it("offers no provider link until the source URL is a usable one", () => {
    render(<DetailsFields {...baseProps} sourceUrl="t.me/c/1" />);
    expect(screen.queryByRole("link", { name: /Wayback Machine/ })).toBeNull();
    expect(
      screen.getByText("Fill in the source URL above to archive it.")
    ).toBeInTheDocument();
  });

  it("prefills both provider pages with the source URL as typed", () => {
    render(
      <DetailsFields {...baseProps} sourceUrl="https://t.me/c/1?x=2 " />
    );
    // Wayback carries the link as a path (the scheme separator stays readable),
    // archive.today as a query parameter (every reserved character escaped).
    expect(
      screen.getByRole("link", { name: "Open Wayback Machine" })
    ).toHaveAttribute(
      "href",
      "https://web.archive.org/save/https://t.me/c/1?x=2"
    );
    expect(
      screen.getByRole("link", { name: "Open archive.today" })
    ).toHaveAttribute(
      "href",
      `https://archive.ph/?url=${encodeURIComponent("https://t.me/c/1?x=2")}`
    );
  });

  it("flags a paste that cannot be a snapshot, and only once one is typed", () => {
    const { rerender } = render(<DetailsFields {...baseProps} />);
    expect(screen.queryByText(/A snapshot link is an https link/)).toBeNull();

    rerender(
      <DetailsFields {...baseProps} sourceSnapshotUrl="https://evil.example/x" />
    );
    expect(
      screen.getByText(/A snapshot link is an https link/)
    ).toBeInTheDocument();
  });

  it("accepts a snapshot on an allowlisted host without flagging it", () => {
    render(
      <DetailsFields
        {...baseProps}
        sourceSnapshotUrl="https://web.archive.org/web/20260811120000/https://t.me/c/1"
      />
    );
    expect(screen.queryByText(/A snapshot link is an https link/)).toBeNull();
  });

  it("reports the paste as the analyst types it", () => {
    const setSourceSnapshotUrl = vi.fn();
    render(
      <DetailsFields
        {...baseProps}
        setSourceSnapshotUrl={setSourceSnapshotUrl}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(SNAPSHOT_PLACEHOLDER), {
      target: { value: "https://archive.ph/abcde" },
    });
    expect(setSourceSnapshotUrl).toHaveBeenCalledWith("https://archive.ph/abcde");
  });

  it("shows the copy the event already carries, and that pasting replaces it", () => {
    render(
      <DetailsFields
        {...baseProps}
        sourceUrl="https://t.me/c/1"
        archivedSource={{
          url: "https://archive.ph/abcde",
          provider: "archive_today",
        }}
      />
    );
    expect(
      screen.getByRole("link", { name: "archive.today copy of the source" })
    ).toHaveAttribute("href", "https://archive.ph/abcde");
    expect(screen.getByText(/paste another to replace it/)).toBeInTheDocument();
  });

  it("shows no existing copy on a fresh submit", () => {
    render(<DetailsFields {...baseProps} sourceUrl="https://t.me/c/1" />);
    expect(screen.queryByText(/paste another to replace it/)).toBeNull();
  });

  it("keeps the secondary sources editable while the primary is locked", () => {
    const setSecondarySourceUrls = vi.fn();
    render(
      <DetailsFields
        {...baseProps}
        sourceUrlLocked
        sourceUrl="https://t.me/c/1"
        secondarySourceUrls={["https://t.me/c/2"]}
        setSecondarySourceUrls={setSecondarySourceUrls}
      />
    );
    const row = screen.getByLabelText("Secondary source 1");
    expect(row).not.toHaveAttribute("readonly");
    fireEvent.change(row, { target: { value: "https://t.me/c/9" } });
    expect(setSecondarySourceUrls).toHaveBeenCalledWith(["https://t.me/c/9"]);
  });

  it("offers the graphic switch on a fresh form", () => {
    const setIsGraphic = vi.fn();
    render(<DetailsFields {...baseProps} setIsGraphic={setIsGraphic} />);
    const toggle = screen.getByRole("switch", { name: "Graphic content" });
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    expect(setIsGraphic).toHaveBeenCalledWith(true);
  });

  it("locks the graphic switch on an already-flagged event", () => {
    // The flag ratchets on the backend, so the edit form reads it rather than
    // offering a change the geolocate write would discard.
    const setIsGraphic = vi.fn();
    render(
      <DetailsFields
        {...baseProps}
        isGraphic
        graphicLocked
        setIsGraphic={setIsGraphic}
      />
    );
    const toggle = screen.getByRole("switch", { name: "Graphic content" });
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(setIsGraphic).not.toHaveBeenCalled();
    expect(screen.getByText("admin only")).toBeInTheDocument();
    expect(
      screen.getByText(/Removing the flag requires an admin/)
    ).toBeInTheDocument();
  });
});
