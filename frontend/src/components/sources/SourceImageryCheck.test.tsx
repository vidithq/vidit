import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { apiFetch } from "@/lib/api";
import { newSourceDraft, type SourceCheck, type SourceDraft } from "@/lib/sources";

import { SourceImageryCheck } from "./SourceImageryCheck";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  apiFetch: vi.fn(),
}));

const EARTH = "https://earth.google.com/web/@47.09,37.54,50a";
const MAPS = "https://www.google.com/maps/@47.09,37.54,500m";

const CHECK: SourceCheck = {
  links: [
    {
      url: EARTH,
      provider: {
        id: "google_earth",
        name: "Google Earth web",
        group: "accepted",
        credit: "Google and every provider listed in Data attribution",
        help: "Turn on historical imagery, step to the capture day and copy the link.",
      },
    },
    {
      url: MAPS,
      provider: {
        id: "google_maps",
        name: "Google Maps",
        group: "not_reopenable",
        credit: "",
        help: "Google Maps shows no capture date.",
      },
    },
  ],
  warnings: [
    { code: "permalink_shape", message: "The link carries no imagery date.", url: EARTH },
    { code: "provider_not_reopenable", message: "Google Maps shows no capture date.", url: MAPS },
    { code: "capture_date_missing", message: "Give the capture date.", url: null },
  ],
};

const draft = (overrides: Partial<SourceDraft>): SourceDraft => ({
  ...newSourceDraft(),
  links: [EARTH, MAPS].map((url) => ({ url, postedAt: "", snapshotUrl: "", stored: null })),
  ...overrides,
});

async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  (apiFetch as unknown as Mock).mockReset().mockResolvedValue(CHECK);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SourceImageryCheck", () => {
  it("checks a satellite source and shows each reopenable provider's help and credit", async () => {
    render(<SourceImageryCheck draft={draft({ kind: "satellite" })} name="Source 1" />);
    await settle();
    const [path, init] = (apiFetch as unknown as Mock).mock.calls[0];
    expect(path).toBe("/sources/check");
    expect(JSON.parse(init.body)).toEqual({
      kind: "satellite",
      captured_at: null,
      links: [
        { url: EARTH, snapshot_url: null },
        { url: MAPS, snapshot_url: null },
      ],
    });
    expect(screen.getByText("Google Earth web")).toBeInTheDocument();
    expect(screen.getByText(CHECK.links[0].provider!.help)).toBeInTheDocument();
    expect(
      screen.getByText("Credit: Google and every provider listed in Data attribution")
    ).toBeInTheDocument();
    // A provider no reader can reopen speaks through its warning alone.
    expect(screen.queryByText("Google Maps")).toBeNull();
  });

  it("lists the warnings, each led by its link's host", async () => {
    render(<SourceImageryCheck draft={draft({ kind: "aircraft" })} name="Source 1" />);
    await settle();
    const list = screen.getByRole("list", { name: "Warnings of Source 1" });
    const items = within(list).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "earth.google.com: The link carries no imagery date.",
      "google.com: Google Maps shows no capture date.",
      "Give the capture date.",
    ]);
  });

  it("drops the missing capture date warning where the form requires the field", async () => {
    render(
      <SourceImageryCheck draft={draft({ kind: "satellite" })} name="Source 1" captureRequired />
    );
    await settle();
    const list = screen.getByRole("list", { name: "Warnings of Source 1" });
    expect(within(list).queryByText("Give the capture date.")).toBeNull();
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("runs no check for another kind", async () => {
    const { container } = render(
      <SourceImageryCheck draft={draft({ kind: "drone" })} name="Source 1" />
    );
    await settle();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing when the check fails", async () => {
    (apiFetch as unknown as Mock).mockRejectedValue(new Error("down"));
    render(<SourceImageryCheck draft={draft({ kind: "satellite" })} name="Source 1" />);
    await settle();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
