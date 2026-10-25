import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { apiFetch } from "@/lib/api";
import { newSourceDraft, sourceDraftFrom, type SourceDraft } from "@/lib/sources";
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
}: {
  initial: SourceDraft;
  invalid?: SourceEditorInvalid;
  onPickFile?: (file: File) => void;
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
        tags={tags}
        setTags={setTags}
        invalid={invalid}
      />
      <output data-testid="draft">{JSON.stringify(draft)}</output>
    </>
  );
}

const kindField = () => screen.getByRole("combobox", { name: /^Kind/ });

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
      expect(screen.getByText("No imagery date.")).toBeInTheDocument();
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
        initial={{ ...newSourceDraft(), file: { state: "failed", file, error: "Too large." } }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("clip.mp4: Too large.");
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

  it("marks a source with a file and no link as incomplete until a link is typed", () => {
    render(<Host initial={{ ...newSourceDraft(), file: { state: "stored", media: FILE } }} />);
    expect(screen.getByText("Incomplete: add a link before publishing")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Source 1 link 1"), {
      target: { value: "https://t.me/c/1" },
    });
    expect(screen.queryByText("Incomplete: add a link before publishing")).toBeNull();
  });

  it("does not mark a source without a file as incomplete", () => {
    render(<Host initial={newSourceDraft()} />);
    expect(screen.queryByText("Incomplete: add a link before publishing")).toBeNull();
  });

  it("archives a link from a mark in its field, with the post time under it", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Add source 1 link" }));
    expect(screen.getByRole("button", { name: "Archive source 1, link 2, this link" })).toBeInTheDocument();
  });

  it("flags a source with no URL and no kind", () => {
    render(
      <Host
        initial={{ ...newSourceDraft(), file: { state: "stored", media: FILE } }}
        invalid={{ link: true, kind: true }}
      />
    );
    expect(screen.getByText("Links").className).toContain("text-red-400");
    expect(kindField().className).toContain("border-red-500");
  });

  it("picks a tag of the shared catalogue for this source and removes it", () => {
    render(<Host initial={newSourceDraft()} />);
    const field = screen.getByRole("combobox", { name: "Source 1 tags" });
    fireEvent.change(field, { target: { value: "arm" } });
    fireEvent.click(screen.getByRole("option", { name: "armor" }));
    expect(draftNow().tagIds).toEqual(["t1"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove armor" }));
    expect(draftNow().tagIds).toEqual([]);
  });

  it("offers the graphic switch on a new source", () => {
    render(<Host initial={newSourceDraft()} />);
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
    expect(screen.getByText(/Removing the flag requires an admin/)).toBeInTheDocument();
  });
});
