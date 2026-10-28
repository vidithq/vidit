import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { apiFetch } from "@/lib/api";
import {
  newSourceDraft,
  SOURCE_FIELDS,
  sourceDraftFrom,
  type LinkPost,
  type SourceDraft,
} from "@/lib/sources";
import { source } from "@/test/eventDetail";
import type { Tag } from "@/types";

import { SourceEditor, type SourceEditorInvalid } from "./SourceEditor";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  apiFetch: vi.fn(),
}));

const SNAPSHOT_PLACEHOLDER =
  "Paste a snapshot link (web.archive.org, archive.today, ghostarchive.org)";

const FILE = {
  id: "m1",
  role: "source" as const,
  kind: "image" as const,
  sha256: "0",
  storage_url: "https://cdn/x.jpg",
};

/** A stateful host, so edits round-trip through the draft as they do in the form. */
function Host({
  initial,
  invalid,
  onPickFile = () => {},
  onImportLink = () => {},
}: {
  initial: SourceDraft;
  invalid?: SourceEditorInvalid;
  onPickFile?: (file: File) => void;
  onImportLink?: (post: LinkPost) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [tags, setTags] = useState<Tag[]>([{ id: "t1", name: "armor" }]);
  return (
    <>
      <SourceEditor
        draft={draft}
        index={0}
        update={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        onPickFile={onPickFile}
        onImportLink={onImportLink}
        tags={tags}
        setTags={setTags}
        invalid={invalid}
      />
      <output data-testid="draft">{JSON.stringify(draft)}</output>
    </>
  );
}

const kindField = () => screen.getByRole("combobox", { name: /^Kind/ });

const details = () => screen.getByRole("button", { name: "Capture details" });
const openDetails = () => fireEvent.click(details());

const draftNow = (): SourceDraft =>
  JSON.parse(screen.getByTestId("draft").textContent ?? "{}") as SourceDraft;

describe("SourceEditor", () => {
  it("starts a new source as a direct one with one blank link and no file", () => {
    render(<Host initial={newSourceDraft()} />);
    expect(screen.getByRole("region", { name: "Source 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Direct" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Source 1 link 1")).toHaveValue("");
    // Every source names its kind, with or without a file: none is picked yet.
    expect(kindField()).toHaveValue("");
    expect(kindField()).toBeEnabled();
  });

  it("greys the kind's prompt like a placeholder until a kind is picked", () => {
    render(<Host initial={newSourceDraft()} />);
    const grey = () => kindField().classList.contains("text-neutral-600");
    expect(grey()).toBe(true);
    fireEvent.change(kindField(), { target: { value: "drone" } });
    expect(grey()).toBe(false);
  });

  it("names the kind of a source without a file", () => {
    render(<Host initial={newSourceDraft()} />);
    fireEvent.change(kindField(), { target: { value: "article" } });
    expect(draftNow().kind).toBe("article");
  });

  it("shows the provider's reopening help and credit as a satellite link is typed", async () => {
    vi.useFakeTimers();
    const earth = "https://earth.google.com/web/@47.09,37.54,50a";
    (apiFetch as unknown as Mock).mockResolvedValue({
      links: [
        {
          url: earth,
          provider: {
            id: "google_earth",
            name: "Google Earth web",
            group: "accepted",
            credit: "Google",
            help: "Step to the capture day and copy the link.",
          },
        },
      ],
      warnings: [{ code: "permalink_shape", message: "No imagery date.", url: earth }],
    });
    try {
      render(<Host initial={newSourceDraft()} />);
      fireEvent.change(kindField(), { target: { value: "satellite" } });
      fireEvent.change(screen.getByLabelText("Source 1 link 1"), { target: { value: earth } });
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(apiFetch).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Step to the capture day and copy the link.")).toBeInTheDocument();
      expect(screen.getByText("Credit: Google")).toBeInTheDocument();
      expect(screen.queryByText("No imagery date.")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides the capture position of a document kind", () => {
    render(<Host initial={newSourceDraft()} />);
    expect(screen.getByText("Capture position")).toBeInTheDocument();
    for (const kind of ["article", "official_statement", "other"]) {
      fireEvent.change(kindField(), { target: { value: kind } });
      expect(screen.queryByText("Capture position")).toBeNull();
    }
    fireEvent.change(kindField(), { target: { value: "drone" } });
    expect(screen.getByText("Capture position")).toBeInTheDocument();
  });

  it("hands a picked file to the list, which uploads it", () => {
    const onPickFile = vi.fn();
    render(<Host initial={newSourceDraft()} onPickFile={onPickFile} />);
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });
    expect(onPickFile).toHaveBeenCalledWith(file);
  });

  it("says a file is uploading, and why an upload failed", () => {
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    const { unmount } = render(
      <Host initial={{ ...newSourceDraft(), file: { state: "uploading", file, token: 1 } }} />
    );
    expect(screen.getByText(/Uploading clip\.mp4/)).toBeInTheDocument();
    unmount();
    render(
      <Host
        initial={{ ...newSourceDraft(), file: { state: "failed", name: file.name, error: "Too large." } }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("clip.mp4: Too large.");
  });

  it("offers each importable link row's file import while the source has no file", () => {
    const onImportLink = vi.fn();
    const url = "https://t.me/channel/12345";
    const draft = newSourceDraft();
    const link = (u: string) => ({ ...draft.links[0], url: u });
    const { unmount } = render(
      <Host
        initial={{ ...draft, links: [link(url), link("https://example.com/article")] }}
        onImportLink={onImportLink}
      />
    );
    const imports = screen.getAllByRole("button", { name: /^Import the file of/ });
    expect(imports).toHaveLength(1);
    fireEvent.click(imports[0]);
    expect(onImportLink).toHaveBeenCalledWith({ url, index: 0, kinds: [] });
    unmount();

    render(<Host initial={{ ...newSourceDraft(), file: { state: "stored", media: FILE } }} />);
    expect(screen.queryByRole("button", { name: /^Import the file of/ })).toBeNull();
  });

  it("says a link's file is importing", () => {
    const post = { url: "https://x.com/someone/status/1", index: 0, kinds: [] };
    render(<Host initial={{ ...newSourceDraft(), file: { state: "importing", post, token: 1 } }} />);
    expect(screen.getByText(/Importing the file from x\.com/)).toBeInTheDocument();
  });

  it("keeps the kind when the file is removed", () => {
    render(
      <Host
        initial={{ ...newSourceDraft(), kind: "drone", file: { state: "stored", media: FILE } }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove media" }));
    expect(draftNow().file).toBeNull();
    expect(draftNow().kind).toBe("drone");
  });

  it("says nothing of a missing link until a publish attempt flags it", () => {
    render(<Host initial={{ ...newSourceDraft(), file: { state: "stored", media: FILE } }} />);
    expect(screen.queryByText(/^Incomplete/)).toBeNull();
    // The list heads its rows with the count of its links, red while a publish flags it.
    expect(screen.getByText("Links (0)").parentElement!.className).not.toContain("text-red-400");
  });

  it("archives a link from the archive box in its row, beside its post time", () => {
    render(<Host initial={newSourceDraft()} />);
    fireEvent.change(screen.getByLabelText("Source 1 link 1"), {
      target: { value: "https://t.me/c/1" },
    });
    expect(screen.getByLabelText("Posted (UTC), source 1, t.me")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(SNAPSHOT_PLACEHOLDER)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Archive source 1, t.me" }));
    fireEvent.change(screen.getByPlaceholderText(SNAPSHOT_PLACEHOLDER), {
      target: { value: "https://archive.ph/abcde" },
    });
    expect(draftNow().links[0]).toMatchObject({
      url: "https://t.me/c/1",
      snapshotUrl: "https://archive.ph/abcde",
    });
    // The pasted snapshot shows in the box as the copy it will be.
    expect(
      screen.getByRole("link", { name: "archive.today copy of source 1, t.me" })
    ).toHaveAttribute("href", "https://archive.ph/abcde");
  });

  it("reads in the order of the event page's source block, the rest under Capture details", () => {
    render(<Host initial={newSourceDraft()} />);
    // The table's order up to the links; the rest sits under Capture details.
    const labels = Object.values(SOURCE_FIELDS).map(({ label }) => label);
    const essentials = labels.slice(0, labels.indexOf(SOURCE_FIELDS.links.label) + 1);
    const order = [...essentials, "Capture details"].map(
      (text) => screen.getByText(text, { exact: false, selector: "span, label, button" })
    );
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i])).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      );
    }
  });

  it("keeps the secondary fields under a closed Capture details on a new source", () => {
    render(<Host initial={newSourceDraft()} />);
    expect(details()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("switch", { name: "Source 1 graphic content" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Source 1 tags" })).toBeNull();
    openDetails();
    expect(screen.getByLabelText("Captured", { selector: "input" })).toBeVisible();
    expect(screen.getByRole("switch", { name: "Source 1 graphic content" })).toBeVisible();
  });

  it("opens Capture details on a source that holds one of its fields", () => {
    render(<Host initial={{ ...newSourceDraft(), capturedAt: "2026-01-01T10:00" }} />);
    expect(details()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Captured", { selector: "input" })).toHaveValue("2026-01-01T10:00");
  });

  it("opens the copy a stored link carries, and still offers to replace it", () => {
    const stored = source({
      links: [
        {
          url: "https://t.me/c/1",
          posted_at: null,
          archived: {
            url: "https://archive.ph/abcde",
            provider: "archive_today",
            archived_at: "2026-06-01T00:00:00Z",
          },
        },
      ],
    });
    render(<Host initial={sourceDraftFrom(stored)} />);
    expect(
      screen.getByRole("link", { name: "archive.today copy of source 1, t.me" })
    ).toHaveAttribute("href", "https://archive.ph/abcde");
    // The paste line starts closed, holding the stored copy the write posts back.
    expect(screen.queryByPlaceholderText(SNAPSHOT_PLACEHOLDER)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Replace the archived copy of source 1, t.me" })
    );
    expect(screen.getByPlaceholderText(SNAPSHOT_PLACEHOLDER)).toHaveValue(
      "https://archive.ph/abcde"
    );
  });

  it("names each link by its position once the source holds several", () => {
    render(<Host initial={newSourceDraft()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a link to source 1" }));
    expect(screen.getByRole("button", { name: "Archive source 1, link 2, this link" })).toBeInTheDocument();
  });

  it("flags a source with no URL and no kind", () => {
    render(
      <Host
        initial={{ ...newSourceDraft(), file: { state: "stored", media: FILE } }}
        invalid={{ link: true, kind: true }}
      />
    );
    expect(screen.getByText("Links (0)").parentElement!.className).toContain("text-red-400");
    expect(kindField().className).toContain("border-red-500");
  });

  it("picks a tag of the shared catalogue for this source and removes it", () => {
    render(<Host initial={newSourceDraft()} />);
    openDetails();
    const field = screen.getByRole("combobox", { name: "Source 1 tags" });
    fireEvent.change(field, { target: { value: "arm" } });
    fireEvent.click(screen.getByRole("option", { name: "armor" }));
    expect(draftNow().tagIds).toEqual(["t1"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove armor" }));
    expect(draftNow().tagIds).toEqual([]);
  });

  it("offers the graphic switch on a new source", () => {
    render(<Host initial={newSourceDraft()} />);
    openDetails();
    const toggle = screen.getByRole("switch", { name: "Source 1 graphic content" });
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    expect(draftNow().isGraphic).toBe(true);
  });

  it("locks the graphic switch on an already-flagged stored source", () => {
    render(<Host initial={sourceDraftFrom(source({ is_graphic: true }))} />);
    const toggle = screen.getByRole("switch", { name: "Source 1 graphic content" });
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    expect(screen.getByText("admin only")).toBeInTheDocument();
    // What the flag does, and who removes it, is the `?` beside it.
    expect(screen.getByRole("button", { name: "What does the graphic flag do?" })).toBeInTheDocument();
  });
});

describe("SourceEditor as a site source", () => {
  it("explains the required capture time, not the optional one of an event source", () => {
    render(
      <SourceEditor
        draft={{ ...newSourceDraft(), kind: "satellite", level: "context" }}
        index={0}
        variant="site-source"
        name="Source 1"
        update={() => {}}
        onPickFile={() => {}}
        onImportLink={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "When was the source captured?" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "What is the capture time?" })).not.toBeInTheDocument();
  });

  it("imports the file of a post link, like an event source", () => {
    const onImportLink = vi.fn();
    const url = "https://x.com/someone/status/1";
    const draft = newSourceDraft();
    render(
      <SourceEditor
        draft={{ ...draft, kind: "satellite", level: "context", links: [{ ...draft.links[0], url }] }}
        index={0}
        variant="site-source"
        name="Source 1"
        update={() => {}}
        onPickFile={() => {}}
        onImportLink={onImportLink}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Import the file of/ }));
    expect(onImportLink).toHaveBeenCalledWith({ url, index: 0, kinds: [] });
  });
});
