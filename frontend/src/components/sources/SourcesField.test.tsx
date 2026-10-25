import { useEffect, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MissingFieldKey } from "@/lib/events";
import type { SourceDraft } from "@/lib/sources";

const upload = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sources")>()),
  uploadSourceFile: upload,
}));

import { newSourceDraft } from "@/lib/sources";
import { pastedSnapshotRefused, sourcesBlockWrite, SourcesField } from "./SourcesField";

/** The list as the host last rendered it. */
const seen: { current: SourceDraft[] } = { current: [] };

function Host({
  initial,
  invalidKeys = new Set(),
}: {
  initial: SourceDraft[];
  invalidKeys?: Set<MissingFieldKey>;
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
    />
  );
}

const withUrl = (url: string): SourceDraft => {
  const draft = newSourceDraft();
  return { ...draft, links: [{ url, postedAt: "", snapshotUrl: "", stored: null }] };
};

describe("SourcesField", () => {
  beforeEach(() => upload.mockReset());

  it("starts with the editors it is given and adds one per click", () => {
    render(<Host initial={[newSourceDraft()]} />);
    expect(screen.getAllByRole("region", { name: /^Source \d$/ })).toHaveLength(1);
    // One source: the form needs a source.
    expect(screen.queryByRole("button", { name: /^Remove source \d$/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add a source" }));
    expect(screen.getAllByRole("region", { name: /^Source \d$/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Remove source 2" })).toBeInTheDocument();
  });

  it("removes an editor", () => {
    render(<Host initial={[withUrl("https://a.example/1"), withUrl("https://b.example/2")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove source 1" }));
    expect(seen.current.map((d) => d.links[0].url)).toEqual(["https://b.example/2"]);
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
