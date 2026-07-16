import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Tiptap's useEditor boots ProseMirror, which needs DOM APIs jsdom lacks. We
// only assert the toolbar wiring, so stub the editor: truthy (so the component
// renders past `if (!editor) return null`) with the `isActive` it calls at
// render time for button styling.
vi.mock("@tiptap/react", () => ({
  useEditor: () => ({ isActive: () => false }),
  EditorContent: () => null,
}));

import ProofEditor, {
  fileToDataUrl,
  matchInitialProofFiles,
  resolveProofDoc,
  uniqueDataUrl,
} from "./ProofEditor";

describe("ProofEditor", () => {
  it("offers the proof-image control by default (upload-at-publish)", () => {
    // The image is held locally (blob preview + retained File) and uploaded
    // only at publish via `proof_files[]`, so the control is live, not the old
    // disabled placeholder.
    render(<ProofEditor onChange={() => {}} />);
    const control = screen.getByText("+ Image");
    expect(control).toBeInTheDocument();
    // It's a label wrapping a hidden file input, not a disabled button.
    expect(control.querySelector('input[type="file"]')).not.toBeNull();
  });

  it("drops the image control when allowImages is false", () => {
    // A request's proof maps to the same `events.proof` column, in progress
    // (else it'd be a geolocation), and stays image-free there.
    render(<ProofEditor onChange={() => {}} allowImages={false} />);
    expect(screen.queryByText("+ Image")).toBeNull();
    // Formatting controls stay.
    expect(screen.getByRole("button", { name: "B" })).toBeInTheDocument();
  });
});

describe("import-hydration preview matching (identical-content collision)", () => {
  // Two imported files with the exact same bytes but different names: a
  // `data:` preview URL is derived only from content, so both files resolve
  // to the identical string. `uniqueDataUrl` is what stops that collision
  // from collapsing the pair onto a single file in `resolveProofDoc`.
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const fileA = new File([bytes], "a.jpg", { type: "image/jpeg" });
  const fileB = new File([bytes], "b.jpg", { type: "image/jpeg" });
  const doc = {
    type: "doc",
    content: [
      { type: "image", attrs: { src: "placeholder://a.jpg" } },
      { type: "image", attrs: { src: "placeholder://b.jpg" } },
    ],
  };

  it("matches both placeholders to their own file", () => {
    const matched = matchInitialProofFiles(doc, [fileA, fileB]);
    expect(matched).toHaveLength(2);
    expect(matched.map((m) => m.placeholder).sort()).toEqual([
      "placeholder://a.jpg",
      "placeholder://b.jpg",
    ]);
  });

  it("keeps two placeholders and emits two files even though the underlying data: URLs collide", async () => {
    const matched = matchInitialProofFiles(doc, [fileA, fileB]);

    // Sanity: same bytes really do produce the same raw data: URL, so the
    // fix can't be relying on the browser somehow telling them apart.
    const rawDataUrls = await Promise.all(matched.map((m) => fileToDataUrl(m.file)));
    expect(rawDataUrls[0]).toBe(rawDataUrls[1]);

    const entries = await Promise.all(
      matched.map(async ({ placeholder, file }) => ({
        placeholder,
        file,
        previewUrl: uniqueDataUrl(await fileToDataUrl(file), placeholder),
      }))
    );
    expect(entries[0].previewUrl).not.toBe(entries[1].previewUrl);

    // Hydrate the doc the way the import effect does: each placeholder src
    // is rewritten to its (now-unique) preview URL.
    const byPlaceholder = new Map(entries.map((e) => [e.placeholder, e.previewUrl]));
    const hydrated = structuredClone(doc);
    for (const node of hydrated.content) {
      node.attrs.src = byPlaceholder.get(node.attrs.src) ?? node.attrs.src;
    }

    const { doc: emitted, files } = resolveProofDoc(hydrated, entries);

    const emittedContent = emitted.content as { attrs: { src: string } }[];
    const emittedSrcs = emittedContent.map((n) => n.attrs.src);
    expect(new Set(emittedSrcs).size).toBe(2);
    expect(emittedSrcs.sort()).toEqual(["placeholder://a.jpg", "placeholder://b.jpg"]);

    expect(files).toHaveLength(2);
    expect(files.map((f) => f.name).sort()).toEqual(["a.jpg", "b.jpg"]);
  });
});
