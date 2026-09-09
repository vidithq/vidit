import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Sidebar from "./Sidebar";

// The rail reads four sources: who is signed in, whether they are an admin,
// how many detections wait, and the path (for the active highlight). The tests
// drive the first two; admin and path are pinned. `vi.hoisted` because the
// `vi.mock` factories below are hoisted above this file's own statements.
const viewer = vi.hoisted(() => ({
  avatar_url: null as string | null,
  detections: 0,
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
vi.mock("next/navigation", () => ({ usePathname: () => "/map" }));

describe("Sidebar identity row", () => {
  beforeEach(() => {
    viewer.avatar_url = null;
    viewer.detections = 0;
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

// Below `sm` the same rail is a drawer behind a top bar. jsdom applies no
// media queries, so both halves of every `max-sm:` / `sm:` pair are in the DOM
// and only the wiring is testable here: the open button's state and the scrim's
// presence, not which one a phone actually paints.
describe("Sidebar drawer controls", () => {
  it("opens the drawer from the top bar and reports it on the button", () => {
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
  });

  it("closes the drawer when the scrim is tapped", () => {
    render(<Sidebar />);

    const open = screen.getByLabelText("Open navigation");
    // The scrim exists only while the drawer is open: nothing to tap before.
    expect(screen.queryByLabelText("Close navigation")).toBeNull();

    fireEvent.click(open);
    fireEvent.click(screen.getByLabelText("Close navigation"));

    expect(open).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Close navigation")).toBeNull();
  });

  // The close-on-navigation rule is the one place the component asks the
  // viewport a question directly (`isPhone`), and jsdom answers no media query
  // on its own, so these two drive `matchMedia` instead.
  const reportPhone = (phone: boolean) =>
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: phone,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }));

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("collapses the drawer when a link inside it is tapped", () => {
    reportPhone(true);
    render(<Sidebar />);

    const open = screen.getByLabelText("Open navigation");
    fireEvent.click(open);
    expect(open).toHaveAttribute("aria-expanded", "true");

    // Map is the row for the pinned pathname, so this is the tap that changes
    // no route: the pathname effect never runs and the drawer would stay open
    // over the page under it. The rail renders collapsed here (labels appear a
    // transition later), so the row is named by its `title`.
    fireEvent.click(screen.getByTitle("Map"));

    expect(open).toHaveAttribute("aria-expanded", "false");
  });

  it("leaves the pinned rail expanded when a link is clicked on a desktop", () => {
    reportPhone(false);
    render(<Sidebar />);

    const toggle = screen.getByLabelText("Expand sidebar");
    fireEvent.click(toggle);

    fireEvent.click(screen.getByTitle("Map"));

    expect(screen.getByLabelText("Collapse sidebar")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
