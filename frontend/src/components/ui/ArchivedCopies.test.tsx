import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ArchivedCopies,
  ArchiveSnapshotField,
  isSnapshotUrl,
  PRIMARY_SOURCE_DESCRIPTION,
  SNAPSHOT_HINT,
  SNAPSHOT_HOSTS,
} from "./ArchivedCopies";
import { FIELD_HELP } from "@/lib/fieldHelp";

/**
 * The two states one link's archive affordance can be in: a copy exists, or it
 * does not. Read at the component rather than through a detail page, because
 * the whole affordance is here.
 */
describe("ArchivedCopies", () => {
  const SOURCE = "https://t.me/channel/1";
  const WAYBACK = "https://web.archive.org/web/20260601120000/https://t.me/channel/1";
  const ARCHIVE_TODAY = "https://archive.ph/abcde";

  const props = { describes: PRIMARY_SOURCE_DESCRIPTION };

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

  it("draws one mark for archiving, whatever the provider and whatever the state", () => {
    // The concept has a single shape: a reader meeting the mark on the source
    // row and again on the provenance row must read one idea, not two. What
    // varies is state (colour, interactivity) and provider (the accessible
    // name), never the drawing.
    const mark = (ui: ReactElement) => {
      const { container, unmount } = render(ui);
      const svg = container.querySelector("svg")?.outerHTML ?? "";
      unmount();
      return svg;
    };
    const drawings = new Set([
      mark(<ArchivedCopies {...props} copy={{ url: WAYBACK, provider: "wayback" }} help={false} />),
      mark(
        <ArchivedCopies
          {...props}
          copy={{ url: ARCHIVE_TODAY, provider: "archive_today" }}
          help={false}
        />
      ),
      mark(<ArchivedCopies {...props} copy={null} help={false} />),
    ]);

    expect(drawings.size).toBe(1);
    // Which drawing, not merely that they agree: swapping every state back to
    // lucide's `History` would leave the set at one.
    expect([...drawings][0]).toContain("lucide-archive");
  });

  it("tells two providers apart by name, drawing them alike", () => {
    // The mark is one shape, so the service holding the copy has nowhere to live
    // but the accessible name. Two copies must therefore not announce alike.
    const { unmount } = render(
      <ArchivedCopies {...props} copy={{ url: WAYBACK, provider: "wayback" }} />
    );
    expect(
      screen.getByRole("link", { name: "Wayback Machine copy of the source" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "archive.today copy of the source" })
    ).toBeNull();
    unmount();

    render(
      <ArchivedCopies {...props} copy={{ url: ARCHIVE_TODAY, provider: "archive_today" }} />
    );
    expect(
      screen.getByRole("link", { name: "archive.today copy of the source" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Wayback Machine copy of the source" })
    ).toBeNull();
  });

  // Two states and no third: recording a copy is an edit, filed through the
  // edit form's archived-copy field, so this surface never writes and offers
  // the owner exactly what it offers a reader.
  it("shows a missing copy as an inert grey mark, for every viewer alike", () => {
    render(<ArchivedCopies {...props} copy={null} />);
    // The absence is shown rather than hidden, but nothing here acts on it.
    const missing = screen.getByRole("img", {
      name: "No archived copy of the source",
    });
    expect(missing).toHaveClass("text-neutral-600");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  // Colour is what says a mark can be clicked, so the two states cannot share
  // one paint however alike they are drawn.
  it("paints the stored copy accent and the missing one grey", () => {
    const { unmount } = render(
      <ArchivedCopies {...props} copy={{ url: WAYBACK, provider: "wayback" }} />
    );
    expect(
      screen.getByRole("link", { name: "Wayback Machine copy of the source" })
    ).toHaveClass("text-orange-400");
    unmount();

    render(<ArchivedCopies {...props} copy={null} />);
    expect(
      screen.getByRole("img", { name: "No archived copy of the source" })
    ).toHaveClass("text-neutral-600");
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

/**
 * What the paste field accepts, which is wider than the one page the field's
 * link opens. The link is a convenience; the contract is the three allowed
 * hosts, and an analyst who archives at archive.today themselves must keep
 * working.
 */
describe("the pasted snapshot, whichever service produced it", () => {
  const SOURCE = "https://t.me/channel/1";

  // One case per accepted host, read off the list the component checks against
  // and the backend mirrors, so a host added there cannot go untested. Only the
  // shape differs: a Wayback URL replays the link it captured, while the other
  // two are opaque codes.
  const CASES = SNAPSHOT_HOSTS.map(
    (host) =>
      [
        host,
        host === "web.archive.org"
          ? `https://${host}/web/20260601120000/${SOURCE}`
          : `https://${host}/abcde`,
      ] as const
  );

  it.each(CASES)("is accepted from %s", (_host, snapshot) => {
    // The client-side gate the submit and edit forms refuse a publish on.
    expect(isSnapshotUrl(snapshot)).toBe(true);

    // The form field: no refusal, and no hint saying it is one.
    render(
      <ArchiveSnapshotField
        link={SOURCE}
        describes={PRIMARY_SOURCE_DESCRIPTION}
        value={snapshot}
        onChange={() => {}}
      />
    );
    expect(screen.queryByText(SNAPSHOT_HINT)).toBeNull();
  });

  it("is refused when its host archives nothing", () => {
    expect(isSnapshotUrl("https://example.test/not-an-archive")).toBe(false);
    render(
      <ArchiveSnapshotField
        link={SOURCE}
        describes={PRIMARY_SOURCE_DESCRIPTION}
        value="https://example.test/not-an-archive"
        onChange={() => {}}
      />
    );
    expect(screen.getByText(SNAPSHOT_HINT)).toBeInTheDocument();
  });
});
