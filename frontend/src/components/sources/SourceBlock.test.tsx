import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SourceBlock, SourceBlocks } from "./SourceBlock";
import { source } from "@/test/eventDetail";
import type { Source } from "@/lib/sources";

const ALT = "Strike on a depot";

const IMAGE = {
  id: "m1",
  role: "source" as const,
  storage_url: "/local-storage/evidence.jpg",
  kind: "image" as const,
  sha256: "0".repeat(64),
};

const ARCHIVED = {
  url: "https://web.archive.org/web/2026/https://t.me/channel/12345",
  provider: "wayback" as const,
  archived_at: "2026-06-02T00:00:00Z",
};

function renderBlock(overrides: Partial<Source> = {}) {
  render(<SourceBlock source={source(overrides)} index={0} alt={ALT} />);
  return screen.getByRole("region", { name: "Source 1" });
}

// Each row's label, in render order.
const rowLabels = (block: HTMLElement) =>
  Array.from(block.querySelectorAll(":scope > div > span:first-child")).map((n) =>
    n.textContent?.trim()
  );

describe("SourceBlock", () => {
  it("shows the file above the rows", () => {
    const block = renderBlock({ media: IMAGE, kind: "drone" });
    const img = within(block).getByRole("img", { name: ALT });
    const title = within(block).getByText("Title");
    expect(img.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(block).queryByText("No file")).toBeNull();
    expect(within(block).getByText("Drone · photo")).toBeInTheDocument();
  });

  it("shows a No file box and the kind alone without a file", () => {
    const block = renderBlock({ kind: "article" });
    expect(within(block).getByText("No file")).toBeInTheDocument();
    expect(within(block).queryByRole("img")).toBeNull();
    expect(within(block).getByText("Article")).toBeInTheDocument();
  });

  it("shows no file area on a context source without a file", () => {
    const block = renderBlock({ level: "context", kind: "article" });
    expect(within(block).queryByText("No file")).toBeNull();
    // The card starts with its rows.
    expect(rowLabels(block)[0]).toBe("Title");
    expect(block.firstElementChild?.textContent).toContain("Title");
  });

  it("keeps the file area of a context source that has a file", () => {
    const block = renderBlock({ level: "context", media: IMAGE });
    expect(within(block).getByRole("img", { name: ALT })).toBeInTheDocument();
  });

  it("drops an unknown kind, leaving the file's kind alone", () => {
    expect(within(renderBlock({ media: IMAGE })).getByText("Photo")).toBeInTheDocument();
  });

  it("shows no Kind row for an unknown source without a file", () => {
    expect(within(renderBlock()).queryByText("Kind")).toBeNull();
  });

  it("reads Untitled for an empty title", () => {
    expect(within(renderBlock()).getByText("Untitled")).toBeInTheDocument();
  });

  it("shows the title when set", () => {
    expect(
      within(renderBlock({ title: "Drone footage of the strike" })).getByText(
        "Drone footage of the strike"
      )
    ).toBeInTheDocument();
  });

  it("hides every row without a value, except the title", () => {
    const block = renderBlock({ links: [] });
    expect(rowLabels(block)).toEqual(["Title", "Level"]);
  });

  it("lists the rows in order when every field is set", () => {
    const block = renderBlock({
      title: "Footage",
      media: IMAGE,
      kind: "drone",
      captured_at: "2026-06-01T09:30:00Z",
      capture_position: { lat: 48.02, lng: 37.79 },
      tags: [{ id: "t1", name: "armor" }],
    });
    expect(rowLabels(block)).toEqual([
      "Title",
      "Level",
      "Kind",
      "Capture position",
      "Captured",
      "Links (1)",
      "Tags",
    ]);
    expect(within(block).getByText("1 Jun 2026, 09:30 UTC")).toBeInTheDocument();
    expect(within(block).getByText("48.0200, 37.7900")).toBeInTheDocument();
    expect(within(block).getByRole("button", { name: "Copy coordinates" })).toBeInTheDocument();
    expect(within(block).getByText("armor")).toBeInTheDocument();
  });

  it("shows one link by its host, with its archived copy and post date", () => {
    const block = renderBlock({
      links: [
        { url: "https://t.me/channel/12345", posted_at: "2026-06-01T10:05:00Z", archived: ARCHIVED },
      ],
    });
    expect(within(block).getByText("Links (1)")).toBeInTheDocument();
    const link = within(block).getByRole("link", { name: "t.me" });
    expect(link).toHaveAttribute("href", "https://t.me/channel/12345");
    expect(link).toHaveAttribute("title", "https://t.me/channel/12345");
    expect(within(block).getByText("Posted 1 Jun 2026")).toBeInTheDocument();
    expect(
      within(block).getByRole("link", { name: "Wayback Machine copy of source 1, t.me" })
    ).toHaveAttribute("href", ARCHIVED.url);
  });

  it("counts several links, one item each", () => {
    const block = renderBlock({
      links: [
        { url: "https://t.me/channel/12345", posted_at: "2026-06-01T10:05:00Z", archived: ARCHIVED },
        { url: "https://www.youtube.com/watch?v=abc", posted_at: null, archived: null },
      ],
    });
    expect(within(block).getByText("Links (2)")).toBeInTheDocument();
    const items = within(within(block).getByRole("list", { name: "Links of source 1" })).getAllByRole(
      "listitem"
    );
    expect(items).toHaveLength(2);
    expect(within(items[1]).getByRole("link", { name: "www.youtube.com" })).toBeInTheDocument();
    expect(within(items[1]).getByText("Date unknown")).toBeInTheDocument();
    expect(
      within(items[1]).getByRole("button", {
        name: "No archived copy of source 1, link 2, www.youtube.com",
      })
    ).toBeDisabled();
  });
});

describe("SourceBlocks", () => {
  it("gives a lone source the whole area, file beside the rows, with no scroller", () => {
    render(<SourceBlocks sources={[source({ media: IMAGE })]} alt={ALT} />);
    expect(screen.getByText("Sources (1)")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sources" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next source" })).toBeNull();
    const block = screen.getByRole("region", { name: "Source 1" });
    expect(block).toHaveClass("@container");
    expect(within(block).getByRole("img", { name: ALT })).toBeInTheDocument();
  });

  it("keeps two sources in the scrolling row", () => {
    render(
      <SourceBlocks sources={[source({ id: "s1" }), source({ id: "s2" })]} alt={ALT} />
    );
    expect(screen.getByText("Sources (2)")).toBeInTheDocument();
    const row = screen.getByRole("region", { name: "Sources" });
    expect(within(row).getAllByRole("region", { name: /^Source \d$/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Next source" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Source 1" })).not.toHaveClass("@container");
  });
});
