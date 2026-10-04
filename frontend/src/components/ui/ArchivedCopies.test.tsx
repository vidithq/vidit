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

/** The two states of one link's archive affordance: a copy exists, or it does not. */
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
    // One mark in every state and provider; only colour, interactivity and the
    // accessible name vary.
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
    // Pins the drawing: swapping every state to lucide's `History` would still agree.
    expect([...drawings][0]).toContain("lucide-archive");
  });

  it("tells two providers apart by name, drawing them alike", () => {
    // The service lives in the accessible name, so two copies must not announce alike.
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

  // Two states and no third: this surface never writes.
  it("shows a missing copy as an inert grey mark, for every viewer alike", () => {
    render(<ArchivedCopies {...props} copy={null} />);
    // Shown, but inert.
    expect(
      screen.getByRole("button", { name: "No archived copy of the source" })
    ).toBeDisabled();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  // Colour says a mark is clickable, so the states cannot share a paint (grey is
  // the disabled button's).
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

  // The row explains the mark, so no `?` beside it.
  it("carries no help affordance of its own", () => {
    render(<ArchivedCopies {...props} copy={{ url: WAYBACK, provider: "wayback" }} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  // The row aligns text on the baseline, so the square would hang low without `self-center`.
  it("centres its box on the line rather than hanging it off the baseline", () => {
    const { container } = render(<ArchivedCopies {...props} copy={null} />);
    expect(container.firstElementChild).toHaveClass("self-center");
  });
});

/**
 * The paste field accepts every allowed host, not just the one page its link
 * opens.
 */
describe("the pasted snapshot, whichever service produced it", () => {
  const SOURCE = "https://t.me/channel/1";

  // One case per accepted host, read off the list the component checks, so a new
  // host cannot go untested.
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
    expect(isSnapshotUrl(snapshot)).toBe(true);

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

  // The mis-paste warning never refuses: the value stays and posts, and the field
  // stays valid.
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

    expect(screen.getByText("https://elsewhere.test/x")).toBeInTheDocument();
    expect(screen.getByText(SOURCE)).toBeInTheDocument();
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
