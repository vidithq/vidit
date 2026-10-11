import type { ReactNode } from "react";
import { renderToReactElement } from "@tiptap/static-renderer/pm/react";

import { ProofImage } from "@/components/event/ProofImage";
import { TEXT_LINK } from "@/components/ui/styles";
import { isSafeImageSrc, isSafeLinkHref, RICH_TEXT_EXTENSIONS } from "@/lib/richText";

type TiptapNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
};

/** Options passed down, never inspected per node. `gateImages` carries `is_graphic` to the
 *  leaf that paints pixels, so proof imagery gets the same age confirmation as source media. */
interface ProofRenderOptions {
  gateImages?: boolean;
}

/** A proof or collection description as React, through `@tiptap/static-renderer` and the
 * contract's extensions, so a format the editor writes is a format this paints. Two overrides
 * re-check what the server checked at write, since a row stored before a rule tightened is still
 * readable: a link renders only for an `isSafeLinkHref` href, always in a new tab with a fixed
 * `rel`, and an image only for an `isSafeImageSrc` src, as the enlargeable `ProofImage`. A type
 * outside the contract renders nothing, its text included. */
export function renderProof(
  proof: Record<string, unknown>,
  options: ProofRenderOptions = {},
): ReactNode {
  const root = proof as TiptapNode;
  if (root.type !== "doc" || !Array.isArray(root.content)) return null;
  try {
    return renderToReactElement({
      extensions: RICH_TEXT_EXTENSIONS,
      content: proof,
      options: {
        nodeMapping: {
          image: ({ node }) => {
            const { src, alt, title } = node.attrs;
            if (typeof src !== "string" || !isSafeImageSrc(src)) return null;
            return (
              <ProofImage
                src={src}
                alt={typeof alt === "string" ? alt : ""}
                title={typeof title === "string" ? title : undefined}
                isGraphic={options.gateImages}
              />
            );
          },
        },
        markMapping: {
          link: ({ mark, children }) => {
            const href = mark.attrs.href;
            if (typeof href !== "string" || !isSafeLinkHref(href)) return <>{children}</>;
            // `nofollow ugc`: the href is user-written, so it carries no endorsement for crawlers.
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer nofollow ugc"
                className={TEXT_LINK}
              >
                {children}
              </a>
            );
          },
        },
        unhandledNode: () => null,
        unhandledMark: ({ children }) => <>{children}</>,
      },
    });
  } catch {
    // ProseMirror refuses some stored shapes (an empty text node); the body still reads as text.
    return tiptapDocText(proof)
      .split("\n")
      .filter(Boolean)
      .map((line, i) => <p key={i}>{line}</p>);
  }
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
