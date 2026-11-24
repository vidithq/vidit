import type { ComponentProps } from "react";

import type RichTextEditor from "@/components/editor/RichTextEditor";

/** The one-paragraph body the rich-text editor emits for unmarked text. */
export function textHtml(text: string): string {
  return `<p>${text}</p>`;
}

function htmlBodyText(html: string | null | undefined): string {
  return html?.replace(/^<p>|<\/p>$/g, "") ?? "";
}

/** Stands in for `RichTextEditor` (BlockNote needs layout APIs jsdom lacks): a textarea that prints
 *  its seeded body, emits `textHtml` and exposes the flags the caller passed. Mock it with
 *  `vi.mock("@/components/editor/RichTextEditor", () => import("@/test/richTextEditorStub"))`. */
export default function RichTextEditorStub({
  initialContent,
  onChange,
  allowImages,
  invalid,
}: ComponentProps<typeof RichTextEditor>) {
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
