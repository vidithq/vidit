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

/**
 * The two states one link's archive affordance can be in: a copy exists, or it
 * does not. Read at the component rather than through a detail page, because
 * the whole affordance is here.
 */
describe("ArchivedCopies", () => {
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
      mark(<ArchivedCopies {...props} copy={{ url: WAYBACK, provider: "wayback" }} />),
      mark(
        <ArchivedCopies
          {...props}
          copy={{ url: ARCHIVE_TODAY, provider: "archive_today" }}
        />
      ),
      mark(<ArchivedCopies {...props} copy={null} />),
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
    expect(
      screen.getByRole("button", { name: "No archived copy of the source" })
    ).toBeDisabled();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  // Colour is what says a mark can be clicked, so the two states cannot share
  // one paint however alike they are drawn. Grey is the disabled button's own
  // paint, the same neutral every refusing control on the site wears.
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
      screen.getByRole("button", { name: "No archived copy of the source" })
    ).toHaveClass("disabled:text-neutral-600");
  });

  // The mark is explained by the row it sits on, not by a `?` of its own: an
  // expanded list of ten mirrors would otherwise carry ten copies of one
  // sentence. So the component renders the mark and nothing beside it.
  it("carries no help affordance of its own", () => {
    render(<ArchivedCopies {...props} copy={{ url: WAYBACK, provider: "wayback" }} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  // The row it rides aligns its text on the baseline, where the icon button's
  // square would otherwise hang low against the link it belongs to.
  it("centres its box on the line rather than hanging it off the baseline", () => {
    const { container } = render(<ArchivedCopies {...props} copy={null} />);
    expect(container.firstElementChild).toHaveClass("self-center");
  });
});

/**
 * What the paste field accepts, which is wider than the one page the field's
 * link opens. The link is a convenience; the contract is the allowed hosts, and
 * an analyst who archives at archive.today or Ghostarchive themselves must keep
 * working.
 */
describe("the pasted snapshot, whichever service produced it", () => {
  const SOURCE = "https://t.me/channel/1";

  // One case per accepted host, read off the list the component checks against
  // and the backend mirrors, so a host added there cannot go untested. Only the
  // shape differs: a Wayback URL replays the link it captured, while the rest
  // are opaque codes.
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

  // The seatbelt for the one thing the server stopped checking. It warns and
  // never refuses: the value stays in the field, the form still posts it, and
  // the field keeps no invalid state.
  it("warns, without refusing, on a snapshot that replays another link", () => {
    const snapshot = "https://web.archive.org/web/20260601120000/https://elsewhere.test/x";
    expect(isSnapshotUrl(snapshot)).toBe(true);

    render(
      <ArchiveSnapshotField
        link={SOURCE}
        describes={PRIMARY_SOURCE_DESCRIPTION}
        value={snapshot}
        onChange={() => {}}
      />
    );

    // Both links are on screen, so the analyst can see which one is wrong.
    expect(screen.getByText("https://elsewhere.test/x")).toBeInTheDocument();
    expect(screen.getByText(SOURCE)).toBeInTheDocument();
    // A warning, not a refusal: the hint sentence belongs to the other line.
    expect(screen.queryByText(SNAPSHOT_HINT)).toBeNull();
    expect(screen.getByRole("textbox")).toHaveValue(snapshot);
  });

  it("says nothing when the snapshot replays the link it sits under", () => {
    render(
      <ArchiveSnapshotField
        link={SOURCE}
        describes={PRIMARY_SOURCE_DESCRIPTION}
        value={`https://web.archive.org/web/20260601120000/${SOURCE}`}
        onChange={() => {}}
      />
    );
    expect(screen.queryByText(SOURCE)).toBeNull();
  });
});
