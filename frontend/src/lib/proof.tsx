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
import { TEXT_LINK } from "@/components/ui/styles";

/** Mirrors `storage.LOCAL_STORAGE_URL_PREFIX` (dev backend media mount): the one non-https
 * origin a proof image may carry, only in a build that pins no media host. */
const LOCAL_STORAGE_URL_PREFIX = "http://localhost:8000/local-storage/";

/** Mirrors backend `sanitize.safe_link_href`; change both. Defense in depth: only an explicit
 * http(s) URL with a hostname becomes an anchor href (rejects `javascript:`, `data:`,
 * `mailto:`, relative). The backend sanitizer is the source of truth. */
export function isSafeLinkHref(href: string): boolean {
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
 * `<img src="https://attacker/pixel.gif">` can't exfiltrate a viewer's IP/UA.
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
// classes.
const isElement = (node: unknown): node is Element =>
  ["tag", "script", "style"].includes((node as { type?: string } | null)?.type ?? "");
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
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className={TEXT_LINK}
          >
            {children()}
          </a>
        );
      }
      if (!(name in TAG_CLASSES)) return <>{children()}</>;

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

/**
 * Plain-text projection of a proof or description body. Mirrors backend `sanitize.html_text`
 * (fills `collections.description_text`, which the search index reads and
 * `services/collections` measures its 500-character cap on); change both.
 *
 * Concatenate the text (entities decoded, U+FFFC dropped), start a new line at every block
 * boundary, `<br>` and newline in the text, strip each line, drop blank lines, join with `\n`. The collection description counter
 * measures this string, so a divergence lets a body through that the server 422s, or refuses
 * one it would take.
 */
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
          .replaceAll("￼", "")
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

/** True when the proof carries at least one image: a geolocation's proof is a source ↔
 *  satellite cross-reference, and text alone can't be audited. The server enforces it in
 *  `events._require_proof_image` over the same srcs. */
export function proofHasImage(html: string | null): boolean {
  return proofImageSrcs(html).length > 0;
}
