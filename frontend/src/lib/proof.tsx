import { createElement, type ReactNode } from "react";
import parse, {
  domToReact,
  htmlToDOM,
  type DOMNode,
  type Element,
  type HTMLReactParserOptions,
  type Text,
} from "html-react-parser";

import { ProofImage } from "@/components/event/ProofImage";
import { parseHttp } from "@/lib/format";
import { OutboundLink } from "@/components/ui/OutboundLink";
import { TEXT_LINK } from "@/components/ui/styles";

/** Mirrors `storage.LOCAL_STORAGE_URL_PREFIX`; change both. */
const LOCAL_STORAGE_URL_PREFIX = "http://localhost:8000/local-storage/";

/** Mirrors backend `sanitize.safe_link_href`; change both. */
export function isSafeLinkHref(href: string): boolean {
  return parseHttp(href) !== null;
}

/** Mirrors backend `sanitize._safe_image_src`; change both. Normalises like a browser (WHATWG)
 * first, so `/\host` and `/<TAB>/host` reduce to the protocol-relative `//host`. */
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

/** The read view's class per allowlisted tag (`a` and `img` render as components). Mirrors the
 *  backend `sanitize.py` tag allowlist; change both. Any other tag renders its children only. */
const TAG_CLASSES: Record<string, string | undefined> = {
  p: undefined,
  h2: "text-xl font-bold mt-4 mb-2",
  h3: "text-lg font-semibold mt-3 mb-2",
  strong: undefined,
  em: undefined,
  s: undefined,
  code: "px-1 py-0.5 rounded-sm bg-neutral-800 text-orange-300 text-xs",
  pre: "bg-neutral-950 border border-neutral-800 rounded-sm p-3 my-3 overflow-x-auto text-xs",
  ul: "list-disc pl-6 my-2 space-y-1",
  ol: "list-decimal pl-6 my-2 space-y-1",
  li: undefined,
  blockquote: "border-l-2 border-neutral-700 pl-4 my-3 text-neutral-400",
  hr: "my-4 border-neutral-800",
  br: undefined,
};

const VOID_TAGS = new Set(["hr", "br"]);

/** Options passed down, never inspected per node. `gateImages` carries `is_graphic` to the
 *  leaf that paints pixels, so proof imagery gets the same age confirmation as source media. */
interface ProofRenderOptions {
  gateImages?: boolean;
}

// Type tags, not class checks: the parser's ESM and CJS builds load separate copies of the node
// classes. A script or style node is typed apart from "tag", so it drops with its text.
const isElement = (node: unknown): node is Element =>
  (node as { type?: string } | null)?.type === "tag";
const isText = (node: DOMNode): node is Text => node.type === "text";

function containsImage(node: Element): boolean {
  return node.children.some(
    (c) => isElement(c) && (c.name === "img" || containsImage(c)),
  );
}

function parserOptions({ gateImages }: ProofRenderOptions): HTMLReactParserOptions {
  const options: HTMLReactParserOptions = {
    replace(node) {
      if (isText(node)) return undefined;
      if (!isElement(node)) return <></>;
      const children = () => domToReact(node.children as DOMNode[], options);
      const { name, attribs } = node;

      if (name === "img") {
        const src = attribs.src;
        if (!src || !isSafeImageSrc(src)) return <></>;
        // The one interactive leaf: a click opens the shared MediaLightbox (evidence is only
        // auditable at full size). See ProofImage.
        return <ProofImage src={src} alt={attribs.alt ?? ""} isGraphic={gateImages} />;
      }
      if (name === "a") {
        const href = attribs.href;
        if (!href || !isSafeLinkHref(href)) return <>{children()}</>;
        return (
          <OutboundLink href={href} ugc className={TEXT_LINK}>
            {children()}
          </OutboundLink>
        );
      }
      if (!Object.hasOwn(TAG_CLASSES, name)) return <>{children()}</>;

      const inPre =
        name === "code" && isElement(node.parent) && node.parent.name === "pre";
      // ProofImage paints block-level markup, which a <p> cannot hold.
      const tag = name === "p" && containsImage(node) ? "div" : name;
      return createElement(
        tag,
        { className: inPre ? undefined : TAG_CLASSES[name] },
        VOID_TAGS.has(name) ? undefined : children(),
      );
    },
  };
  return options;
}

/** A stored proof or collection description (server-sanitized HTML) as React: allowlisted tags
 *  only, every attribute dropped but a safe link href and a safe image src. */
export function renderProof(
  html: string | null,
  options: ProofRenderOptions = {},
): ReactNode {
  if (!html) return null;
  return parse(html, parserOptions(options));
}

const LINE_TAGS = new Set(["p", "h2", "h3", "li", "blockquote", "pre", "hr", "ul", "ol"]);

/** Mirrors backend `sanitize.html_text`; change both. The description counter measures this
 *  string against the server's cap, so a divergence lets a body through that the server 422s. */
export function htmlText(html: string | null): string {
  if (!html) return "";
  const lines: string[] = [];
  let current = "";
  const flush = (): void => {
    const line = current.trim();
    current = "";
    if (line) lines.push(line);
  };
  const walk = (nodes: DOMNode[]): void => {
    for (const node of nodes) {
      if (isText(node)) {
        node.data
          .split("\n")
          .forEach((part, i) => {
            if (i > 0) flush();
            current += part;
          });
      } else if (isElement(node)) {
        if (node.name === "br") {
          flush();
          continue;
        }
        const block = LINE_TAGS.has(node.name);
        if (block) flush();
        walk(node.children as DOMNode[]);
        if (block) flush();
      }
    }
  };
  walk(htmlToDOM(html));
  flush();
  return lines.join("\n");
}

/** Every image `src` the body carries, in document order. Mirrors
 *  `sanitize.extract_image_srcs`: a `src` string is what counts, and a `placeholder://` src
 *  counts on both sides. */
export function proofImageSrcs(html: string | null): string[] {
  if (!html) return [];
  const srcs: string[] = [];
  const walk = (nodes: DOMNode[]): void => {
    for (const node of nodes) {
      if (!isElement(node)) continue;
      if (node.name === "img" && node.attribs.src !== undefined) srcs.push(node.attribs.src);
      walk(node.children as DOMNode[]);
    }
  };
  walk(htmlToDOM(html));
  return srcs;
}

/** The images of the form's body `html` that the stored body `stored` already holds, in order,
 *  once each: the stored proof images the form still shows. */
export function storedProofImages(html: string | null, stored: string | null): string[] {
  const kept = new Set(proofImageSrcs(stored));
  return [...new Set(proofImageSrcs(html))].filter((src) => kept.has(src));
}

/** True when the proof carries at least one image: a geolocation's proof is a source ↔
 *  satellite cross-reference, and text alone can't be audited. The server enforces it in
 *  `events._require_proof_image` over the same srcs. */
export function proofHasImage(html: string | null): boolean {
  return proofImageSrcs(html).length > 0;
}
