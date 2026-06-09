import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderProof } from "./proof";

const doc = (...content: Record<string, unknown>[]) => ({
  type: "doc",
  content,
});

const text = (t: string, marks?: unknown[]) => ({
  type: "text",
  text: t,
  ...(marks ? { marks } : {}),
});

const paragraph = (...content: unknown[]) => ({
  type: "paragraph",
  content,
});

function renderDoc(d: Record<string, unknown>) {
  return render(<div>{renderProof(d)}</div>).container;
}

describe("renderProof", () => {
  it("returns null for anything that is not a doc root", () => {
    expect(renderProof({})).toBeNull();
    expect(renderProof({ type: "paragraph" })).toBeNull();
    expect(renderProof({ type: "doc" })).toBeNull(); // content missing
  });

  it("renders paragraphs with text marks", () => {
    const container = renderDoc(
      doc(
        paragraph(
          text("bold", [{ type: "bold" }]),
          text("italic", [{ type: "italic" }]),
          text("struck", [{ type: "strike" }]),
          text("mono", [{ type: "code" }])
        )
      )
    );
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("em")).toHaveTextContent("italic");
    expect(container.querySelector("s")).toHaveTextContent("struck");
    expect(container.querySelector("code")).toHaveTextContent("mono");
  });

  it("renders links with noopener noreferrer and a _blank default", () => {
    const container = renderDoc(
      doc(
        paragraph(
          text("source", [
            { type: "link", attrs: { href: "https://example.com/post" } },
          ])
        )
      )
    );
    const a = container.querySelector("a");
    expect(a).toHaveAttribute("href", "https://example.com/post");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("drops the anchor entirely when a link mark has no href", () => {
    const container = renderDoc(
      doc(paragraph(text("orphan", [{ type: "link", attrs: {} }])))
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container).toHaveTextContent("orphan");
  });

  it("clamps heading levels into h1–h6 and defaults to h3", () => {
    const heading = (level: unknown) => ({
      type: "heading",
      attrs: { level },
      content: [text("h")],
    });
    expect(renderDoc(doc(heading(9))).querySelector("h6")).not.toBeNull();
    expect(renderDoc(doc(heading(0))).querySelector("h1")).not.toBeNull();
    expect(renderDoc(doc(heading("2"))).querySelector("h3")).not.toBeNull();
  });

  it("renders images with lazy loading and no-referrer, skipping missing src", () => {
    const container = renderDoc(
      doc(
        { type: "image", attrs: { src: "/media/proof/p.jpg", alt: "ruins" } },
        { type: "image", attrs: {} }
      )
    );
    const imgs = container.querySelectorAll("img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAttribute("src", "/media/proof/p.jpg");
    expect(imgs[0]).toHaveAttribute("alt", "ruins");
    expect(imgs[0]).toHaveAttribute("loading", "lazy");
    expect(imgs[0]).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("renders lists, code blocks, rules, and hard breaks", () => {
    const container = renderDoc(
      doc(
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [paragraph(text("li"))] }],
        },
        {
          type: "orderedList",
          attrs: { start: 4 },
          content: [{ type: "listItem", content: [paragraph(text("4th"))] }],
        },
        { type: "codeBlock", content: [text("const a = 1;"), text("\nb")] },
        { type: "horizontalRule" },
        paragraph(text("line"), { type: "hardBreak" }, text("break"))
      )
    );
    expect(container.querySelector("ul li")).toHaveTextContent("li");
    expect(container.querySelector("ol")).toHaveAttribute("start", "4");
    expect(container.querySelector("pre code")).toHaveTextContent(
      "const a = 1;"
    );
    expect(container.querySelector("hr")).not.toBeNull();
    expect(container.querySelector("br")).not.toBeNull();
  });

  it("silently skips unknown node types", () => {
    const container = renderDoc(
      doc({ type: "iframe", attrs: { src: "https://evil.com" } }, paragraph(text("safe")))
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(container).toHaveTextContent("safe");
  });
});
