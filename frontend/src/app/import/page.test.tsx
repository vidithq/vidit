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
  it("states the engine rules once and holds one section per entry", () => {
    const { container } = render(<ImportGuidePage />);

    expect(
      screen.getByRole("heading", { name: "Import your work from X" }),
    ).toBeInTheDocument();
    for (const heading of [
      "What makes a draft",
      "Tag @ViditBot on X",
      "Paste a post URL on Vidit",
      "Upload your X archive",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }

    // The anchors the two redirect stubs and the import panels target.
    for (const id of ["draft", "bot", "paste", "archive"]) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
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
