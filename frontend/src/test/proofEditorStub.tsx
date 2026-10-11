import type { ComponentProps } from "react";

import type ProofEditor from "@/components/editor/ProofEditor";

/** The one-paragraph body the proof editor emits for unmarked text. */
export function textHtml(text: string): string {
  return `<p>${text}</p>`;
}

function htmlBodyText(html: string | null | undefined): string {
  return html?.replace(/^<p>|<\/p>$/g, "") ?? "";
}

/** Stands in for `ProofEditor` (BlockNote needs layout APIs jsdom lacks): a textarea that prints
 *  its seeded body, emits `textHtml` and exposes the flags the caller passed. Mock it with
 *  `vi.mock("@/components/editor/ProofEditor", () => import("@/test/proofEditorStub"))`. */
export default function ProofEditorStub({
  initialContent,
  onChange,
  allowImages,
  invalid,
}: ComponentProps<typeof ProofEditor>) {
  return (
    <textarea
      aria-label="Description"
      defaultValue={htmlBodyText(initialContent)}
      data-allow-images={String(allowImages)}
      data-invalid={String(invalid)}
      onChange={(e) => onChange(textHtml(e.target.value))}
    />
  );
}
