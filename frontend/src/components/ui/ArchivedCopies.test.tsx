import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ArchivedCopies, PRIMARY_SOURCE_DESCRIPTION } from "./ArchivedCopies";

/**
 * The states one link's icon pair can be in, read at the component rather than
 * through a detail page: the pair is the whole affordance, and the hover title
 * is the only thing a sighted reader gets for a glyph with no label beside it.
 */
describe("ArchivedCopies", () => {
  const WAYBACK = "https://web.archive.org/web/2026/t.me/channel/1";
  const ARCHIVE_TODAY = "https://archive.ph/abcde/t.me/channel/1";

  it("titles a captured copy with the service that holds it", () => {
    render(
      <ArchivedCopies
        copies={{ wayback: WAYBACK, archive_today: ARCHIVE_TODAY, unavailable: false }}
        describes={PRIMARY_SOURCE_DESCRIPTION}
      />
    );
    expect(screen.getByTitle("Wayback Machine copy")).toHaveAttribute("href", WAYBACK);
    expect(screen.getByTitle("archive.today copy")).toHaveAttribute(
      "href",
      ARCHIVE_TODAY
    );
  });

  it("titles both glyphs as in progress while the queue is still trying", () => {
    render(
      <ArchivedCopies
        copies={{ wayback: null, archive_today: null, unavailable: false }}
        describes={PRIMARY_SOURCE_DESCRIPTION}
      />
    );
    expect(screen.getAllByTitle("Archiving in progress")).toHaveLength(2);
  });

  it("titles both glyphs as failed once no copy is coming", () => {
    render(
      <ArchivedCopies
        copies={{ wayback: null, archive_today: null, unavailable: true }}
        describes={PRIMARY_SOURCE_DESCRIPTION}
      />
    );
    expect(screen.getAllByTitle("Archiving failed, no copy available")).toHaveLength(2);
  });

  it("titles the settled side of a one-provider capture for that service", () => {
    // One copy finishes the job, so the empty side is settled rather than
    // pending, and its title says which service never captured it.
    render(
      <ArchivedCopies
        copies={{ wayback: WAYBACK, archive_today: null, unavailable: false }}
        describes={PRIMARY_SOURCE_DESCRIPTION}
      />
    );
    expect(screen.getByTitle("No archive.today copy was captured")).toBeInTheDocument();
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
    expect(screen.getAllByTitle("Archived when published")).toHaveLength(2);
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
    expect(screen.getByTitle("Wayback Machine copy")).toBeInTheDocument();
    expect(screen.queryByTitle("Archived when published")).not.toBeInTheDocument();
  });

  it("leaves the pointer on the titled element in every state", () => {
    // The wrapper is exactly the glyph's size, so if the glyph took the
    // pointer, the element under it would be an SVG node carrying no title and
    // the hover text would never appear, which is how every state lost its
    // tooltip in a real browser while the attribute sat in the markup.
    const states = [
      { copies: { wayback: WAYBACK, archive_today: ARCHIVE_TODAY, unavailable: false } },
      { copies: { wayback: WAYBACK, archive_today: null, unavailable: false } },
      { copies: { wayback: null, archive_today: null, unavailable: false } },
      { copies: { wayback: null, archive_today: null, unavailable: true } },
      { copies: null, pendingPublication: true },
    ];
    for (const state of states) {
      const { container, unmount } = render(
        <ArchivedCopies describes={PRIMARY_SOURCE_DESCRIPTION} {...state} />
      );
      const carriers = container.querySelectorAll("[title]");
      expect(carriers).toHaveLength(2);
      for (const carrier of carriers) {
        expect(carrier.getAttribute("title")).toBeTruthy();
        const glyph = carrier.querySelector("svg");
        expect(glyph).toHaveClass("pointer-events-none");
      }
      unmount();
    }
  });

  it("renders nothing for an untracked link on a published event", () => {
    const { container } = render(
      <ArchivedCopies copies={null} describes={PRIMARY_SOURCE_DESCRIPTION} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
