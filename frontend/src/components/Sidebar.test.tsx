import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Sidebar from "./Sidebar";

// The rail reads four sources: who is signed in, whether they are an admin,
// how many detections wait, and the path (for the active highlight). Only the
// first matters here, so the rest are pinned.
const viewer: { avatar_url: string | null } = { avatar_url: null };
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", username: "analyst", avatar_url: viewer.avatar_url },
    loading: false,
  }),
}));
vi.mock("@/contexts/DetectionsContext", () => ({
  useDetectionsCount: () => ({ count: 0 }),
}));
vi.mock("@/hooks/useAdmin", () => ({ useAdmin: () => ({ isAdmin: false }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/map" }));

describe("Sidebar identity row", () => {
  beforeEach(() => {
    viewer.avatar_url = null;
  });

  it("shows the analyst's own picture when they have one", () => {
    viewer.avatar_url = "https://cdn.example.com/analyst.jpg";
    render(<Sidebar />);

    expect(screen.getByAltText("analyst's avatar")).toHaveAttribute(
      "src",
      "https://cdn.example.com/analyst.jpg",
    );
  });

  it("falls back to the icon circle when no picture is set", () => {
    render(<Sidebar />);

    expect(screen.queryByAltText("analyst's avatar")).toBeNull();
    // The row is still the link to the analyst's own profile.
    expect(screen.getByTitle("analyst")).toHaveAttribute(
      "href",
      "/profile/analyst",
    );
  });
});
