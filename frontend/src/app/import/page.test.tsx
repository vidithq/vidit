import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import ImportGuidePage from "./page";
import BotGuideRedirect from "../bot/page";
import ArchiveGuideRedirect from "../archive/page";

describe("/import", () => {
  it("states the conditions once and holds one section per entry", () => {
    const { container } = render(<ImportGuidePage />);

    expect(
      screen.getByRole("heading", { name: "Import your work from X" }),
    ).toBeInTheDocument();
    for (const heading of [
      "What makes a detection",
      "What the detection carries",
      "Tag @ViditBot on X",
      "Paste a post URL on Vidit",
      "Upload your X archive",
    ]) {
      expect(
        screen.getAllByRole("heading", { name: heading }).length,
      ).toBeGreaterThan(0);
    }

    // The anchors the two redirect stubs and the import panels target.
    for (const id of ["detection", "bot", "paste", "archive"]) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it("opens on a chooser linking the three entry sections", () => {
    // The chooser is the page's first action: a reader picks an entry before
    // reading anything, so each tile must resolve to the section it names.
    const { container } = render(<ImportGuidePage />);

    for (const [href, title] of [
      ["#archive", "Upload your X archive"],
      ["#bot", "Tag @ViditBot on X"],
      ["#paste", "Paste a post URL"],
    ]) {
      const tile = container.querySelector(`a[href="${href}"]`);
      expect(tile).not.toBeNull();
      expect(tile?.textContent).toContain(title);
    }
  });

  it("states the coordinate rule at the one hop the bot and the paste read", () => {
    // Two of the three entries read the post plus the post it directly replies
    // to, and nothing further, so a rule promising "the same thread" would send
    // an analyst tagging the bot three replies down away empty-handed. The bare
    // tag is the one shape that reads further, and an analyst who does not know
    // it writes the coordinate into every reply to be safe. Only the archive
    // reads a whole self thread, and its section is where that is said.
    render(<ImportGuidePage />);

    expect(
      screen.getByText(/your own post it directly replies to/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/says nothing but @ViditBot points at the thread above/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/the only entry that stitches full self\s+threads/i),
    ).toBeInTheDocument();
  });
});

describe("the absorbed guide routes", () => {
  it.each([
    ["/bot", BotGuideRedirect, "/import#bot"],
    ["/archive", ArchiveGuideRedirect, "/import#archive"],
  ])("%s redirects into the import guide", (_route, Page, target) => {
    redirect.mockClear();
    Page();
    expect(redirect).toHaveBeenCalledWith(target);
  });
});
