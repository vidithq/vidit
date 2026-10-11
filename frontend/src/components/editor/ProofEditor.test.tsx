import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";

import ProofEditor, { referencedProofFiles } from "./ProofEditor";

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
});
