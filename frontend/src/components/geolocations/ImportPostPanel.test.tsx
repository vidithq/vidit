import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/lib/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events")>()),
  importFromPost: vi.fn(),
}));

import { ApiError } from "@/lib/api";
import { importFromPost } from "@/lib/events";
import type { TweetImportOutcome } from "@/types";

import { ImportPostPanel } from "./ImportPostPanel";

const POST_URL = "https://x.com/ana/status/1";

function outcome(overrides: Partial<TweetImportOutcome> = {}): TweetImportOutcome {
  return {
    created: [],
    updated: [],
    skipped: [],
    warnings: [],
    reason: null,
    failed: 0,
    ...overrides,
  };
}

function paste() {
  fireEvent.change(screen.getByPlaceholderText(/x\.com/), { target: { value: POST_URL } });
  fireEvent.click(screen.getByRole("button", { name: "Create the draft" }));
}

describe("ImportPostPanel", () => {
  beforeEach(() => {
    push.mockClear();
    vi.mocked(importFromPost).mockReset();
  });

  it("opens the review of the draft a clean run created", async () => {
    vi.mocked(importFromPost).mockResolvedValue(outcome({ created: ["d1"] }));
    render(<ImportPostPanel />);

    paste();

    await waitFor(() => expect(importFromPost).toHaveBeenCalledWith(POST_URL));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/d1/edit?queue=1"));
  });

  it("stays put and names the warnings, with the review one click away", async () => {
    // The API hands each code its sentence, out of the one backend table the
    // bot's reply and the archive's email also read, so the panel renders what
    // it is given and keeps no wording of its own.
    vi.mocked(importFromPost).mockResolvedValue(
      outcome({
        created: ["d1", "d2"],
        warnings: [
          { code: "several_coordinates", message: "Several coordinates, one draft each" },
          { code: "source_missing", message: "No source found. Add one at review" },
        ],
      })
    );
    render(<ImportPostPanel />);

    paste();

    expect(await screen.findByText("2 drafts created")).toBeInTheDocument();
    expect(screen.getByText("Several coordinates, one draft each")).toBeInTheDocument();
    expect(screen.getByText("No source found. Add one at review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review the draft" })).toHaveAttribute(
      "href",
      "/events/d1/edit?queue=1"
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("names the refusal when the post produced nothing", async () => {
    vi.mocked(importFromPost).mockResolvedValue(
      outcome({ reason: { code: "coords_missing", message: "No coordinate in the post" } })
    );
    render(<ImportPostPanel />);

    paste();

    expect(await screen.findByText("No coordinate in the post")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review the draft" })).toBeNull();
  });

  it("falls back to its own line when the run named no refusal at all", async () => {
    vi.mocked(importFromPost).mockResolvedValue(outcome());
    render(<ImportPostPanel />);

    paste();

    expect(await screen.findByText(/produced no draft/)).toBeInTheDocument();
  });

  it("renders a refused post's message as the API worded it", async () => {
    vi.mocked(importFromPost).mockRejectedValue(
      new ApiError(
        "That post is by @someone_else. The import only reads posts from @ana.",
        400,
        "not_your_post"
      )
    );
    render(<ImportPostPanel />);

    paste();

    expect(await screen.findByText(/That post is by @someone_else/)).toBeInTheDocument();
  });
});
