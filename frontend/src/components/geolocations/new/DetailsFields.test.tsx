import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FORM_INVALID_LABEL } from "@/components/ui/form-styles";
import { LOCKED_FIELD } from "@/components/ui/Input";

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

// The locked box's muted text colour, the one token the link overrides.
const MUTED = "text-neutral-400";
const SOURCE_PLACEHOLDER = "https://t.me/channel/12345";
const SNAPSHOT_PLACEHOLDER = "https://web.archive.org/web/…";

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
    // The request's source is not the fulfiller's to retype: no editable field
    // is offered for it at all (the value renders as a link, covered below).
    expect(screen.queryByPlaceholderText(SOURCE_PLACEHOLDER)).toBeNull();
    expect(screen.getByText("from request")).toBeInTheDocument();
  });

  // A locked field is non-editable, never unreachable: the URL it holds is the
  // link, the way a stored source URL is a link everywhere else in the app.
  describe("locked URL fields render their value as a link", () => {
    it("turns a locked source URL into a link, without an editable field", () => {
      render(
        <DetailsFields {...baseProps} sourceUrlLocked sourceUrl="https://t.me/c/1" />
      );
      const link = screen.getByRole("link", { name: "https://t.me/c/1" });
      expect(link).toHaveAttribute("href", "https://t.me/c/1");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      // The value left the input entirely, so there is nothing to retype.
      expect(screen.queryByPlaceholderText(SOURCE_PLACEHOLDER)).toBeNull();
      expect(screen.getByText("from request")).toBeInTheDocument();
      // It still reads as the locked field it replaces: the same box recipe,
      // minus the forbidden cursor, which is false of a link. The one token
      // that must NOT survive is the muted text colour: clickable is accent.
      for (const token of LOCKED_FIELD.split(" ").filter((t) => t !== MUTED)) {
        expect(link.className).toContain(token);
      }
      expect(link.className).toContain("text-orange-400");
      expect(link.className).not.toContain(MUTED);
      expect(link.className).not.toContain("cursor-not-allowed");
    });

    it("turns the provenance URL into a link, without an editable field", () => {
      render(
        <DetailsFields
          {...baseProps}
          detectedFromUrl="https://x.com/analyst/status/1"
        />
      );
      const link = screen.getByRole("link", {
        name: "https://x.com/analyst/status/1",
      });
      expect(link).toHaveAttribute("href", "https://x.com/analyst/status/1");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(
        screen.queryByDisplayValue("https://x.com/analyst/status/1")
      ).toBeNull();
      expect(screen.getByText(/provenance, can't change/)).toBeInTheDocument();
    });

    it("keeps an editable source URL an editable field, not a link", () => {
      render(<DetailsFields {...baseProps} sourceUrl="https://t.me/c/1" />);
      expect(screen.queryByRole("link", { name: "https://t.me/c/1" })).toBeNull();
      expect(screen.getByPlaceholderText(SOURCE_PLACEHOLDER)).not.toHaveAttribute(
        "readonly"
      );
    });

    it("renders no provenance field when there is no provenance URL", () => {
      render(<DetailsFields {...baseProps} />);
      expect(screen.queryByText(/provenance, can't change/)).toBeNull();
    });

    it("keeps the read-only input when a locked source URL has no value yet", () => {
      render(<DetailsFields {...baseProps} sourceUrlLocked sourceUrl="" />);
      expect(screen.getByPlaceholderText(SOURCE_PLACEHOLDER)).toHaveAttribute(
        "readonly"
      );
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
    // The three accepted hosts do not wait on a source URL: with no link to
    // open, this sentence is the only thing saying an archive.today snapshot is
    // welcome in the field below.
    expect(
      screen.getByText(/paste a snapshot from archive\.ph or archive\.today/)
    ).toBeInTheDocument();
  });

  it("prefills one provider page with the source URL as typed", () => {
    render(
      <DetailsFields {...baseProps} sourceUrl="https://t.me/c/1?x=2 " />
    );
    // Wayback carries the link as a path, where the scheme separator stays
    // readable.
    expect(
      screen.getByRole("link", { name: "Open Wayback Machine" })
    ).toHaveAttribute(
      "href",
      "https://web.archive.org/save/https://t.me/c/1?x=2"
    );
    // The second link is gone: the field offers exactly one provider page. The
    // other hosts are still accepted, and the sentence beside the link says so
    // rather than opening a page for each.
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Open archive.today" })).toBeNull();
    expect(
      screen.getByText(/paste a snapshot from archive\.ph or archive\.today/)
    ).toBeInTheDocument();
  });

  it("prefills a fragment-bearing source URL, fragment and all", () => {
    render(<DetailsFields {...baseProps} sourceUrl="https://t.me/c/1#note" />);
    // `encodeURI` leaves `#` alone, so the fragment rides along and the browser
    // reads it as the fragment of the web.archive.org URL: what Save Page Now
    // captures is the link without it. That is by design. The server compares a
    // snapshot against the link on host, path and query
    // (`source_archive._normalised_target`) and ignores the fragment on both
    // sides, so the copy still files against the source it was taken for.
    expect(
      screen.getByRole("link", { name: "Open Wayback Machine" })
    ).toHaveAttribute("href", "https://web.archive.org/save/https://t.me/c/1#note");
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
