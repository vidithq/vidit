import { Extension, resolveExtensions, type JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { Plugin } from "@tiptap/pm/state";

import { HEADING_LEVELS, isSafeLinkHref, RICH_TEXT_EXTENSIONS } from "@/lib/richText";

// A line that opens a Markdown block, or inline strong, code or an http(s) link anywhere. Plain
// prose matches none of these, so it keeps the default paste (one paragraph per line).
const MARKDOWN_HINT =
  /^(#{1,6} |[-*+] |\d+[.)] |> |```|(-{3,}|\*{3,})\s*$)|\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\//m;

let manager: MarkdownManager | null = null;

const clampLevel = (level: unknown): number => {
  const [min, max] = [HEADING_LEVELS[0], HEADING_LEVELS[HEADING_LEVELS.length - 1]];
  return typeof level === "number" ? Math.min(Math.max(level, min), max) : min;
};

/** Narrows parsed Markdown to what the editor can publish. An image drops (proof images enter
 * through "+ Image", which stages the upload), a link drops its mark unless `isSafeLinkHref`
 * passes, a heading level moves into `HEADING_LEVELS`, and a soft line break inside a paragraph
 * becomes a hard break, so the published body keeps the lines the editor showed. */
function toContract(node: JSONContent, inCode = false): JSONContent[] {
  if (node.type === "image") return [];
  if (node.type === "text") {
    const marks = node.marks?.filter(
      (mark) =>
        mark.type !== "link" ||
        (typeof mark.attrs?.href === "string" && isSafeLinkHref(mark.attrs.href)),
    );
    const base: JSONContent = marks?.length ? { ...node, marks } : { type: "text", text: node.text };
    if (inCode || !node.text?.includes("\n")) return node.text ? [base] : [];
    return node.text
      .split("\n")
      .flatMap((part, i) => [
        ...(i > 0 ? [{ type: "hardBreak" }] : []),
        ...(part ? [{ ...base, text: part }] : []),
      ]);
  }
  const content = node.content?.flatMap((child) =>
    toContract(child, inCode || node.type === "codeBlock"),
  );
  const attrs = node.type === "heading" ? { ...node.attrs, level: clampLevel(node.attrs?.level) } : node.attrs;
  return [{ ...node, ...(attrs ? { attrs } : {}), ...(content ? { content } : {}) }];
}

/** The editor content for a pasted plain-text string, or `null` when it does not read as
 * Markdown. */
export function markdownPasteContent(text: string): JSONContent[] | null {
  if (!MARKDOWN_HINT.test(text)) return null;
  manager ??= new MarkdownManager({ extensions: resolveExtensions(RICH_TEXT_EXTENSIONS) });
  const content = toContract(manager.parse(text))[0]?.content ?? [];
  return content.length > 0 ? content : null;
}

/** Converts a plain-text paste that reads as Markdown into formatted content. A paste carrying
 * HTML (a web page, another editor) keeps Tiptap's own handling. */
export const MarkdownPaste = Extension.create({
  name: "markdownPaste",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handlePaste(view, event) {
            const data = event.clipboardData;
            if (!data || data.types.includes("text/html")) return false;
            if (view.state.selection.$from.parent.type.spec.code) return false;
            const content = markdownPasteContent(data.getData("text/plain"));
            if (!content) return false;
            return editor.commands.insertContent(content);
          },
        },
      }),
    ];
  },
});
