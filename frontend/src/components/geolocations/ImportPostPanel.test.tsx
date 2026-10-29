import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/lib/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events")>()),
  importFromPost: vi.fn(),
}));

const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

/** The existing row `GET /events/{id}` answers, or the error it answers instead. */
function existingRow(row: { id: string; status: string } | "gone") {
  useApiResource.mockImplementation((path: string | null) =>
    path === null
      ? { data: null, error: null }
      : row === "gone"
        ? { data: null, error: { title: null, message: "Not found.", fields: {} } }
        : { data: row, error: null }
  );
}

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

/** The panel in a stand-in page: its submit in the actions, outside the form. */
function renderPanel() {
  return render(
    <ImportPostPanel
      shell={({ actions, body }) => (
        <>
          <aside aria-label="Actions">{actions}</aside>
          {body}
        </>
      )}
    />
  );
}

function paste() {
  fireEvent.change(screen.getByPlaceholderText("https://x.com/handle/status/…"), {
    target: { value: POST_URL },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create the detection" }));
}

describe("ImportPostPanel", () => {
  beforeEach(() => {
    push.mockClear();
    vi.mocked(importFromPost).mockReset();
    useApiResource.mockReset();
    existingRow("gone");
  });

  it("puts Create the detection in the page's actions, held until a URL is pasted", () => {
    renderPanel();

    const create = within(screen.getByRole("complementary", { name: "Actions" })).getByRole(
      "button",
      { name: "Create the detection" }
    );
    expect(create.closest("form")).toBeNull();
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("https://x.com/handle/status/…"), {
      target: { value: POST_URL },
    });
    expect(create).toBeEnabled();
  });

  it("reads the post on Enter in the field", async () => {
    vi.mocked(importFromPost).mockResolvedValue(outcome({ created: ["d1"] }));
    renderPanel();

    const field = screen.getByPlaceholderText("https://x.com/handle/status/…");
    fireEvent.change(field, { target: { value: POST_URL } });
    fireEvent.submit(field.closest("form")!);

    await waitFor(() => expect(importFromPost).toHaveBeenCalledWith(POST_URL));
  });

  it("opens the review of the detection a clean run created", async () => {
    vi.mocked(importFromPost).mockResolvedValue(outcome({ created: ["d1"] }));
    renderPanel();

    paste();

    await waitFor(() => expect(importFromPost).toHaveBeenCalledWith(POST_URL));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/d1/edit?queue=1"));
  });

  it("stays put and names the warnings, with the review one click away", async () => {
    // The API supplies each code's sentence; the panel keeps no wording.
    vi.mocked(importFromPost).mockResolvedValue(
      outcome({
        created: ["d1", "d2"],
        warnings: [
          { code: "several_coordinates", message: "Several coordinates, one detection each" },
          { code: "source_missing", message: "No footage link in the post. Add one at review" },
        ],
      })
    );
    renderPanel();

    paste();

    expect(await screen.findByText("2 detections created")).toBeInTheDocument();
    expect(screen.getByText("Several coordinates, one detection each")).toBeInTheDocument();
    expect(screen.getByText("No footage link in the post. Add one at review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review the detection" })).toHaveAttribute(
      "href",
      "/events/d1/edit?queue=1"
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("names the refusal when the post produced nothing, as a failure", async () => {
    vi.mocked(importFromPost).mockResolvedValue(
      outcome({ reason: { code: "coords_missing", message: "No coordinate in the post" } })
    );
    renderPanel();

    paste();

    expect(await screen.findByRole("alert")).toHaveTextContent("No coordinate in the post");
    expect(screen.queryByRole("link", { name: "Review the detection" })).toBeNull();
  });

  it("reads a post nothing could be stored from as a failure too", async () => {
    vi.mocked(importFromPost).mockResolvedValue(outcome({ failed: 2 }));
    renderPanel();

    paste();

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't be stored/);
  });

  it("says a post already imported is, and links its detection", async () => {
    vi.mocked(importFromPost).mockResolvedValue(outcome({ skipped: ["d9"] }));
    existingRow({ id: "d9", status: "detected" });
    renderPanel();

    paste();

    await screen.findByText("Already imported");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(useApiResource).toHaveBeenLastCalledWith("/events/d9");
    expect(screen.getByRole("link", { name: "Review the detection" })).toHaveAttribute(
      "href",
      "/events/d9/edit?queue=1"
    );
    expect(push).not.toHaveBeenCalled();
  });

  it.each([
    ["geolocated", "Open the event", "/events/d9"],
    ["closed", "Open the event", "/events/d9"],
    ["requested", "Open the request", "/requests/d9"],
  ])("links a post already imported as a %s row to its page", async (status, name, href) => {
    vi.mocked(importFromPost).mockResolvedValue(outcome({ skipped: ["d9"] }));
    existingRow({ id: "d9", status });
    renderPanel();

    paste();

    await screen.findByText("Already imported");
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    expect(screen.queryByRole("link", { name: "Review the detection" })).toBeNull();
  });

  it("says a post is already imported without a link when its row no longer opens", async () => {
    vi.mocked(importFromPost).mockResolvedValue(outcome({ skipped: ["d9"] }));
    renderPanel();

    paste();

    await screen.findByText("Already imported");
    expect(screen.queryByRole("link", { name: /Review|Open/ })).toBeNull();
  });

  it("opens the detection a re-import overwrote", async () => {
    vi.mocked(importFromPost).mockResolvedValue(
      outcome({
        updated: ["d4"],
        skipped: ["d9"],
        warnings: [{ code: "source_missing", message: "No footage link in the post. Add one at review" }],
      })
    );
    renderPanel();

    paste();

    expect(await screen.findByText("1 updated · 1 already imported")).toBeInTheDocument();
    // The run wrote a row, so the link opens it and nothing reads the skipped one.
    expect(useApiResource).not.toHaveBeenCalledWith("/events/d9");
    expect(screen.getByRole("link", { name: "Review the detection" })).toHaveAttribute(
      "href",
      "/events/d4/edit?queue=1"
    );
  });

  it("falls back to its own line when the run named no refusal at all", async () => {
    vi.mocked(importFromPost).mockResolvedValue(outcome());
    renderPanel();

    paste();

    expect(await screen.findByText(/produced no detection/)).toBeInTheDocument();
  });

  it("renders a refused post's message as the API worded it", async () => {
    vi.mocked(importFromPost).mockRejectedValue(
      new ApiError(
        "That post is by @someone_else. The import only reads posts from @ana.",
        400,
        "not_your_post"
      )
    );
    renderPanel();

    paste();

    expect(await screen.findByText(/That post is by @someone_else/)).toBeInTheDocument();
  });
});
