import { describe, expect, it } from "vitest";

import { markdownPasteContent } from "./markdownPaste";

describe("markdownPasteContent", () => {
  it("leaves plain prose to the default paste", () => {
    expect(markdownPasteContent("Strikes on Kupiansk.\nSecond line, no markup.")).toBeNull();
    expect(markdownPasteContent("#Kupiansk #Ukraine")).toBeNull();
  });

  it("converts Markdown blocks and marks into the contract's nodes", () => {
    const content = markdownPasteContent(
      "## Method\n\n1. Match the **ridge**\n2. Check `shadows`\n\n> quoted\n\n- a\n- b\n\n---",
    );
    expect(content?.map((node) => node.type)).toEqual([
      "heading",
      "orderedList",
      "blockquote",
      "bulletList",
      "horizontalRule",
    ]);
    expect(content?.[0].attrs?.level).toBe(2);
    const firstItem = content?.[1].content?.[0].content?.[0].content;
    expect(firstItem).toContainEqual({ type: "text", text: "ridge", marks: [{ type: "bold" }] });
  });

  it("moves a heading level outside the contract into it", () => {
    expect(markdownPasteContent("# Title")?.[0].attrs?.level).toBe(2);
    expect(markdownPasteContent("#### Deep")?.[0].attrs?.level).toBe(3);
  });

  it("keeps an http(s) link and drops any other link mark, text kept", () => {
    const content = markdownPasteContent(
      "[source](https://x.com/a/status/1) and [bad](javascript:alert(1))",
    );
    const runs = content?.[0].content ?? [];
    expect(runs[0]).toMatchObject({
      text: "source",
      marks: [{ type: "link", attrs: { href: "https://x.com/a/status/1" } }],
    });
    expect(runs.find((run) => run.text === "bad")).toEqual({ type: "text", text: "bad" });
  });

  it("drops a Markdown image, which would skip the proof-image upload", () => {
    const content = markdownPasteContent("**see** ![](https://attacker.example/p.gif)");
    expect(JSON.stringify(content)).not.toContain("image");
  });

  it("turns a soft line break into a hard break, outside code only", () => {
    const content = markdownPasteContent("**a**\nb\n\n```\nx\ny\n```");
    expect(content?.[0].content?.map((node) => node.type)).toEqual(["text", "hardBreak", "text"]);
    expect(content?.[1]).toMatchObject({ type: "codeBlock", content: [{ text: "x\ny" }] });
  });
});
