import { getSchema, type Extensions } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import StarterKit from "@tiptap/starter-kit";

/**
 * The rich-text content contract: the one definition of what a proof or a collection description
 * may hold. The editor (`ProofEditor`), the renderer (`lib/proof.tsx`) and Markdown paste all run
 * these extensions, and `richTextContract()` projects their schema to
 * `backend/app/services/rich_text_contract.json`, the allowlist the server sanitizer loads. The
 * test beside this file fails when the two drift; `npx vitest run -u src/lib/richText.test.ts`
 * rewrites the JSON.
 */

/** Mirrors backend `event.SOURCE_URL_MAX_LENGTH`, the cap `safe_link_href` applies; change both. */
const LINK_HREF_MAX_BYTES = 2000;

/** Mirrors `storage.LOCAL_STORAGE_URL_PREFIX` (dev backend media mount): the one non-https
 * origin a proof image may carry, only in a build that pins no media host. */
const LOCAL_STORAGE_URL_PREFIX = "http://localhost:8000/local-storage/";

/** Mirrors backend `sanitize.safe_link_href`; change both. Only an explicit http(s) URL with a
 * hostname is a link (rejects `javascript:`, `data:`, `mailto:`, relative). The renderer applies
 * it again at paint (a row stored before a rule tightened is still readable), and the editor
 * mints links against it. */
export function isSafeLinkHref(href: string): boolean {
  if (new TextEncoder().encode(href).length > LINK_HREF_MAX_BYTES) return false;
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
export function isSafeImageSrc(src: string): boolean {
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

export const HEADING_LEVELS = [2, 3] as const;

// StarterKit v3 registers Link with linkify's wider protocol set (mailto, tel, ...), and
// `protocols` can only widen, so the http(s) narrowing goes through `isAllowedUri`, which paste,
// autolink, `setLink` and render consult. `openOnClick: false` so a click in the editor places
// the caret on a link to edit it instead of leaving the page.
//
// The classes style the editor surface and the read view alike, since both render through each
// extension's `renderHTML`.
export const RICH_TEXT_EXTENSIONS: Extensions = [
  StarterKit.configure({
    heading: {
      levels: [...HEADING_LEVELS],
      HTMLAttributes: { class: "font-semibold mt-3 mb-2 [&:is(h2)]:text-xl [&:is(h3)]:text-lg" },
    },
    bulletList: { HTMLAttributes: { class: "list-disc pl-6 my-2 space-y-1" } },
    orderedList: { HTMLAttributes: { class: "list-decimal pl-6 my-2 space-y-1" } },
    blockquote: { HTMLAttributes: { class: "border-l-2 border-neutral-700 pl-4 my-3 text-neutral-400" } },
    codeBlock: {
      HTMLAttributes: {
        class: "bg-neutral-950 border border-neutral-800 rounded-sm p-3 my-3 overflow-x-auto text-xs",
      },
    },
    code: { HTMLAttributes: { class: "px-1 py-0.5 rounded-sm bg-neutral-950 text-orange-300 text-xs" } },
    horizontalRule: { HTMLAttributes: { class: "my-4 border-neutral-800" } },
    link: {
      isAllowedUri: (url) => isSafeLinkHref(url),
      openOnClick: false,
      autolink: true,
    },
  }),
  Image,
];

/** Attributes the stored document keeps, per node or mark type; the server drops every other
 * schema attribute (link `target` and `rel`, image `width`, list `type`, ...). */
const KEPT_ATTRS: Readonly<Record<string, readonly string[]>> = {
  codeBlock: ["language"],
  heading: ["level"],
  image: ["alt", "src", "title"],
  link: ["href"],
  orderedList: ["start"],
};

interface RichTextContract {
  headingLevels: number[];
  marks: Record<string, string[]>;
  nodes: Record<string, string[]>;
}

export function richTextContract(): RichTextContract {
  const schema = getSchema(RICH_TEXT_EXTENSIONS);
  const table = (types: Record<string, { spec: { attrs?: object | null } }>) =>
    Object.fromEntries(
      Object.entries(types)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, type]) => {
          const kept = KEPT_ATTRS[name] ?? [];
          for (const attr of kept) {
            if (!(attr in (type.spec.attrs ?? {}))) {
              throw new Error(`The editor schema gives ${name} no "${attr}" attribute`);
            }
          }
          return [name, [...kept]];
        }),
    );
  return {
    headingLevels: [...HEADING_LEVELS],
    marks: table(schema.marks),
    nodes: table(schema.nodes),
  };
}
