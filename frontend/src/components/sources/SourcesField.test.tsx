import { useEffect, useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MissingFieldKey } from "@/lib/events";
import type { ProofImages, SourceDraft } from "@/lib/sources";

const upload = vi.hoisted(() => vi.fn());
const importFile = vi.hoisted(() => vi.fn());
const copyProof = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sources")>()),
  uploadSourceFile: upload,
  importSourceFile: importFile,
  stageProofImage: copyProof,
}));

import { newSourceDraft } from "@/lib/sources";
import { pastedSnapshotRefused, sourcesBlockWrite, SourcesField } from "./SourcesField";

/** The list as the host last rendered it. */
const seen: { current: SourceDraft[] } = { current: [] };

function Host({
  initial,
  invalidKeys = new Set(),
  attempt = 0,
  proofImages,
}: {
  initial: SourceDraft[];
  invalidKeys?: Set<MissingFieldKey>;
  attempt?: number;
  proofImages?: ProofImages;
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
      proofImages={proofImages}
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
    copyProof.mockReset();
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

  const stagedFile = (id: string) => ({
    id,
    kind: "image",
    sha256: "0",
    original_filename: `${id}.png`,
    storage_url: `https://cdn/uploads/${id}.png`,
    expires_at: "2099-01-01T00:00:00Z",
  });
  const pick = (name: string, type: string) =>
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["a"], name, { type })] },
    });

  it("uploads a picked file at once and keeps the staged copy", async () => {
    upload.mockResolvedValue([stagedFile("u1")]);
    render(<Host initial={[newSourceDraft()]} />);
    const file = new File(["a"], "a.png", { type: "image/png" });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });

    expect(upload).toHaveBeenCalledWith(file);
    expect(seen.current[0].file?.state).toBe("uploading");
    expect(sourcesBlockWrite(seen.current)).toBe("Wait for the source files to finish uploading.");
    await waitFor(() => expect(seen.current[0].file?.state).toBe("staged"));
    expect(sourcesBlockWrite(seen.current)).toBeNull();
  });

  it("opens a source after the picking one for each further frame of a GIF", async () => {
    upload.mockResolvedValue([stagedFile("f1"), stagedFile("f2"), stagedFile("f3")]);
    const picked = { ...newSourceDraft(), level: "indirect" as const, kind: "satellite" as const };
    const after = withUrl("https://a.example/after");
    render(<Host initial={[picked, after]} />);
    pick("compare.gif", "image/gif");

    await waitFor(() => expect(seen.current).toHaveLength(4));
    expect(seen.current.map((d) => (d.file?.state === "staged" ? d.file.upload.id : null))).toEqual(
      ["f1", "f2", "f3", null]
    );
    expect(seen.current.slice(1, 3).map((d) => [d.level, d.kind])).toEqual([
      ["indirect", "satellite"],
      ["indirect", "satellite"],
    ]);
    expect(seen.current[3].links[0].url).toBe("https://a.example/after");
  });

  it("fails the pick when the frames of a GIF pass the source cap", async () => {
    upload.mockResolvedValue([stagedFile("f1"), stagedFile("f2"), stagedFile("f3")]);
    render(<Host initial={Array.from({ length: 9 }, () => newSourceDraft())} />);
    pick("compare.gif", "image/gif");

    await waitFor(() => expect(seen.current[0].file?.state).toBe("failed"));
    expect(seen.current).toHaveLength(9);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "compare.gif: This GIF holds 3 frames, one file each, and the form has room for 2."
    );
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

  const PROOF = { eventId: "e1", urls: ["https://cdn/proof/a.jpg", "https://cdn/proof/b.jpg"] };
  const useProof = (n: number) =>
    screen.queryByRole("button", { name: `Use a proof image as the file of source ${n}` });

  it("copies a proof image into an empty source, then copies the one picked", async () => {
    const staged = (id: string) => ({
      id,
      kind: "image",
      sha256: "0",
      original_filename: "footage.jpg",
      storage_url: `https://cdn/uploads/${id}.jpg`,
      expires_at: "2099-01-01T00:00:00Z",
    });
    copyProof.mockResolvedValueOnce(staged("u1")).mockResolvedValueOnce(staged("u2"));
    render(<Host initial={[withUrl("https://example.com/a")]} proofImages={PROOF} />);
    fireEvent.click(useProof(1)!);

    expect(copyProof).toHaveBeenCalledWith("e1", PROOF.urls[0]);
    expect(seen.current[0].file?.state).toBe("copying");
    expect(screen.getByRole("status")).toHaveTextContent("Copying proof image 1 of 2…");
    expect(sourcesBlockWrite(seen.current)).toBe("Wait for the source files to finish uploading.");
    await waitFor(() => expect(seen.current[0].file?.state).toBe("staged"));
    expect(useProof(1)).toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "Source 1 proof image" }), {
      target: { value: "1" },
    });
    expect(copyProof).toHaveBeenLastCalledWith("e1", PROOF.urls[1]);
    await waitFor(() => {
      const file = seen.current[0].file;
      expect(file?.state === "staged" && file.upload.id).toBe("u2");
    });
  });

  it("offers a proof image only while no direct or indirect source holds a file", () => {
    const filed: SourceDraft = {
      ...withUrl("https://example.com/a"),
      file: {
        state: "stored",
        media: { id: "m1", role: "source", kind: "image", sha256: "0", storage_url: "https://cdn/m1.jpg" },
      },
    };
    const context: SourceDraft = { ...withUrl("https://example.com/c"), level: "context" };
    const { unmount } = render(
      <Host initial={[filed, withUrl("https://example.com/b")]} proofImages={PROOF} />
    );
    expect(useProof(2)).toBeNull();
    unmount();

    render(<Host initial={[context, withUrl("https://example.com/b")]} proofImages={PROOF} />);
    expect(useProof(1)).toBeNull();
    expect(useProof(2)).not.toBeNull();
  });

  it("prints a proof image refusal under the file slot", async () => {
    copyProof.mockRejectedValue(new Error("This image is not a stored proof image."));
    render(<Host initial={[withUrl("https://example.com/a")]} proofImages={PROOF} />);
    fireEvent.click(useProof(1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Proof image: This image is not a stored proof image."
    );
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
