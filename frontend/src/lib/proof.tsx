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

/** The dev backend's static media mount, mirroring
 * `storage.LOCAL_STORAGE_URL_PREFIX`: the one non-https origin a proof image
 * may carry, and only in a build that pins no media host. */
const LOCAL_STORAGE_URL_PREFIX = "http://localhost:8000/local-storage/";

/** Mirrors backend `sanitize.safe_link_href`: only an explicit http(s)://
 * URL with a hostname is safe to render as an anchor href. The backend
 * sanitizer is the source of truth (it strips anything else before the
 * doc is ever persisted); this is defense-in-depth in case a doc reaches
 * the renderer unsanitized. Rejects `javascript:`, `data:`, `mailto:`, and
 * schemeless/relative hrefs (Tiptap links are always absolute). */
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

/** Mirrors backend `sanitize._safe_image_src`: a proof image is a relative
 * path or an https URL on the host this deployment serves media from, so a
 * persisted `<image src="https://attacker/pixel.gif">` can't exfiltrate a
 * viewer's IP / UA. `NEXT_PUBLIC_MEDIA_HOST` is that host (the same value
 * `next.config.mjs` pins `next/image` to; NEXT_PUBLIC_ vars are inlined at
 * build, so reading it here is the client's own copy of the pin). A build
 * that sets no media host keeps the dev shape instead of failing closed: any
 * https host plus the backend's local-storage prefix, which is what a
 * `STORAGE_BACKEND=local` backend mints and what the backend itself accepts
 * with no CDN configured.
 *
 * The backend sanitizer is the source of truth (it applies its own host pin
 * before the doc is persisted); this is defense in depth for a doc that
 * reaches the renderer unsanitized. Normalise the value the way a browser
 * will first (WHATWG): strip ASCII tab/CR/LF from anywhere and treat a
 * backslash as a slash, so `/\host`, `/<TAB>/host` and `//host` all reduce to
 * the network path `//host`. */
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
      if (!src || !isSafeImageSrc(src)) return null;
      const alt = stringAttr(node.attrs?.alt) ?? "";
      const title = stringAttr(node.attrs?.title);
      // The one interactive leaf of an otherwise static render: a click opens
      // the shared MediaLightbox, since a proof image is evidence and is only
      // auditable at full size. See ProofImage for why it is a client
      // component and why it stays a plain `<img>`.
      return <ProofImage key={key} src={src} alt={alt} title={title} />;
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
