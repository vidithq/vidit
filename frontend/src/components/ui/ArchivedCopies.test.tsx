import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArchivedCopies, PRIMARY_SOURCE_DESCRIPTION } from "./ArchivedCopies";
import { FIELD_HELP } from "@/lib/fieldHelp";
import { recordArchivedCopy } from "@/lib/events";

vi.mock("@/lib/events", () => ({ recordArchivedCopy: vi.fn() }));

/**
 * The three states one link's archive affordance can be in: a copy exists, a
 * copy does not and the viewer may make one, a copy does not and they may not.
 * Read at the component rather than through a detail page, because the whole
 * affordance is here.
 */
describe("ArchivedCopies", () => {
  const SOURCE = "https://t.me/channel/1";
  const WAYBACK = "https://web.archive.org/web/20260601120000/https://t.me/channel/1";
  const ARCHIVE_TODAY = "https://archive.ph/abcde";

  const props = {
    url: SOURCE,
    eventId: "e1",
    describes: PRIMARY_SOURCE_DESCRIPTION,
    canArchive: false,
  };

  beforeEach(() => {
    vi.mocked(recordArchivedCopy).mockReset();
  });

  it("links the copy, named for the service that holds it", () => {
    render(<ArchivedCopies {...props} copy={{ url: WAYBACK, provider: "wayback" }} />);
    expect(
      screen.getByRole("link", { name: "Wayback Machine copy of the source" })
    ).toHaveAttribute("href", WAYBACK);
  });

  it("names the copy for archive.today when that is what holds it", () => {
    render(
      <ArchivedCopies {...props} copy={{ url: ARCHIVE_TODAY, provider: "archive_today" }} />
    );
    expect(
      screen.getByRole("link", { name: "archive.today copy of the source" })
    ).toHaveAttribute("href", ARCHIVE_TODAY);
  });

  it("leaves a reader who cannot archive an inert grey glyph", () => {
    render(<ArchivedCopies {...props} copy={null} />);
    // The absence is shown rather than hidden, but no action is offered that
    // the server would refuse from this viewer.
    expect(
      screen.getByRole("img", { name: "No archived copy of the source" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Archive/ })).not.toBeInTheDocument();
  });

  it("offers the owner both providers, each prefilled with the link", () => {
    render(<ArchivedCopies {...props} copy={null} canArchive />);
    const toggle = screen.getByRole("button", { name: "Archive the source" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // The link travels in the provider's own URL, so the analyst never copies
    // it by hand: a path segment for Wayback, a query parameter for
    // archive.today.
    expect(screen.getByRole("link", { name: "Open Wayback Machine" })).toHaveAttribute(
      "href",
      `https://web.archive.org/save/${SOURCE}`
    );
    expect(screen.getByRole("link", { name: "Open archive.today" })).toHaveAttribute(
      "href",
      `https://archive.ph/?url=${encodeURIComponent(SOURCE)}`
    );
    // The provider pages open beside the catalog, never in place of it.
    expect(screen.getByRole("link", { name: "Open Wayback Machine" })).toHaveAttribute(
      "target",
      "_blank"
    );
  });

  it("records what the owner pastes back and flips the glyph in place", async () => {
    vi.mocked(recordArchivedCopy).mockResolvedValue({ url: WAYBACK, provider: "wayback" });
    render(<ArchivedCopies {...props} copy={null} canArchive />);
    fireEvent.click(screen.getByRole("button", { name: "Archive the source" }));

    fireEvent.change(screen.getByLabelText("Paste the snapshot link"), {
      target: { value: `  ${WAYBACK}  ` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Trimmed on the way out: a link copied out of a browser bar drags
    // whitespace the server would reject.
    expect(recordArchivedCopy).toHaveBeenCalledWith("e1", SOURCE, WAYBACK);
    // The page's own payload is a fetch old by now, so the recorded copy is
    // what the glyph reads.
    expect(
      await screen.findByRole("link", { name: "Wayback Machine copy of the source" })
    ).toHaveAttribute("href", WAYBACK);
  });

  it("keeps the field open with the reason when the server refuses the paste", async () => {
    vi.mocked(recordArchivedCopy).mockRejectedValue(new Error("That snapshot is of a different link."));
    render(<ArchivedCopies {...props} copy={null} canArchive />);
    fireEvent.click(screen.getByRole("button", { name: "Archive the source" }));

    fireEvent.change(screen.getByLabelText("Paste the snapshot link"), {
      target: { value: "https://web.archive.org/web/20260601120000/https://elsewhere.test/x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByText("That snapshot is of a different link.")).toBeInTheDocument()
    );
    expect(screen.queryByRole("link", { name: /copy of the source/ })).not.toBeInTheDocument();
  });

  it("will not submit an empty field", () => {
    render(<ArchivedCopies {...props} copy={null} canArchive />);
    fireEvent.click(screen.getByRole("button", { name: "Archive the source" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("closes the affordance with one `?`, never one per state", () => {
    // The glyph carries no label beside it, so the house help affordance
    // explains it. A caller rendering a list of them hoists it to the section
    // with `help={false}`.
    const { rerender } = render(
      <ArchivedCopies {...props} copy={{ url: WAYBACK, provider: "wayback" }} />
    );
    expect(
      screen.getByRole("button", { name: FIELD_HELP.archived_copies.label })
    ).toBeInTheDocument();

    rerender(
      <ArchivedCopies {...props} copy={{ url: WAYBACK, provider: "wayback" }} help={false} />
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
