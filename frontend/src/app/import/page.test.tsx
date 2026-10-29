import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import ImportGuidePage from "./page";
import BotGuideRedirect from "../bot/page";
import ArchiveGuideRedirect from "../archive/page";
import SHOTS from "../_shots/shots.json";

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
    // The chooser is the first action: each tile must resolve to its section.
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

  it("numbers the Submit mode selector from the marker list the capture script reads", () => {
    render(<ImportGuidePage />);

    const shot = SHOTS.import["submit-modes"];
    const figure = screen.getByAltText(shot.alt).closest("figure")!;
    const legend = within(figure).getAllByRole("listitem").map((li) => li.textContent);
    expect(legend).toEqual(shot.markers.map(({ label }, i) => `${i + 1}${label}`));
    expect(within(figure).getByText(/@ViditBot needs no form/)).toBeInTheDocument();
  });

  it("states the coordinate rule at the one hop the bot and the paste read", () => {
    // Two entries read the post plus its direct reply parent only, so a "same thread" rule would mislead; only the bare tag reads further and only the archive reads a whole self thread.
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

  it("annotates a typical post, numbering each part the detection reads", () => {
    const { container } = render(<ImportGuidePage />);

    const figure = container.querySelector("figure")!;
    const legend = within(figure).getAllByRole("listitem");
    expect(legend).toHaveLength(5);
    const post = figure.firstElementChild!;
    for (let n = 1; n <= legend.length; n++) {
      expect(within(post as HTMLElement).getByText(String(n))).toBeInTheDocument();
    }
  });

  it("leaves the detection lifecycle to the Getting started page", () => {
    const { container } = render(<ImportGuidePage />);

    expect(container.querySelector('a[href="/guide#statuses"]')).not.toBeNull();
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
