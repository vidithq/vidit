import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// jsdom cannot mount the draw canvas (WebGL).
vi.mock("@/components/map/ZoneDrawMap", () => ({ default: () => <div data-testid="draw-map" /> }));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/lib/sites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sites")>()),
  saveSiteVersion: vi.fn(),
}));

import { saveSiteVersion, type Site } from "@/lib/sites";
import { SiteEditForm } from "./SiteEditForm";

const OWNER = { id: "u1", username: "ana", avatar_url: null };
const ZONE = {
  type: "Polygon" as const,
  coordinates: [
    [
      [30, 10],
      [30.01, 10],
      [30.01, 10.01],
      [30, 10.01],
      [30, 10],
    ] as [number, number][],
  ],
};

const SITE = {
  id: "s1",
  name: "Depot North",
  kind: "depot",
  version_no: 3,
  owner: OWNER,
  zone: ZONE,
  centroid: { lat: 10.005, lng: 30.005 },
  contour_id: "c1",
  created_at: "2026-01-01T00:00:00Z",
  last_source: null,
  linked_events: [],
  latest_link_effect: null,
  sources: [
    {
      id: "src1",
      title: "",
      level: "context",
      kind: "satellite",
      captured_at: "2026-05-22T09:00:00Z",
      capture_position: null,
      is_graphic: false,
      links: [],
      tags: [],
      media: null,
      warnings: [],
      provider: null,
      author: OWNER,
      note: null,
      created_at: "2026-05-23T00:00:00Z",
    },
  ],
  contours: [
    { id: "c1", source_id: "src1", zone: ZONE, captured_at: "2026-05-22T09:00:00Z", author: OWNER },
  ],
} as unknown as Site;

function renderForm() {
  render(<SiteEditForm site={SITE} owner={OWNER} initialSource={null} />);
  return screen.getByRole("button", { name: "Save version 4" });
}

beforeEach(() => {
  push.mockReset();
  vi.mocked(saveSiteVersion).mockReset().mockResolvedValue(SITE);
});

describe("SiteEditForm", () => {
  it("counts nothing missing on an untouched form, and refuses its save as no change", () => {
    const save = renderForm();
    expect(save).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("button", { name: /missing/ })).toBeNull();

    fireEvent.click(save);
    expect(screen.getByRole("alert")).toHaveTextContent("Nothing changed since version 3.");
    expect(screen.queryByRole("dialog", { name: "Version note" })).toBeNull();
    expect(saveSiteVersion).not.toHaveBeenCalled();
  });

  it("asks for the version note on the first click and saves it with the edit", async () => {
    const save = renderForm();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Depot South" },
    });
    fireEvent.click(save);
    const panel = screen.getByRole("dialog", { name: "Version note" });
    fireEvent.change(within(panel).getByLabelText("Version note"), {
      target: { value: "Renamed after the fire" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Save version 4" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/sites/s1"));
    expect(saveSiteVersion).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ version_no: 3, name: "Depot South", note: "Renamed after the fire" }),
    );
  });
});
