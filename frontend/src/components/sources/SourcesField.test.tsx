import { useEffect, useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MissingFieldKey } from "@/lib/events";
import type { SourceDraft } from "@/lib/sources";

const upload = vi.hoisted(() => vi.fn());
const importFile = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sources")>()),
  uploadSourceFile: upload,
  importSourceFile: importFile,
}));

import { newSourceDraft } from "@/lib/sources";
import { pastedSnapshotRefused, sourcesBlockWrite, SourcesField } from "./SourcesField";

/** The list as the host last rendered it. */
const seen: { current: SourceDraft[] } = { current: [] };

function Host({
  initial,
  invalidKeys = new Set(),
  attempt = 0,
}: {
  initial: SourceDraft[];
  invalidKeys?: Set<MissingFieldKey>;
  attempt?: number;
}) {
  const [sources, setSources] = useState(initial);
  const [tags, setTags] = useState([{ id: "t1", name: "armor" }]);
  useEffect(() => {
    seen.current = sources;
  });
  return (
    <SourcesField
      sources={sources}
      setSources={setSources}
      tags={tags}
      setTags={setTags}
      invalidKeys={invalidKeys}
      attempt={attempt}
    />
  );
}

const withUrl = (url: string): SourceDraft => {
  const draft = newSourceDraft();
  return { ...draft, links: [{ url, postedAt: "", snapshotUrl: "", stored: null }] };
};

// jsdom has no layout: each editor sits 100px after the previous one in the Sources row, and
// the row records where it was asked to scroll.
const scrolledTo = vi.fn();
const ITEM_LEFT = 100;

function inRow(el: HTMLElement): HTMLElement | null {
  const row = el.parentElement;
  return row?.getAttribute("aria-label") === "Sources" ? row : null;
}

