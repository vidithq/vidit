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

/** Whether the browser offers a draft store: jsdom has no IndexedDB, so the form starts empty. */
let storesDrafts = false;
const storedDraft = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/drafts", () => ({
  canStoreDrafts: () => storesDrafts,
  readDraft: vi.fn(async () => storedDraft.value),
  writeDraft: vi.fn(async () => {}),
  clearDraft: vi.fn(async () => {}),
}));

import { apiFetch } from "@/lib/api";
import { clearDraft, readDraft, writeDraft } from "@/lib/drafts";
import { newSourceDraft } from "@/lib/sources";
import { newCollectionHref } from "@/lib/collections";
import { createEvent, createEventRequest } from "@/lib/events";
import { submitHref } from "@/lib/routes";
import { NEW_SITE_HREF } from "@/lib/sites";

import SubmitPage from "./page";

const announced = () => screen.queryByText(/^Fill in the required fields/);

beforeEach(() => {
  query = "mode=single";
  conflictsLoaded = true;
  storesDrafts = false;
  storedDraft.value = null;
  vi.mocked(writeDraft).mockClear();
  vi.mocked(clearDraft).mockClear();
  vi.mocked(createEvent).mockReset();
  vi.mocked(createEventRequest).mockReset();
  vi.mocked(apiFetch).mockResolvedValue([]);
});

describe("the submit form's gate", () => {
  it("flags the request floor in page order", () => {
    render(<SubmitPage />);

    fireEvent.click(screen.getByRole("button", { name: "Publish request" }));
    expect(announced()).toHaveTextContent("Title, Source file, Source URL.");
    expect(createEventRequest).not.toHaveBeenCalled();
  });

  it("flags the geolocation floor as the request floor plus the rest, in page order", () => {
    render(<SubmitPage />);

    fireEvent.click(screen.getByRole("button", { name: "Publish geolocation" }));
    expect(announced()).toHaveTextContent(
      "Title, Source file, Source URL, Proof, Coordinates, Conflict."
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

describe("the submit draft", () => {
  const source = {
    ...newSourceDraft(),
    kind: "drone" as const,
    links: [{ url: "https://t.me/channel/42", postedAt: "", snapshotUrl: "", stored: null }],
  };
  const stored = {
    form: {
      title: "Strike on a fuel depot",
      lat: "48.3112",
      lng: "38.0421",
      sources: [source],
      eventDate: "2026-10-20",
      eventTime: "14:05",
      proof: "<p>Shadows match.</p>",
      proofFiles: [],
      tagIds: [],
      conflictIds: ["c1"],
      siteLinks: [],
    },
    geolocators: [],
  };

  it("restores every field a reload left, for the signed-in analyst", async () => {
    storesDrafts = true;
    storedDraft.value = stored;
    render(<SubmitPage />);

    expect(await screen.findByDisplayValue("Strike on a fuel depot")).toBeInTheDocument();
    expect(readDraft).toHaveBeenLastCalledWith("submit:u1");
    expect(screen.getByRole("textbox", { name: "Latitude" })).toHaveValue("48.3112");
    expect(screen.getByRole("textbox", { name: "Longitude" })).toHaveValue("38.0421");
    expect(screen.getByRole("textbox", { name: "Source 1 link 1" })).toHaveValue(
      "https://t.me/channel/42"
    );
    expect(screen.getByDisplayValue("2026-10-20")).toBeInTheDocument();
    expect(screen.getByDisplayValue("14:05")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Russian invasion of Ukraine/ })).toBeInTheDocument();
  });

  it("stores each change, and drops the draft once a publish lands", async () => {
    storesDrafts = true;
    const upload = {
      id: "up1",
      kind: "image",
      sha256: "0",
      original_filename: "frame.jpg",
      storage_url: "https://cdn.test/uploads/up1.jpg",
      expires_at: "2099-01-01T00:00:00Z",
    } as const;
    storedDraft.value = {
      ...stored,
      form: { ...stored.form, sources: [{ ...source, file: { state: "staged", upload } }] },
    };
    vi.mocked(createEventRequest).mockResolvedValue({ id: "r1" } as never);
    render(<SubmitPage />);

    const title = await screen.findByDisplayValue("Strike on a fuel depot");
    fireEvent.change(title, { target: { value: "Convoy on the bridge" } });
    await vi.waitFor(() =>
      expect(writeDraft).toHaveBeenLastCalledWith(
        "submit:u1",
        expect.objectContaining({ form: expect.objectContaining({ title: "Convoy on the bridge" }) })
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "Publish request" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await vi.waitFor(() => expect(clearDraft).toHaveBeenCalledWith("submit:u1"));
  });
});

describe("the submit form's Linked sites", () => {
  it("picks a site by name, then asks what the event shows there", async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) =>
      path.startsWith("/sites/suggestions?q=")
        ? [{ id: "s2", name: "Bravo depot", kind: "depot", distance_m: null }]
        : [],
    );
    render(<SubmitPage />);

    const search = screen.getByRole("combobox", { name: "Search a site by name" });
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "Bravo" } });
    fireEvent.click(await screen.findByRole("option", { name: /Bravo depot/ }));

    expect(screen.getByRole("link", { name: "Bravo depot" })).toHaveAttribute("href", "/sites/s2");
    expect(screen.getByRole("button", { name: "Remove Bravo depot" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Effect at Bravo depot" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish geolocation" }));
    expect(announced()).toHaveTextContent(/Effect at a linked site\.$/);
  });
});

describe("the submit chooser", () => {
  it("links the six paths, Geolocation and Request to the one form", () => {
    query = "";
    render(<SubmitPage />);

    const tiles = within(screen.getByRole("group", { name: "Submission mode" })).getAllByRole("link");
    expect(tiles.map((tile) => [tile.querySelector("h3")?.textContent, tile.getAttribute("href")])).toEqual([
      ["Geolocation", submitHref("single")],
      ["Request", submitHref("single")],
      ["From an X post", submitHref("xpost")],
      ["Bulk import", submitHref("bulk")],
      ["Site", NEW_SITE_HREF],
      ["Collection", newCollectionHref()],
    ]);
  });

  it("names what each path needs", () => {
    query = "";
    render(<SubmitPage />);

    const request = screen.getByRole("link", { name: /^Request/ });
    expect(within(request).getByText("Needs")).toBeInTheDocument();
    for (const label of ["Title", "Source file", "Source URL"]) {
      expect(within(request).getByText(label)).toBeInTheDocument();
    }
    const geolocation = screen.getByRole("link", { name: /^Geolocation/ });
    for (const label of ["Title", "Source file", "Source URL", "Proof", "Coordinates", "Conflict"]) {
      expect(within(geolocation).getByText(label)).toBeInTheDocument();
    }
    const site = screen.getByRole("link", { name: /^Site/ });
    for (const label of ["Name", "Capture date", "Link", "Contour", "Kind"]) {
      expect(within(site).getByText(label)).toBeInTheDocument();
    }
  });
});
