import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: "s1" }),
}));

vi.mock("@/hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({ user: { id: "u1", username: "ana" }, loading: false }),
}));

vi.mock("@/components/sites/SiteLocation", () => ({ SiteLocation: () => <div /> }));

vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: () => ({
    data: { id: "s1", name: "Depot North", sources: [], contours: [] },
    error: null,
    refetch: () => {},
  }),
}));

const draft = {
  drafts: [],
  setDrafts: vi.fn(),
  note: "",
  setNote: vi.fn(),
  missing: [] as string[],
  held: null,
  payload: () => ({ captured_at: "2026-10-01T09:00:00Z", links: [] }),
};
vi.mock("@/components/sites/SiteSourceEditor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/sites/SiteSourceEditor")>()),
  SiteSourceEditor: () => <div />,
  useSiteSourceDraft: () => draft,
}));

vi.mock("@/lib/sites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sites")>()),
  fileSiteSource: vi.fn().mockResolvedValue({ id: "src9", duplicate_source_ids: [] }),
}));

import { fileSiteSource } from "@/lib/sites";
import FileSiteSourcePage from "./page";

describe("FileSiteSourcePage", () => {
  it("returns to the site page once the source is filed", async () => {
    render(<FileSiteSourcePage />);
    fireEvent.click(screen.getByRole("button", { name: "File the source" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/sites/s1"));
    expect(fileSiteSource).toHaveBeenCalledWith("s1", draft.payload());
    expect(screen.queryByText("Source filed")).toBeNull();
  });
});
