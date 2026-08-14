import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
