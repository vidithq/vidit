import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn() }),
  useParams: () => ({ username: "ana" }),
}));

vi.mock("@/hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({ user: { id: "u1", username: "ana" }, loading: false }),
}));

const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

import { recordNavigation } from "@/lib/navigation";
import type { EventDetail } from "@/types";

import DetectionReviewPage from "./page";

function draftFixture(id: string): EventDetail {
  return { id, title: `Draft ${id}` } as EventDetail;
}

function queue(items: EventDetail[]) {
  useApiResource.mockReturnValue({
    data: { items, total: items.length, page: 1, per_page: 100 },
    error: null,
  });
}

beforeEach(() => {
  replace.mockReset();
  useApiResource.mockReset();
  window.sessionStorage.clear();
});

describe("the review entry", () => {
  it("opens the first draft of the queue on its own URL", async () => {
    queue([draftFixture("d7"), draftFixture("d8")]);
    render(<DetectionReviewPage />);
    // The pass lives on the edit route from here: one address per draft, this
    // page replaced in history so Back lands on the queue.
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/events/d7/edit?queue=1")
    );
  });

  it("falls back to the queue list when there is nothing to review", async () => {
    queue([]);
    render(<DetectionReviewPage />);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/profile/ana/detections")
    );
  });
});

describe("the review entry's trace", () => {
  it("keeps itself out of the back-stack before handing over", async () => {
    queue([draftFixture("d7")]);
    render(<DetectionReviewPage />);
    await waitFor(() => expect(replace).toHaveBeenCalled());

    // The next navigation recorded is the one this page's redirect caused, and
    // it must find nothing to record: a doorway left in the chain sends the
    // back arrow through its own redirect and straight back to the draft the
    // reader is trying to leave.
    recordNavigation("/profile/ana/detections/review");
    expect(window.sessionStorage.getItem("vidit:nav-stack")).toBeNull();

    // One-shot: the hop after it records as usual.
    recordNavigation("/events/d7/edit");
    expect(
      JSON.parse(window.sessionStorage.getItem("vidit:nav-stack") ?? "[]")
    ).toEqual(["/events/d7/edit"]);
  });
});
