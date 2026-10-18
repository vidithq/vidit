import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import GuidePage from "./page";
import SHOTS from "../_shots/shots.json";

const ANCHORS = [
  "layout",
  "reading-a-geolocation",
  "statuses",
  "bringing-your-work-in",
  "working-with-others",
  "settings",
];

describe("/guide", () => {
  it("holds the six sections in order, each behind a stable anchor", () => {
    const { container } = render(<GuidePage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Getting started" }),
    ).toBeInTheDocument();
    const ids = Array.from(container.querySelectorAll("h2[id]")).map((h) => h.id);
    expect(ids).toEqual(ANCHORS);
  });

  it("links each way in to its section of the import guide, and the submit form", () => {
    const { container } = render(<GuidePage />);

    for (const href of ["/import#detection", "/import#archive", "/import#paste", "/import#bot", "/submit"]) {
      expect(container.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
  });

  it("numbers each screenshot's legend from the marker list the capture script reads", () => {
    render(<GuidePage />);

    for (const shot of Object.values(SHOTS.guide)) {
      const figure = screen.getByAltText(shot.alt).closest("figure")!;
      const legend = within(figure).getAllByRole("listitem").map((li) => li.textContent);
      expect(legend).toEqual(shot.markers.map(({ label }, i) => `${i + 1}${label}`));
    }
  });

  it("leads the signed-in sections with their screenshots", () => {
    render(<GuidePage />);

    const shotsIn = (id: string) =>
      Array.from(document.getElementById(id)!.closest("section")!.querySelectorAll("img")).map(
        (img) => img.getAttribute("alt"),
      );
    expect(shotsIn("working-with-others")).toEqual([SHOTS.guide.approvals.alt, SHOTS.guide.feed.alt]);
    expect(shotsIn("settings")).toEqual([SHOTS.guide.notifications.alt]);
  });
});
