import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { eventDetail, source } from "@/test/eventDetail";

let viewer: { id: string } | null;
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: viewer }) }));

const calls: { path: string; method: string }[] = [];
let links: unknown[];
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: (path: string, options?: RequestInit) => {
    calls.push({ path, method: options?.method ?? "GET" });
    if (path.endsWith("/site-links")) return Promise.resolve(links);
    if (path.includes("/site-suggestions"))
      return Promise.resolve([{ id: "s2", name: "Site Bravo", kind: "depot", distance_m: 640 }]);
    return Promise.resolve(undefined);
  },
}));

import { EventSitesBlock } from "./EventSitesBlock";

const ALPHA = { id: "s1", name: "Site Alpha", kind: "airbase" };

async function renderBlock(event = eventDetail("e1", "Strike on the apron")) {
  await act(async () => {
    render(<EventSitesBlock event={event} />);
  });
}

beforeEach(() => {
  calls.length = 0;
  links = [{ site: ALPHA, effect: "damage", linked_at: "2026-01-01T00:00:00Z" }];
  viewer = null;
});

describe("EventSitesBlock", () => {
  it("shows a reader the live link and its effect, with no controls", async () => {
    await renderBlock();
    expect(screen.getByRole("link", { name: "Site Alpha" })).toBeInTheDocument();
    expect(screen.getByText("Damage")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link to a site" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unlink from Site Alpha" })).not.toBeInTheDocument();
  });

  it("renders nothing for a reader when the event has no link", async () => {
    links = [];
    await renderBlock();
    expect(screen.queryByText("Sites")).not.toBeInTheDocument();
  });

  it("lets the owner unlink", async () => {
    viewer = { id: "u1" };
    await renderBlock();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unlink from Site Alpha" }));
    });
    expect(calls).toContainEqual({ path: "/events/e1/site-links/s1", method: "DELETE" });
  });

  it("links the owner's event to a suggested site with the picked effect", async () => {
    viewer = { id: "u1" };
    await renderBlock();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Link to a site" }));
    });
    fireEvent.click(screen.getByRole("button", { name: /Site Bravo/ }));
    expect(screen.getByText("Depot · 640 m from the event")).toBeInTheDocument();
    // No effect is picked for the analyst: the link waits for one.
    expect(screen.getByRole("button", { name: "Link" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Destruction" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Link" }));
    });
    expect(calls).toContainEqual({ path: "/events/e1/site-links", method: "POST" });
    // The event has no satellite source, so nothing is filed on the site.
    expect(calls.some((c) => c.path.startsWith("/sites/"))).toBe(false);
  });

  it("files the event's satellite image on the site when the owner asks", async () => {
    viewer = { id: "u1" };
    const satellite = source({
      id: "sat",
      kind: "satellite",
      level: "indirect",
      captured_at: "2026-03-15T10:20:00Z",
      media: { id: "m1", role: "source", storage_url: "", kind: "image", sha256: "", original_filename: "a.jpg" },
    });
    await renderBlock({ ...eventDetail("e1", "Strike on the apron"), sources: [source(), satellite] });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Link to a site" }));
    });
    fireEvent.click(screen.getByRole("button", { name: /Site Bravo/ }));
    fireEvent.click(screen.getByRole("button", { name: "Damage" }));
    fireEvent.click(screen.getByRole("switch", { name: "Also file source 2 in the imagery history" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Link" }));
    });
    expect(calls).toContainEqual({ path: "/sites/s2/images", method: "POST" });
  });
});
