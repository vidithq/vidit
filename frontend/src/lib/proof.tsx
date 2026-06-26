import type { ReactNode } from "react";

type TiptapNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  content?: TiptapNode[];
};

const intAttr = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) ? v : undefined;

const stringAttr = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

function applyMarks(text: string, marks: TiptapNode["marks"]): ReactNode {
  if (!marks || marks.length === 0) return text;
  return marks.reduce<ReactNode>((acc, mark) => {
    switch (mark.type) {
      case "bold":
        return <strong>{acc}</strong>;
      case "italic":
        return <em>{acc}</em>;
      case "strike":
        return <s>{acc}</s>;
      case "code":
        return (
          <code className="px-1 py-0.5 rounded-sm bg-neutral-800 text-orange-300 text-xs">
            {acc}
          </code>
        );
      case "link": {
        const href = stringAttr(mark.attrs?.href);
        if (!href) return acc;
        const target = stringAttr(mark.attrs?.target);
        return (
          <a
            href={href}
            target={target ?? "_blank"}
            rel="noopener noreferrer"
            className="text-orange-400 hover:underline"
          >
            {acc}
          </a>
        );
      }
      default:
        return acc;
    }
  }, text);
}

function renderInline(content: TiptapNode[] | undefined): ReactNode {
  if (!content) return null;
  return content.map((node, i) => {
    if (node.type === "text" && typeof node.text === "string") {
      return <span key={i}>{applyMarks(node.text, node.marks)}</span>;
    }
    if (node.type === "hardBreak") {
      return <br key={i} />;
    }
    return null;
  });
}

function renderBlock(node: TiptapNode, key: number): ReactNode {
  switch (node.type) {
    case "paragraph":
      return <p key={key}>{renderInline(node.content)}</p>;
    case "heading": {
      const level = intAttr(node.attrs?.level) ?? 3;
      const tag = `h${Math.min(Math.max(level, 1), 6)}` as
        | "h1"
        | "h2"
        | "h3"
        | "h4"
        | "h5"
        | "h6";
      const sizes: Record<typeof tag, string> = {
        h1: "text-2xl font-bold mt-4 mb-2",
        h2: "text-xl font-bold mt-4 mb-2",
        h3: "text-lg font-semibold mt-3 mb-2",
        h4: "text-base font-semibold mt-2 mb-1",
        h5: "text-sm font-semibold mt-2 mb-1",
        h6: "text-xs font-semibold uppercase tracking-wider mt-2 mb-1",
      };
      const Tag = tag;
      return (
        <Tag key={key} className={sizes[tag]}>
          {renderInline(node.content)}
        </Tag>
      );
    }
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="border-l-2 border-neutral-700 pl-4 my-3 text-neutral-400"
        >
          {(node.content ?? []).map((c, i) => renderBlock(c, i))}
        </blockquote>
      );
    case "bulletList":
      return (
        <ul key={key} className="list-disc pl-6 my-2 space-y-1">
          {(node.content ?? []).map((c, i) => renderBlock(c, i))}
        </ul>
      );
    case "orderedList": {
      const start = intAttr(node.attrs?.start);
      return (
        <ol
          key={key}
          start={start}
          className="list-decimal pl-6 my-2 space-y-1"
        >
          {(node.content ?? []).map((c, i) => renderBlock(c, i))}
        </ol>
      );
    }
    case "listItem":
      return (
        <li key={key}>
          {(node.content ?? []).map((c, i) => renderBlock(c, i))}
        </li>
      );
    case "codeBlock":
      return (
        <pre
          key={key}
          className="bg-neutral-950 border border-neutral-800 rounded-sm p-3 my-3 overflow-x-auto text-xs"
        >
          <code>{(node.content ?? []).map((c) => c.text ?? "").join("")}</code>
        </pre>
      );
    case "horizontalRule":
      return <hr key={key} className="my-4 border-neutral-800" />;
    case "image": {
      const src = stringAttr(node.attrs?.src);
      if (!src) return null;
      const alt = stringAttr(node.attrs?.alt) ?? "";
      const title = stringAttr(node.attrs?.title);
      return (
        // Plain `<img>` on purpose — proof images have unknown natural
        // dimensions, but `next/image` requires explicit width/height or a
        // sized parent, which a Tiptap document can't guarantee. The lazy +
        // no-referrer hints cover the load-discipline next/image would add.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={key}
          src={src}
          alt={alt}
          title={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="my-3 max-w-full h-auto rounded-sm border border-neutral-800"
        />
      );
    }
    default:
      return null;
  }
}

export function renderProof(proof: Record<string, unknown>): ReactNode {
  const root = proof as TiptapNode;
  if (root.type === "doc" && Array.isArray(root.content)) {
    return root.content.map((node, i) => renderBlock(node, i));
  }
  return null;
}

/** True when the proof document carries at least one image node (anywhere in
 *  the tree). A geolocation's proof is a source-media ↔ satellite cross-
 *  reference, so it must show the imagery — text alone can't be audited. */
export function proofHasImage(proof: Record<string, unknown> | null): boolean {
  if (!proof) return false;
  const hasImage = (node: TiptapNode): boolean =>
    node.type === "image" || (node.content?.some(hasImage) ?? false);
  return hasImage(proof as TiptapNode);
}
