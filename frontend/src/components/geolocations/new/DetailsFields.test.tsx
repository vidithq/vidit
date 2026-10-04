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
  secondarySnapshotUrls: [] as string[],
  setSecondarySnapshotUrls: () => {},
  isGraphic: false,
  setIsGraphic: () => {},
  sourceUrlLocked: false,
};

// The locked box's muted text colour, the one token the link overrides.
const MUTED = "text-neutral-400";
const SOURCE_PLACEHOLDER = "https://t.me/channel/12345";
const SNAPSHOT_PLACEHOLDER =
  "Paste a snapshot link (web.archive.org, archive.today, ghostarchive.org)";

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
    // No editable field for the request's source; the value renders as a link.
    expect(screen.queryByPlaceholderText(SOURCE_PLACEHOLDER)).toBeNull();
    expect(screen.getByText("from request")).toBeInTheDocument();
  });

  // A locked field is non-editable, never unreachable: the URL is its link.
  describe("locked URL fields render their value as a link", () => {
    it("turns a locked source URL into a link, without an editable field", () => {
      render(
        <DetailsFields {...baseProps} sourceUrlLocked sourceUrl="https://t.me/c/1" />
      );
      const link = screen.getByRole("link", { name: "https://t.me/c/1" });
      expect(link).toHaveAttribute("href", "https://t.me/c/1");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(screen.queryByPlaceholderText(SOURCE_PLACEHOLDER)).toBeNull();
      expect(screen.getByText("from request")).toBeInTheDocument();
      // Same box recipe as the locked input, minus the forbidden cursor. The muted
      // text colour must not survive: clickable is accent.
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

    it("archives the provenance link where the write path takes the paste", () => {
      // Same mark and line as the Source URL above.
      const setter = vi.fn();
      render(
        <DetailsFields
          {...baseProps}
          detectedFromUrl="https://x.com/analyst/status/1"
          setDetectedFromSnapshotUrl={setter}
        />
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: "Archive the post it was detected from",
        })
      );
      const field = screen.getByPlaceholderText(SNAPSHOT_PLACEHOLDER);
      fireEvent.change(field, { target: { value: "https://archive.ph/abcde" } });
      expect(setter).toHaveBeenCalledWith("https://archive.ph/abcde");
    });

    it("leaves the provenance link bare where nothing would take the paste", () => {
      // The submit write declares no field for it, so no mark.
      render(
        <DetailsFields
          {...baseProps}
          detectedFromUrl="https://x.com/analyst/status/1"
        />
      );
      expect(
        screen.queryByRole("button", {
          name: "Archive the post it was detected from",
        })
      ).toBeNull();
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
    // Each invalid field's label turns red with its outline.
    expect(screen.getByText("Source posted (UTC)").closest("label")).toHaveClass(
      FORM_INVALID_LABEL
    );
    expect(screen.getByText("Source URL").closest("label")).toHaveClass(
      FORM_INVALID_LABEL
    );
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


  it("archives from a mark in the source URL field, with no block under it", () => {
    render(<DetailsFields {...baseProps} sourceUrl="https://t.me/c/1" />);
    // Nothing under the field until asked for.
    expect(screen.queryByPlaceholderText(SNAPSHOT_PLACEHOLDER)).toBeNull();
    expect(screen.queryByText("Archived copy")).toBeNull();
    expect(screen.queryByText("optional")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Archive the source" }));
    expect(screen.getByPlaceholderText(SNAPSHOT_PLACEHOLDER)).toBeInTheDocument();
  });

  it("leaves the door inert until the source URL is a usable one", () => {
    render(<DetailsFields {...baseProps} sourceUrl="t.me/c/1" />);
    fireEvent.click(screen.getByRole("button", { name: "Archive the source" }));
    // Grey on a form only here; the name says what to do first.
    expect(screen.queryByRole("link", { name: /Wayback Machine/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Fill in the source to archive it" })
    ).toBeDisabled();
  });

  it("prefills one provider page with the source URL as typed", () => {
    render(<DetailsFields {...baseProps} sourceUrl="https://t.me/c/1?x=2 " />);
    fireEvent.click(screen.getByRole("button", { name: "Archive the source" }));
    expect(
      screen.getByRole("link", {
        name: "Open the Wayback Machine for the source",
      })
    ).toHaveAttribute("href", "https://web.archive.org/save/https://t.me/c/1?x=2");
    // Exactly one provider page; other hosts are still accepted.
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByPlaceholderText(SNAPSHOT_PLACEHOLDER)).toBeInTheDocument();
  });

  it("prefills a fragment-bearing source URL, fragment and all", () => {
    render(<DetailsFields {...baseProps} sourceUrl="https://t.me/c/1#note" />);
    fireEvent.click(screen.getByRole("button", { name: "Archive the source" }));
    // `encodeURI` leaves `#`, so the fragment is the web.archive.org URL's and Save
    // Page Now captures the link without it. By design: the server compares
    // snapshots on host, path and query and ignores the fragment
    // (`source_archive._normalised_target`).
    expect(
      screen.getByRole("link", {
        name: "Open the Wayback Machine for the source",
      })
    ).toHaveAttribute("href", "https://web.archive.org/save/https://t.me/c/1#note");
  });

  it("opens the paste line by itself on a value already staged", () => {
    // A held snapshot must be visible.
    render(
      <DetailsFields {...baseProps} sourceSnapshotUrl="https://archive.ph/abcde" />
    );
    expect(screen.getByPlaceholderText(SNAPSHOT_PLACEHOLDER)).toHaveValue(
      "https://archive.ph/abcde"
    );
  });

  it("flags a paste that cannot be a snapshot, and only once one is typed", () => {
    const { rerender } = render(<DetailsFields {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive the source" }));
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
      <DetailsFields {...baseProps} setSourceSnapshotUrl={setSourceSnapshotUrl} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive the source" }));
    fireEvent.change(screen.getByPlaceholderText(SNAPSHOT_PLACEHOLDER), {
      target: { value: "https://archive.ph/abcde" },
    });
    expect(setSourceSnapshotUrl).toHaveBeenCalledWith("https://archive.ph/abcde");
  });

  it("opens the copy the event already carries, and still offers to replace it", () => {
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
    // The second mark replaces a wrong paste.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Replace the archived copy of the source",
      })
    );
    expect(screen.getByPlaceholderText(SNAPSHOT_PLACEHOLDER)).toBeInTheDocument();
  });

  it("shows no existing copy on a fresh submit", () => {
    render(<DetailsFields {...baseProps} sourceUrl="https://t.me/c/1" />);
    expect(screen.queryByRole("link", { name: /copy of the source/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Archive the source" })
    ).toBeInTheDocument();
  });


  it("gives every secondary source its own mark and its own paste line", () => {
    const setSecondarySnapshotUrls = vi.fn();
    render(
      <DetailsFields
        {...baseProps}
        secondarySourceUrls={["https://t.me/c/2", "https://t.me/c/3"]}
        secondarySnapshotUrls={["", ""]}
        setSecondarySnapshotUrls={setSecondarySnapshotUrls}
      />
    );
    // Named per mirror, so two rows on one host stay distinct.
    expect(
      screen.getByRole("button", { name: "Archive mirror 1, t.me" })
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Archive mirror 2, t.me" })
    );
    const second = screen.getByLabelText("Archived copy of mirror 2, t.me");
    fireEvent.change(second, { target: { value: "https://archive.ph/abcde" } });
    expect(setSecondarySnapshotUrls).toHaveBeenCalledWith([
      "",
      "https://archive.ph/abcde",
    ]);
  });

  it("prefills the provider page with the mirror, not the source", () => {
    render(
      <DetailsFields
        {...baseProps}
        sourceUrl="https://t.me/c/1"
        secondarySourceUrls={["https://t.me/c/2"]}
        secondarySnapshotUrls={[""]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive the source" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive t.me" }));
    expect(
      screen
        .getAllByRole("link", { name: /^Open the Wayback Machine for/ })
        .map((link) => link.getAttribute("href"))
    ).toEqual([
      "https://web.archive.org/save/https://t.me/c/1",
      "https://web.archive.org/save/https://t.me/c/2",
    ]);
  });

  it("shows the copy a mirror already carries", () => {
    render(
      <DetailsFields
        {...baseProps}
        secondarySourceUrls={["https://t.me/c/2"]}
        secondarySnapshotUrls={[""]}
        archivedCopies={
          new Map([
            [
              "https://t.me/c/2",
              { url: "https://archive.ph/abcde", provider: "archive_today" },
            ],
          ])
        }
      />
    );
    expect(
      screen.getByRole("link", { name: "archive.today copy of t.me" })
    ).toHaveAttribute("href", "https://archive.ph/abcde");
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
