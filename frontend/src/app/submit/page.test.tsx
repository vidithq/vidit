import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// jsdom cannot mount the map canvas (WebGL); it and the proof editor (its own test) keep a marker.
vi.mock("@/components/map/Map", () => ({
  default: () => <div data-testid="map" />,
}));
vi.mock("@/components/editor/ProofEditor", () => ({
  default: () => <div data-testid="proof-editor" />,
}));

/** The page's query: the single-event form unless a test opens the chooser. */
let query = "mode=single";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(query),
}));

vi.mock("@/hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({ user: { id: "u1", username: "ana" }, loading: false }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", username: "ana" } }),
}));

/** Whether `/conflicts` has answered. */
let conflictsLoaded = true;

vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => ({
    data:
      path === "/conflicts" && conflictsLoaded
        ? [{ id: "c1", name: "Russian invasion of Ukraine", tier: "major" }]
        : null,
    error: null,
    refetch: () => {},
  }),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events")>()),
  createEvent: vi.fn(),
  createEventRequest: vi.fn(),
}));

import { newCollectionHref } from "@/lib/collections";
import { createEvent, createEventRequest } from "@/lib/events";
import { NEW_SITE_HREF } from "@/lib/sites";

import SubmitPage from "./page";

const announced = () => screen.queryByText(/^Fill in the required fields/);

beforeEach(() => {
  query = "mode=single";
  conflictsLoaded = true;
  vi.mocked(createEvent).mockReset();
  vi.mocked(createEventRequest).mockReset();
});

describe("the submit form's gate", () => {
  it("flags the request floor in page order", () => {
    render(<SubmitPage />);

    fireEvent.click(screen.getByRole("button", { name: "Publish request" }));
    expect(announced()).toHaveTextContent("Title, Source file, Source URL, Source kind.");
    expect(createEventRequest).not.toHaveBeenCalled();
  });

  it("flags the geolocation floor as the request floor plus the rest, in page order", () => {
    render(<SubmitPage />);

    fireEvent.click(screen.getByRole("button", { name: "Publish geolocation" }));
    expect(announced()).toHaveTextContent(
      "Title, Source file, Source URL, Source kind, Proof, Coordinates, Conflict."
    );
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("waits for the conflict options before it flags the geolocation floor", () => {
    conflictsLoaded = false;
    render(<SubmitPage />);

    fireEvent.click(screen.getByRole("button", { name: "Publish geolocation" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Still loading the required Conflict/);
    expect(announced()).toBeNull();

    // The request floor does not need them, and its click clears the banner.
    fireEvent.click(screen.getByRole("button", { name: "Publish request" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(announced()).toHaveTextContent("Title");
  });
});

describe("the submit chooser", () => {
  it("links the six paths, Geolocation and Request to the one form", () => {
    query = "";
    render(<SubmitPage />);

    const tiles = within(screen.getByRole("group", { name: "Submission mode" })).getAllByRole("link");
    expect(tiles.map((tile) => [tile.querySelector("h3")?.textContent, tile.getAttribute("href")])).toEqual([
      ["Geolocation", "/submit?mode=single"],
      ["Request", "/submit?mode=single"],
      ["From an X post", "/submit?mode=xpost"],
      ["Bulk import", "/submit?mode=bulk"],
      ["Site", NEW_SITE_HREF],
      ["Collection", newCollectionHref()],
    ]);
  });

  it("names what each path needs", () => {
    query = "";
    render(<SubmitPage />);

    const request = screen.getByRole("link", { name: /^Request/ });
    expect(within(request).getByText("Needs")).toBeInTheDocument();
    expect(within(request).getByText("Source")).toBeInTheDocument();
  });
});
