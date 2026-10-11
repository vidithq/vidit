import { readFileSync } from "node:fs";
import path from "node:path";

import { getSchema, resolveExtensions, type JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { Node } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { isSafeLinkHref, RICH_TEXT_EXTENSIONS, richTextContract } from "./richText";

describe("richTextContract", () => {
  it("matches the allowlist the server sanitizer loads", async () => {
    // The drift gate: an editor extension added, removed or upgraded without regenerating the
    // backend allowlist fails here. Regenerate with `npx vitest run -u src/lib/richText.test.ts`.
    await expect(`${JSON.stringify(richTextContract(), null, 2)}\n`).toMatchFileSnapshot(
      "../../../backend/app/services/rich_text_contract.json",
    );
  });
});

describe("the server's Markdown projection", () => {
  // `backend/tests/data/rich_text_markdown.json` pairs documents with what
  // `services/rich_text_markdown.tiptap_doc_markdown` writes for them (the backend suite asserts
  // that half). Parsing each Markdown string back with Tiptap's CommonMark parser must give the
  // same document, so the projection's escaping loses nothing.
  const fixtures: Array<{ name: string; doc: JSONContent; markdown: string }> = JSON.parse(
    readFileSync(
      path.resolve(__dirname, "../../../backend/tests/data/rich_text_markdown.json"),
      "utf8",
    ),
  );
  const manager = new MarkdownManager({ extensions: resolveExtensions(RICH_TEXT_EXTENSIONS) });
  const schema = getSchema(RICH_TEXT_EXTENSIONS);
  const { marks, nodes } = richTextContract();

  const keptAttrs = (kept: string[] | undefined, attrs: Record<string, unknown> = {}) => {
    const entries = Object.entries(attrs).filter(
      ([name, value]) => kept?.includes(name) && value !== null,
    );
    return entries.length ? { attrs: Object.fromEntries(entries) } : {};
  };

  // ProseMirror's own form (adjacent runs with the same marks joined), reduced to the attrs the
  // contract keeps, without empty paragraphs, which hold nothing to project.
  const canonical = (json: JSONContent): JSONContent => {
    const strip = (node: JSONContent): JSONContent => {
      const { attrs, content, marks: nodeMarks, ...rest } = node;
      return {
        ...rest,
        ...keptAttrs(nodes[node.type ?? ""], attrs),
        ...(nodeMarks
          ? { marks: nodeMarks.map((m) => ({ type: m.type, ...keptAttrs(marks[m.type], m.attrs) })) }
          : {}),
        ...(content
          ? {
              content: content
                .filter((child) => child.type !== "paragraph" || child.content?.length)
                .map(strip),
            }
          : {}),
      };
    };
    return strip(Node.fromJSON(schema, json).toJSON());
  };

  it.each(fixtures)("reads back as the same document: $name", ({ doc, markdown }) => {
    expect(canonical(manager.parse(markdown))).toEqual(canonical(doc));
  });
});

describe("isSafeLinkHref", () => {
  // The editor mints links against this rule and the renderer re-applies it, so a link the editor
  // allows is one `services/sanitize.py::safe_link_href` keeps.
  it("accepts absolute http(s) URLs with a host", () => {
    expect(isSafeLinkHref("https://x.com/user/status/1")).toBe(true);
    expect(isSafeLinkHref("http://localhost:8000/p")).toBe(true);
    expect(isSafeLinkHref("HTTPS://X.COM/a")).toBe(true);
  });

  it("rejects the other protocols linkify registers by default", () => {
    for (const url of [
      "mailto:analyst@example.com",
      "tel:+33123456789",
      "sms:+33123456789",
      "ftp://files.example.com/x",
      "xmpp:analyst@example.com",
    ]) {
      expect(isSafeLinkHref(url)).toBe(false);
    }
  });

  it("rejects a scheme-less value, an email, and a smuggled javascript: scheme", () => {
    expect(isSafeLinkHref("example.com/a")).toBe(false);
    expect(isSafeLinkHref("analyst@example.com")).toBe(false);
    expect(isSafeLinkHref("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("java\nscript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("https://")).toBe(false);
  });

  it("rejects an href past the 2000-byte ceiling the server applies", () => {
    expect(isSafeLinkHref("https://example.com/" + "x".repeat(2000))).toBe(false);
  });
});