describe("SourcesField", () => {
  beforeEach(() => {
    upload.mockReset();
    scrolledTo.mockReset();
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
      const row = inRow(this);
      return row ? Array.from(row.children).indexOf(this) * ITEM_LEFT : 0;
    });
    vi.spyOn(Element.prototype, "scrollTo").mockImplementation(function (
      this: Element,
      options?: ScrollToOptions | number,
    ) {
      if (this.getAttribute("aria-label") === "Sources") scrolledTo((options as ScrollToOptions).left);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("starts with the editors it is given and adds one per click, showing it", () => {
    render(<Host initial={[newSourceDraft()]} />);
    expect(screen.getAllByRole("region", { name: /^Source \d$/ })).toHaveLength(1);
    // One source: the form needs a source, and there is nothing to move between.
    expect(screen.queryByRole("button", { name: /^Remove source \d$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next source" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add a source" }));
    expect(screen.getAllByRole("region", { name: /^Source \d$/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Remove source 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next source" })).toBeInTheDocument();
    expect(scrolledTo).toHaveBeenLastCalledWith(ITEM_LEFT);
  });

  it("keeps every editor mounted in a row named Sources", () => {
    render(<Host initial={[withUrl("https://a.example/1"), withUrl("https://b.example/2")]} />);
    const row = screen.getByRole("region", { name: "Sources" });
    expect(within(row).getAllByRole("region", { name: /^Source \d$/ })).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "Source 1 link 1" })).toHaveValue("https://a.example/1");
    expect(screen.getByRole("textbox", { name: "Source 2 link 1" })).toHaveValue("https://b.example/2");
  });

  it("removes an editor on a confirming second click and shows its neighbour", () => {
    render(
      <Host
        initial={[
          withUrl("https://a.example/1"),
          withUrl("https://b.example/2"),
          withUrl("https://c.example/3"),
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove source 3" }));
    expect(seen.current).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Confirm removing source 3" }));
    expect(seen.current.map((d) => d.links[0].url)).toEqual([
      "https://a.example/1",
      "https://b.example/2",
    ]);
    expect(scrolledTo).toHaveBeenLastCalledWith(ITEM_LEFT);

    fireEvent.click(screen.getByRole("button", { name: "Remove source 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm removing source 1" }));
    expect(seen.current.map((d) => d.links[0].url)).toEqual(["https://b.example/2"]);
  });

  it("shows the first source with a gap on a publish attempt", () => {
    const complete = { ...withUrl("https://a.example/1"), kind: "drone" as const };
    const { rerender } = render(<Host initial={[complete, withUrl("https://b.example/2")]} />);
    expect(scrolledTo).not.toHaveBeenCalled();
    rerender(
      <Host
        initial={[complete, withUrl("https://b.example/2")]}
        invalidKeys={new Set(["source_kind"])}
        attempt={1}
      />
    );
    expect(scrolledTo).toHaveBeenLastCalledWith(ITEM_LEFT);
  });

  it("stops adding at the source cap and says what the cap is", () => {
    render(<Host initial={Array.from({ length: 10 }, () => newSourceDraft())} />);
    expect(screen.getByRole("button", { name: "Add a source" })).toBeDisabled();
    expect(screen.getByText("10 maximum.")).toBeInTheDocument();
  });

  it("uploads a picked file at once and keeps the staged copy", async () => {
    upload.mockResolvedValue({
      id: "u1",
      kind: "image",
      sha256: "0",
      original_filename: "a.png",
      storage_url: "https://cdn/uploads/a.png",
      expires_at: "2099-01-01T00:00:00Z",
    });
    render(<Host initial={[newSourceDraft()]} />);
    const file = new File(["a"], "a.png", { type: "image/png" });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });

    expect(upload).toHaveBeenCalledWith(file);
    expect(seen.current[0].file?.state).toBe("uploading");
    expect(sourcesBlockWrite(seen.current)).toBe("Wait for the source files to finish uploading.");
    await waitFor(() => expect(seen.current[0].file?.state).toBe("staged"));
    expect(sourcesBlockWrite(seen.current)).toBeNull();
  });

  it("imports a link's file, then re-imports the file picked from the post", async () => {
    const staged = (id: string) => ({
      id,
      kind: "image",
      sha256: "0",
      original_filename: null,
      storage_url: `https://cdn/uploads/${id}`,
      expires_at: "2099-01-01T00:00:00Z",
      post_media: ["image", "video"],
    });
    importFile.mockResolvedValueOnce(staged("u1")).mockResolvedValueOnce(staged("u2"));
    const url = "https://x.com/someone/status/1";
    render(<Host initial={[withUrl(url)]} />);
    fireEvent.click(screen.getByRole("button", { name: /^Import the file of source 1/ }));

    expect(importFile).toHaveBeenCalledWith(url, 0);
    expect(seen.current[0].file?.state).toBe("importing");
    expect(sourcesBlockWrite(seen.current)).toBe("Wait for the source files to finish uploading.");
    await waitFor(() => expect(seen.current[0].file?.state).toBe("staged"));

    fireEvent.change(screen.getByRole("combobox", { name: "Source 1 file from the post" }), {
      target: { value: "1" },
    });
    expect(importFile).toHaveBeenLastCalledWith(url, 1);
    await waitFor(() => {
      const file = seen.current[0].file;
      expect(file?.state === "staged" && file.upload.id).toBe("u2");
    });
  });

  it("prints an import refusal under the file slot", async () => {
    importFile.mockRejectedValue(new Error("The post serves no file."));
    render(<Host initial={[withUrl("https://t.me/channel/12345")]} />);
    fireEvent.click(screen.getByRole("button", { name: /^Import the file of source 1/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("t.me: The post serves no file.");
  });

  it("flags the section when no direct or indirect source carries a file", () => {
    render(<Host initial={[newSourceDraft()]} invalidKeys={new Set(["source_file"])} />);
    expect(screen.getByText("Add a file to a direct or indirect source.")).toBeInTheDocument();
  });
});

describe("pastedSnapshotRefused", () => {
  it("refuses a paste off the archive hosts and lets a blank one pass", () => {
    const draft = withUrl("https://t.me/c/1");
    expect(pastedSnapshotRefused([draft])).toBe(false);
    const pasted = (snapshotUrl: string) => [
      { ...draft, links: [{ ...draft.links[0], snapshotUrl }] },
    ];
    expect(pastedSnapshotRefused(pasted("https://evil.example/x"))).toBe(true);
    expect(pastedSnapshotRefused(pasted("https://archive.ph/abcde"))).toBe(false);
  });
});
