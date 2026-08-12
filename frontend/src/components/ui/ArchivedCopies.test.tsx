import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ArchivedCopies, PRIMARY_SOURCE_DESCRIPTION } from "./ArchivedCopies";
import { FIELD_HELP } from "@/lib/fieldHelp";

/**
 * The states one link's icon pair can be in, read at the component rather than
 * through a detail page: the pair is the whole affordance, each glyph named for
 * its own state, and one `?` beside them for what the pair is.
 */
describe("ArchivedCopies", () => {
  const WAYBACK = "https://web.archive.org/web/2026/t.me/channel/1";
  const ARCHIVE_TODAY = "https://archive.ph/abcde/t.me/channel/1";

  it("links a captured copy, named for the service that holds it", () => {
    render(
      <ArchivedCopies
        copies={{ wayback: WAYBACK, archive_today: ARCHIVE_TODAY, unavailable: false }}
        describes={PRIMARY_SOURCE_DESCRIPTION}
      />
    );
    expect(
      screen.getByRole("link", { name: "Wayback Machine copy of the source" })
    ).toHaveAttribute("href", WAYBACK);
    expect(
      screen.getByRole("link", { name: "archive.today copy of the source" })
    ).toHaveAttribute("href", ARCHIVE_TODAY);
  });

  it("names both glyphs as in progress while the queue is still trying", () => {
    render(
      <ArchivedCopies
        copies={{ wayback: null, archive_today: null, unavailable: false }}
        describes={PRIMARY_SOURCE_DESCRIPTION}
      />
    );
    expect(screen.getAllByRole("img", { name: /archiving in progress/ })).toHaveLength(2);
  });

  it("names both glyphs as failed once no copy is coming", () => {
    render(
      <ArchivedCopies
        copies={{ wayback: null, archive_today: null, unavailable: true }}
        describes={PRIMARY_SOURCE_DESCRIPTION}
      />
    );
    expect(screen.getAllByRole("img", { name: /archiving failed/ })).toHaveLength(2);
  });

  it("names the settled side of a one-provider capture for that service", () => {
    // One copy finishes the job, so the empty side is settled rather than
    // pending, and its name says which service never captured it.
    render(
      <ArchivedCopies
        copies={{ wayback: WAYBACK, archive_today: null, unavailable: false }}
        describes={PRIMARY_SOURCE_DESCRIPTION}
      />
    );
    expect(
      screen.getByRole("img", { name: "No archive.today copy of the source" })
    ).toBeInTheDocument();
  });

  it("renders the draft pair from the flag, with no record to read", () => {
    // A draft has no queue rows at all: publication is the trigger. The state
    // comes from the caller's status flag, so the payload stays untouched.
    render(
      <ArchivedCopies
        copies={null}
        describes={PRIMARY_SOURCE_DESCRIPTION}
        pendingPublication
      />
    );
    expect(
      screen.getByRole("img", {
        name: "Wayback Machine copy of the source: archived when published",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "archive.today copy of the source: archived when published",
      })
    ).toBeInTheDocument();
    // Greyed and inert: there is nothing to open yet.
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("prefers a record it is given over the draft promise", () => {
    render(
      <ArchivedCopies
        copies={{ wayback: WAYBACK, archive_today: null, unavailable: false }}
        describes={PRIMARY_SOURCE_DESCRIPTION}
        pendingPublication
      />
    );
    expect(
      screen.getByRole("link", { name: "Wayback Machine copy of the source" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: /archived when published/ })
    ).not.toBeInTheDocument();
  });

  it("closes the pair with one `?`, never one per icon", () => {
    // The glyphs carry no label beside them, so the house help affordance
    // explains the pair. It is the pair's, not each icon's: a caller rendering
    // a list of pairs hoists it to the section with `help={false}`.
    const { rerender } = render(
      <ArchivedCopies
        copies={{ wayback: WAYBACK, archive_today: ARCHIVE_TODAY, unavailable: false }}
        describes={PRIMARY_SOURCE_DESCRIPTION}
      />
    );
    const help = screen.getByRole("button", {
      name: FIELD_HELP.archived_copies.label,
    });
    expect(help).toBeInTheDocument();
    rerender(
      <ArchivedCopies
        copies={{ wayback: WAYBACK, archive_today: ARCHIVE_TODAY, unavailable: false }}
        describes={PRIMARY_SOURCE_DESCRIPTION}
        help={false}
      />
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing for an untracked link on a published event", () => {
    const { container } = render(
      <ArchivedCopies copies={null} describes={PRIMARY_SOURCE_DESCRIPTION} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
