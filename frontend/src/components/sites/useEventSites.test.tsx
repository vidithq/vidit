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

import type { EventDetail } from "@/types";
import { useEventSites } from "./useEventSites";

const ALPHA = { id: "s1", name: "Site Alpha", kind: "airbase" };

/** The action in a stand-in for the actions row, the block in the page. */
function Harness({ event }: { event: EventDetail }) {
  const { block, linkAction } = useEventSites(event);
  return (
    <>
      <div role="group" aria-label="Event actions">
        {linkAction}
      </div>
      {block}
    </>
  );
}

async function renderBlock(event = eventDetail("e1", "Strike on the apron")) {
  await act(async () => {
    render(<Harness event={event} />);
  });
}

const row = () => screen.getByRole("group", { name: "Event actions" });

beforeEach(() => {
  calls.length = 0;
  links = [{ site: ALPHA, effect: "damage", linked_at: "2026-01-01T00:00:00Z" }];
  viewer = null;
});

describe("useEventSites", () => {
  it("shows a reader the live link and its effect, with no controls", async () => {
    await renderBlock();
    expect(screen.getByRole("heading", { name: /^Linked sites/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Site Alpha" })).toBeInTheDocument();
    expect(screen.queryByText(/Linked to/)).not.toBeInTheDocument();
    expect(screen.getByText("Damage")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link to a site" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unlink from Site Alpha" })).not.toBeInTheDocument();
  });

  it("renders nothing for a reader when the event has no link", async () => {
    links = [];
    await renderBlock();
    expect(screen.queryByText("Linked sites")).not.toBeInTheDocument();
  });

  it("gives the owner Link to a site in the actions row, and no block before a link exists", async () => {
    viewer = { id: "u1" };
    links = [];
    await renderBlock();
    expect(row()).toContainElement(screen.getByRole("button", { name: "Link to a site" }));
    expect(screen.queryByText("Linked sites")).not.toBeInTheDocument();
  });

  it("offers no link on an event that is not published", async () => {
    viewer = { id: "u1" };
    await renderBlock({ ...eventDetail("e1", "Strike on the apron"), status: "detected" });
    expect(screen.queryByRole("button", { name: "Link to a site" })).not.toBeInTheDocument();
  });

  it("leaves the owner's rows without controls: the edit form changes the links", async () => {
    viewer = { id: "u1" };
    await renderBlock();
    expect(screen.getByRole("link", { name: "Site Alpha" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Unlink|Change the effect/ })).not.toBeInTheDocument();
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

  it("files the event's satellite source on the site when the owner asks", async () => {
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
    fireEvent.click(screen.getByRole("switch", { name: "Also file source 2 on the site" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Link" }));
    });
    expect(calls).toContainEqual({ path: "/sites/s2/sources", method: "POST" });
  });
});
