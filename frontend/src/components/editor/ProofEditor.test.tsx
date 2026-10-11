import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { useCreateBlockNote } from "@blocknote/react";

import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";

import ProofEditor, { referencedProofFiles } from "./ProofEditor";

// The created editor, so a test drives edits through BlockNote's own API (jsdom has no typing).
let editor: ReturnType<typeof useCreateBlockNote>;
vi.mock("@blocknote/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blocknote/react")>();
  return {
    ...actual,
    useCreateBlockNote: (...args: Parameters<typeof actual.useCreateBlockNote>) =>
      (editor = actual.useCreateBlockNote(...args)),
  };
});

const png = (name: string) => new File(["x"], name, { type: "image/png" });

describe("referencedProofFiles", () => {
  const a = { placeholder: "placeholder://a.png", previewUrl: "blob:a", file: png("a.png") };
  const b = { placeholder: "placeholder://b.png", previewUrl: "blob:b", file: png("b.png") };

  it("keeps the files the body still shows, in staging order", () => {
    const html = '<p>x</p><img src="placeholder://b.png"><img src="placeholder://a.png">';
    expect(referencedProofFiles(html, [a, b])).toEqual([a.file, b.file]);
  });

  it("drops a file whose image was deleted", () => {
    expect(referencedProofFiles('<img src="placeholder://a.png">', [a, b])).toEqual([a.file]);
  });

  it("ignores a placeholder that only appears as text or a link", () => {
    const html = '<p>placeholder://a.png <a href="placeholder://b.png">b</a></p>';
    expect(referencedProofFiles(html, [a, b])).toEqual([]);
  });

  it("stages nothing for an uploaded image's media-host src", () => {
    expect(referencedProofFiles('<img src="https://cdn.test/p.jpg">', [a])).toEqual([]);
  });
});

describe("ProofEditor", () => {
  it("seeds from stored HTML without emitting it back", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <ProofEditor onChange={onChange} initialContent="<p>Anchor <strong>points</strong></p>" />,
    );
    await waitFor(() => expect(container.querySelector("strong")).toHaveTextContent("points"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("wears the shared invalid outline when the caller flags it", () => {
    const { container, rerender } = render(<ProofEditor onChange={() => {}} />);
    const box = () => container.firstElementChild as HTMLElement;
    expect(box().className).not.toContain(FORM_INVALID_FIELD);

    rerender(<ProofEditor onChange={() => {}} invalid />);
    expect(box().className).toContain(FORM_INVALID_FIELD);
  });

  it("emits the typed text as HTML and stages only the images the body still shows", async () => {
    const onChange = vi.fn();
    const onProofFilesChange = vi.fn();
    render(<ProofEditor onChange={onChange} onProofFilesChange={onProofFilesChange} />);
    const kept = png("kept.png");
    const dropped = png("dropped.png");

    await act(async () => {
      const keptUrl = await editor.uploadFile!(kept);
      await editor.uploadFile!(dropped);
      editor.replaceBlocks(editor.document, [
        { type: "paragraph", content: "Ruins north of the rail yard" },
        { type: "paragraph" },
        { type: "image", props: { url: keptUrl as string } },
      ]);
    });

    await waitFor(() => expect(onProofFilesChange).toHaveBeenLastCalledWith([kept]));
    const html = onChange.mock.lastCall![0] as string;
    expect(html).toContain("Ruins north of the rail yard");
    expect(html).not.toContain("\uFFFC");
  });

  it("keeps an image out of a text-only body", async () => {
    const seed = '<p>Before</p><img src="https://cdn.test/p.jpg"><p>After</p>';
    const images = render(<ProofEditor onChange={() => {}} initialContent={seed} />).container;
    const textOnly = render(
      <ProofEditor onChange={() => {}} initialContent={seed} allowImages={false} />,
    ).container;

    await waitFor(() => expect(textOnly).toHaveTextContent("After"));
    expect(images.querySelector('[data-content-type="image"]')).not.toBeNull();
    expect(textOnly.querySelector('[data-content-type="image"]')).toBeNull();
  });
});
