import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import { FIELD_HELP } from "@/lib/fieldHelp";
import MethodologyPage from "./page";

describe("/methodology", () => {
  it("shows a real proof, credited and linked to its geolocation", () => {
    render(<MethodologyPage />);

    const image = screen.getByAltText(/^A proof image/);
    expect(image.getAttribute("src")).toContain("/methodology/proof-example.webp");
    const caption = image.closest("figure")!.querySelector("figcaption")!;
    expect(caption.textContent).toContain("AquilaTrenta");
    expect(
      within(caption).getByRole("link", { name: "Destruction of the checkpoint at Vodyane" }),
    ).toHaveAttribute("href", "/events/03bc6ca6-a5fb-489b-94fc-f100ef2aa88d");
  });

  it("holds what the short Links help leaves out: the link order, archiving, imagery permalinks", () => {
    render(<MethodologyPage />);

    const [verify, , crossReference] = screen.getAllByRole("listitem");
    expect(verify.textContent).toContain("original post first, then each mirror");
    expect(verify.textContent).toContain("Archive beside a link opens the Wayback Machine");
    expect(crossReference.textContent).toContain("full permalink");
    expect(FIELD_HELP.source_links.text.split(/(?<=\.) /)).toHaveLength(2);
  });

  it("lists the six steps the image's numbers point at", () => {
    render(<MethodologyPage />);

    const steps = screen.getAllByRole("listitem");
    expect(steps).toHaveLength(6);
    expect(steps[3].textContent).toContain("Annotate the match");
  });
});
