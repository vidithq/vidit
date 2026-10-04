import type { ReactNode } from "react";
import { ProofImage } from "@/components/event/ProofImage";
import { TEXT_LINK } from "@/components/ui/styles";

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

/** Mirrors `storage.LOCAL_STORAGE_URL_PREFIX` (dev backend media mount): the one non-https
 * origin a proof image may carry, only in a build that pins no media host. */
const LOCAL_STORAGE_URL_PREFIX = "http://localhost:8000/local-storage/";

/** Mirrors backend `sanitize.safe_link_href`; change both. Defense in depth: only an explicit
 * http(s) URL with a hostname becomes an anchor href (rejects `javascript:`, `data:`,
 * `mailto:`, relative). The backend sanitizer is the source of truth. */
function isSafeLinkHref(href: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return false;
  }
  return (
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    parsed.hostname.length > 0
  );
}

/** Mirrors backend `sanitize._safe_image_src`; change both. A proof image is a relative path
 * or an https URL on this deployment's media host, so a persisted
 * `<image src="https://attacker/pixel.gif">` can't exfiltrate a viewer's IP/UA.
 * `NEXT_PUBLIC_MEDIA_HOST` is that host (inlined at build, the same pin `next.config.mjs`
 * gives `next/image`). With no media host set it keeps the dev shape: any https host plus
 * the local-storage prefix.
 *
 * Normalise like a browser (WHATWG) first: strip tab/CR/LF and treat `\` as `/`, so `/\host`,
 * `/<TAB>/host` and `//host` reduce to `//host`. */
function isSafeImageSrc(src: string): boolean {
  const normalized = src.replace(/[\t\r\n]/g, "").replace(/\\/g, "/");
  if (normalized.slice(0, 2) === "//") return false;
  if (src.startsWith("/")) return true;
  const mediaHost = process.env.NEXT_PUBLIC_MEDIA_HOST;
  if (!mediaHost && src.startsWith(LOCAL_STORAGE_URL_PREFIX)) return true;
  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return mediaHost ? parsed.hostname === mediaHost.toLowerCase() : true;
}

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
        if (!href || !isSafeLinkHref(href)) return acc;
        const target = stringAttr(mark.attrs?.target);
        return (
          <a
            href={href}
            target={target ?? "_blank"}
            rel="noopener noreferrer"
            className={TEXT_LINK}
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

/** Options passed down, never inspected per node. `gateImages` carries `is_graphic` to the
 *  leaf that paints pixels, so proof imagery gets the same age confirmation as source media. */
interface ProofRenderOptions {
  gateImages?: boolean;
}

function renderBlock(
  node: TiptapNode,
  key: number,
  options: ProofRenderOptions,
): ReactNode {
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
          {(node.content ?? []).map((c, i) => renderBlock(c, i, options))}
        </blockquote>
      );
    case "bulletList":
      return (
        <ul key={key} className="list-disc pl-6 my-2 space-y-1">
          {(node.content ?? []).map((c, i) => renderBlock(c, i, options))}
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
          {(node.content ?? []).map((c, i) => renderBlock(c, i, options))}
        </ol>
      );
    }
    case "listItem":
      return (
        <li key={key}>
          {(node.content ?? []).map((c, i) => renderBlock(c, i, options))}
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
      if (!src || !isSafeImageSrc(src)) return null;
      const alt = stringAttr(node.attrs?.alt) ?? "";
      const title = stringAttr(node.attrs?.title);
      // The one interactive leaf: a click opens the shared MediaLightbox (evidence is only
      // auditable at full size). See ProofImage.
      return (
        <ProofImage
          key={key}
          src={src}
          alt={alt}
          title={title}
          isGraphic={options.gateImages}
        />
      );
    }
    default:
      return null;
  }
}

export function renderProof(
  proof: Record<string, unknown>,
  options: ProofRenderOptions = {},
): ReactNode {
  const root = proof as TiptapNode;
  if (root.type === "doc" && Array.isArray(root.content)) {
    return root.content.map((node, i) => renderBlock(node, i, options));
  }
  return null;
}

/**
 * Plain-text projection of a Tiptap document. Mirrors backend `sanitize.tiptap_doc_text`
 * (fills `collections.description_text`, which the search index reads and
 * `services/collections` measures its 500-character cap on); change both.
 *
 * Concatenate the text of every text node, start a new line at every block boundary and
 * `hardBreak`, drop blank lines, strip each line, join with `\n`. The collection description
 * counter measures this string, so a divergence lets a body through that the server 422s, or
 * refuses one it would take.
 */
export function tiptapDocText(doc: Record<string, unknown> | null): string {
  if (!doc) return "";
  const lines: string[] = [];
  let current = "";

  const flush = (): void => {
    const line = current.trim();
    current = "";
    if (line) lines.push(line);
  };

  const walk = (node: TiptapNode): void => {
    if (node.type === "text") {
      if (typeof node.text === "string") current += node.text;
      return;
    }
    if (node.type === "hardBreak") {
      flush();
      return;
    }
    node.content?.forEach(walk);
    // Every block but the root ends its line; a container whose children already flushed adds nothing.
    if (node.type !== "doc") flush();
  };

  walk(doc as TiptapNode);
  flush();
  return lines.join("\n");
}

/** Every image `src` the proof carries, in document order. Mirrors
 *  `sanitize.extract_image_srcs`: a `src` string is what counts, not the node type, and a
 *  `placeholder://` src counts on both sides. */
function proofImageSrcs(proof: Record<string, unknown> | null): string[] {
  if (!proof) return [];
  const srcs: string[] = [];
  const walk = (node: TiptapNode): void => {
    if (node.type === "image" && typeof node.attrs?.src === "string") {
      srcs.push(node.attrs.src);
    }
    node.content?.forEach(walk);
  };
  walk(proof as TiptapNode);
  return srcs;
}

/** True when the proof carries at least one image: a geolocation's proof is a source ↔
 *  satellite cross-reference, and text alone can't be audited. The server enforces it in
 *  `events._require_proof_image` over the same srcs. */
export function proofHasImage(proof: Record<string, unknown> | null): boolean {
  return proofImageSrcs(proof).length > 0;
}
