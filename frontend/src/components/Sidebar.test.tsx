import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Sidebar from "./Sidebar";

// The rail reads four sources: who is signed in, whether they are an admin,
// how many detections wait, and the path (for the active highlight). The tests
// drive the first two; admin and path are pinned. `vi.hoisted` because the
// `vi.mock` factories below are hoisted above this file's own statements.
const viewer = vi.hoisted(() => ({
  avatar_url: null as string | null,
  detections: 0,
  pathname: "/map",
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", username: "analyst", avatar_url: viewer.avatar_url },
    loading: false,
  }),
}));
vi.mock("@/contexts/DetectionsContext", () => ({
  useDetectionsCount: () => ({ count: viewer.detections, refresh: () => {} }),
}));
vi.mock("@/hooks/useAdmin", () => ({
  useAdmin: () => ({ isAdmin: false, loading: false }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => viewer.pathname }));

describe("Sidebar identity row", () => {
  beforeEach(() => {
    viewer.avatar_url = null;
    viewer.detections = 0;
    viewer.pathname = "/map";
  });

  // The rail renders collapsed by default, so the handle lives in the row's
  // `title` rather than a visible label: that is what these queries key off.
  it("shows the analyst's own picture, and keeps the row named by the handle", () => {
    viewer.avatar_url = "https://cdn.example.com/analyst.jpg";
    const { container } = render(<Sidebar />);

    const picture = container.querySelector("img");
    expect(picture).toHaveAttribute("src", "https://cdn.example.com/analyst.jpg");
    // Decorative: an alt string here would become the link's accessible name
    // and displace the handle.
    expect(picture).toHaveAttribute("alt", "");
    expect(screen.getByTitle("analyst")).toHaveAttribute(
      "href",
      "/profile/analyst",
    );
  });

  it("falls back to the icon circle when no picture is set", () => {
    const { container } = render(<Sidebar />);

    expect(container.querySelector("img")).toBeNull();
    // The fallback glyph renders inside the row, on the row's own colour so it
    // tracks hover and the active accent.
    const row = screen.getByTitle("analyst");
    const glyph = row.querySelector("svg");
    expect(glyph).not.toBeNull();
    expect(glyph).toHaveClass("text-current");
  });

  it("anchors the pending-detections badge beside the picture", () => {
    viewer.avatar_url = "https://cdn.example.com/analyst.jpg";
    viewer.detections = 3;
    const { container } = render(<Sidebar />);

    const row = screen.getByTitle("analyst · 3 to submit");
    // The badge sits in the wrapper that holds the picture, not elsewhere in
    // the row, which is the only reason that wrapper exists.
    const wrapper = container.querySelector("img")?.parentElement?.parentElement;
    expect(wrapper).toHaveClass("relative");
    expect(wrapper?.querySelector(".bg-orange-500")).not.toBeNull();
    expect(row).toHaveTextContent("3 geolocations awaiting submission");
  });
});

// Below `sm` the same rail is a drawer behind a floating chip. Its one viewport
// read is the `sm` crossing (own test below); every other rule is a class, so
// the two states are independent by construction and both are drivable here.
// jsdom applies no media query, so both halves of every `max-sm:` / `sm:` pair
// are in the DOM and these tests assert the wiring, not which half a phone
// paints.
describe("Sidebar drawer controls", () => {
  beforeEach(() => {
    viewer.pathname = "/map";
  });

  it("opens the drawer from the chip and reports it on the button", () => {
    render(<Sidebar />);

    const open = screen.getByLabelText("Open navigation");
    expect(open).toHaveAttribute("aria-expanded", "false");
    expect(open).toHaveAttribute("aria-controls", "primary-navigation");
    // The button names the aside it drives, so the two must actually meet.
    expect(screen.getByLabelText("Primary navigation")).toHaveAttribute(
      "id",
      "primary-navigation",
    );

    fireEvent.click(open);

    expect(open).toHaveAttribute("aria-expanded", "true");

    // Map is the row for the pinned pathname, so this is the tap that changes
    // no route: the pathname effect never runs and the drawer would stay open
    // over the page under it, body still scroll-locked.
    fireEvent.click(screen.getByRole("link", { name: "Map" }));

    expect(open).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the drawer when the scrim is tapped", () => {
    render(<Sidebar />);

    const open = screen.getByLabelText("Open navigation");
    // The scrim carries its own name, distinct from the foot row's "Close
    // navigation": it exists only while the drawer is open, so its absence and
    // presence are what these two queries pin.
    expect(screen.queryByLabelText("Close navigation overlay")).toBeNull();

    fireEvent.click(open);
    const scrim = screen.getByLabelText("Close navigation overlay");
    fireEvent.click(scrim);

    expect(open).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Close navigation overlay")).toBeNull();
    // The foot row keeps its own name through all of it, so the two controls
    // never merge into one ambiguous entry in a reader's list.
    expect(screen.getAllByLabelText("Close navigation")).toHaveLength(1);
  });

  it("closes the drawer when the viewport crosses `sm`", () => {
    // The drawer is state, not a class, so a widening viewport cannot clear it
    // on its own. jsdom answers no media query, so this one test stands the
    // listener up: the setup file's stub matches nothing and registers nothing.
    const listeners: ((event: MediaQueryListEvent) => void)[] = [];
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener(_type: string, listener: (e: MediaQueryListEvent) => void) {
        listeners.push(listener);
      },
      removeEventListener(
        _type: string,
        listener: (e: MediaQueryListEvent) => void,
      ) {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
      },
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;

    try {
      render(<Sidebar />);
      const open = screen.getByLabelText("Open navigation");
      fireEvent.click(open);
      expect(open).toHaveAttribute("aria-expanded", "true");

      expect(listeners).toHaveLength(1);
      act(() => {
        for (const listener of listeners) {
          listener({ matches: true } as MediaQueryListEvent);
        }
      });

      expect(open).toHaveAttribute("aria-expanded", "false");
    } finally {
      window.matchMedia = original;
    }
  });

  it("moves focus into the drawer and hands it back on close", () => {
    render(<Sidebar />);

    const open = screen.getByLabelText("Open navigation");
    const aside = screen.getByLabelText("Primary navigation");

    fireEvent.click(open);
    // The first nav row, so a reader lands on the destinations rather than on
    // whatever sat behind the scrim.
    expect(aside.contains(document.activeElement)).toBe(true);
    expect(aside).toHaveAttribute("role", "dialog");
    expect(aside).toHaveAttribute("aria-modal", "true");

    fireEvent.click(screen.getByLabelText("Close navigation overlay"));

    expect(document.activeElement).toBe(open);
    // The plain landmark again: only the drawer is modal.
    expect(aside).not.toHaveAttribute("role");
    expect(aside).not.toHaveAttribute("aria-modal");
  });

  it("closes the drawer on a route change it did not start", () => {
    const { rerender } = render(<Sidebar />);

    const open = screen.getByLabelText("Open navigation");
    fireEvent.click(open);
    expect(open).toHaveAttribute("aria-expanded", "true");

    // The ways out of a page that are not a tap on a drawer row: a redirect,
    // the browser's back button. The drawer would otherwise stay open over the
    // destination, with the body still scroll-locked.
    viewer.pathname = "/about";
    rerender(<Sidebar />);

    expect(open).toHaveAttribute("aria-expanded", "false");
  });

  it("leaves the pinned rail expanded when a link is clicked", () => {
    render(<Sidebar />);

    const toggle = screen.getByLabelText("Expand sidebar");
    fireEvent.click(toggle);

    // The rail renders its labels a transition later, so the row is named by
    // its `title` at this point; either way the accessible name is "Map".
    fireEvent.click(screen.getByRole("link", { name: "Map" }));

    expect(screen.getByLabelText("Collapse sidebar")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
