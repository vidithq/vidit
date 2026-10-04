"use client";

import { useCallback, useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";

import { TAP_STEP } from "@/components/ui/Button";
import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";
import { cn } from "@/lib/cn";
import { ACCEPTED_IMAGE_MIME } from "@/lib/mediaTypes";
import { PROOF_PLACEHOLDER_PREFIX, safeProofFilename } from "@/lib/proofImages";

/** A link the proof pipeline carries end to end: an absolute http(s) URL. Exported for its test. */
export const isProofLinkUri = (url: string): boolean => /^https?:\/\//i.test(url);

// Links are http(s) only, like both sanitisers downstream (`services/sanitize.py::safe_link_href`,
// `lib/proof.tsx::isSafeLinkHref`). StarterKit v3 registers Link with linkify's wider protocol set
// (mailto, tel, ...) and autolink on, so an autolinked `mailto:` would look like a link and be
// stripped at publish. `protocols` can only widen, so the narrowing goes through `isAllowedUri`,
// which paste, autolink and render consult. A typed `https://...` still links; a bare
// `example.com` or email address doesn't. Change only together with those two mirrors.
//
// Underline is off: StarterKit v3 registers it (Cmd/Ctrl+U), but the backend sanitizer drops the
// mark (`services/sanitize.py`, `_ALLOWED_MARKS` = bold / italic / strike / code / link) and the
// renderer can't paint it (`lib/proof.tsx`, `applyMarks`), so an underlined run would silently
// lose its formatting at publish. Change only together with those two mirrors.
const PROOF_STARTER_KIT = StarterKit.configure({
  underline: false,
  link: { isAllowedUri: isProofLinkUri },
});

interface ProofEditorProps {
  onChange: (json: Record<string, unknown>) => void;
  /** The proof body's inline images, kept locally while typing and uploaded at publish (as
   * `proof_files[]`). Fires on every add or removal so the parent stages exactly the files the doc
   * still references. */
  onProofFilesChange?: (files: File[]) => void;
  // Optional initial Tiptap doc (a draft). Read once at construction: pair with a `key` on the parent to re-seed.
  initialContent?: Record<string, unknown> | null;
  /** Whether the body may carry images. False drops the "+ Image" control for a surface with no
   * upload path (a collection's description is stored with `sanitize_tiptap_doc(allow_images=False)`). */
  allowImages?: boolean;
  /** Red invalid outline on the editor's box (FORM_INVALID_FIELD) for a caller whose submit refuses the body. */
  invalid?: boolean;
}

// `previewUrl` is the `blob:` URL of a picked "+ Image" file; `emit`'s src
// rewrite matches on the string alone.
type ImageEntry = { previewUrl: string; placeholder: string; file: File };

type ImageNode = { attrs: Record<string, unknown>; content?: unknown[] };

/** Depth-first walk calling `visit` on every Tiptap image node. Shared by `resolveProofDoc` and
 * `emit`, the only places that inspect image srcs. */
function walkImageNodes(node: unknown, visit: (n: ImageNode) => void): void {
  if (typeof node !== "object" || node === null) return;
  const n = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
  if (n.type === "image" && n.attrs && typeof n.attrs.src === "string") {
    visit(n as ImageNode);
  }
  if (Array.isArray(n.content)) n.content.forEach((c) => walkImageNodes(c, visit));
}

/** The core of `emit`, pure so the `previewUrl` to file matching (and its identical-content
 * collision fix) is testable without a Tiptap editor. Rewrites live-preview srcs in a copy of
 * `json` back to `placeholder://` and returns the files the doc still references (a deleted image
 * drops its file). */
export function resolveProofDoc(
  json: Record<string, unknown>,
  entries: ImageEntry[]
): { doc: Record<string, unknown>; files: File[] } {
  const byPreviewUrl = new Map(entries.map((e) => [e.previewUrl, e]));
  const referenced = new Set<string>();

  // Deep-clone first: mutating Tiptap's own JSON corrupts its document state.
  const doc = structuredClone(json);
  walkImageNodes(doc, (n) => {
    const src = n.attrs.src as string;
    const entry = byPreviewUrl.get(src);
    if (entry) {
      n.attrs.src = entry.placeholder;
      referenced.add(entry.placeholder);
    } else if (src.startsWith(PROOF_PLACEHOLDER_PREFIX)) {
      referenced.add(src);
    }
  });

  const files = entries.filter((e) => referenced.has(e.placeholder)).map((e) => e.file);
  return { doc, files };
}

/**
 * The Tiptap proof editor with proof-at-publish image handling. "+ Image" holds a picked file
 * locally: it inserts an image node with a blob-URL src for preview and remembers the file under a
 * `placeholder://<filename>` key. Emitted JSON rewrites those srcs back to `placeholder://`, so the
 * stored document never carries a blob URL. Nothing touches S3 until the parent submits: it reads
 * the still-referenced files via `onProofFilesChange` and posts them as `proof_files[]`, where the
 * server matches each file to its placeholder by filename (see `docs/data-model.md`, media,
 * "Upload timing").
 *
 * `allowImages={false}` removes that control for a body stored under the same allowlist minus
 * images (a collection's description): one editor, so marks, lists and link rules stay the same.
 */
// One shape for every toolbar control plus the two state paints, with the phone tap step
// `<Button>` takes (the resting control is about 24px tall).
const TOOL = `inline-flex items-center px-2 py-1 rounded text-xs ${TAP_STEP}`;
const TOOL_ON = "bg-neutral-600 text-white";
const TOOL_OFF = "text-neutral-400 hover:bg-neutral-700";

export default function ProofEditor({
  onChange,
  onProofFilesChange,
  initialContent,
  allowImages = true,
  invalid = false,
}: ProofEditorProps) {
  // Files staged locally, keyed by blob URL. A ref so the `onUpdate` closure sees the live map without re-creating the editor.
  const entriesRef = useRef<ImageEntry[]>([]);
  // Filenames claimed this session, so two picks of `IMG.jpg` don't share a placeholder (the server
  // rejects a duplicate proof filename).
  const usedNamesRef = useRef<Set<string>>(new Set());

  // Rewrite blob srcs to `placeholder://` in a copy of the emitted doc and report the copy plus its
  // files (matching lives in `resolveProofDoc`). A ref keeps `onUpdate` stable.
  const emit = useCallback(
    (json: Record<string, unknown>) => {
      const { doc, files } = resolveProofDoc(json, entriesRef.current);
      onChange(doc);
      onProofFilesChange?.(files);
    },
    [onChange, onProofFilesChange],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [PROOF_STARTER_KIT, Image],
    content: initialContent ?? undefined,
    editorProps: {
      attributes: {
        class:
          "prose prose-invert prose-sm max-w-none min-h-[200px] px-3 py-2 focus:outline-hidden",
      },
    },
    onUpdate({ editor }) {
      emit(editor.getJSON());
    },
  });

  // Revoke staged blob URLs on unmount so compose then navigate doesn't leak object URLs.
  useEffect(() => {
    const entries = entriesRef.current;
    return () => {
      for (const e of entries) URL.revokeObjectURL(e.previewUrl);
    };
  }, []);

  const pickImage = (file: File) => {
    if (!editor) return;
    const name = safeProofFilename(file.name, usedNamesRef.current);
    if (name === null) return; // unusable filename, skip rather than stage junk
    usedNamesRef.current.add(name);
    // Upload under exactly `name` so the server's `safe_original_filename` reproduces the placeholder
    // suffix; rebuild the File when the name differs (a File can't be renamed).
    const staged =
      file.name === name ? file : new File([file], name, { type: file.type });
    const blobUrl = URL.createObjectURL(staged);
    entriesRef.current.push({
      previewUrl: blobUrl,
      placeholder: `${PROOF_PLACEHOLDER_PREFIX}${name}`,
      file: staged,
    });
    // The blob URL is the live-preview src; `emit` swaps it for the placeholder in everything leaving here.
    editor.chain().focus().setImage({ src: blobUrl }).run();
  };

  if (!editor) return null;

  return (
    // The field box every other input wears: same border and fill, the accent focus border `<Input>`
    // takes (via `focus-within`: focus lands on the inner ProseMirror surface), and
    // `FORM_INVALID_FIELD` when flagged.
    <div
      className={cn(
        "border border-neutral-700 rounded-sm bg-neutral-800 focus-within:border-orange-500",
        invalid && FORM_INVALID_FIELD,
      )}
    >
      <div className="flex items-center gap-1 px-2 py-1 border-b border-neutral-700 flex-wrap">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`${TOOL} font-bold ${
            editor.isActive("bold") ? TOOL_ON : TOOL_OFF
          }`}
        >
          B
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`${TOOL} italic ${
            editor.isActive("italic") ? TOOL_ON : TOOL_OFF
          }`}
        >
          I
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={`${TOOL} ${
            editor.isActive("heading", { level: 3 }) ? TOOL_ON : TOOL_OFF
          }`}
        >
          H3
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`${TOOL} ${
            editor.isActive("bulletList") ? TOOL_ON : TOOL_OFF
          }`}
        >
          List
        </button>
        {allowImages && (
          <>
            <div className="w-px h-4 bg-neutral-700 mx-1" />
            {/* Holds the picked file locally (blob preview plus retained File); upload happens at publish. */}
            <label
              className={`${TOOL} ${TOOL_OFF} cursor-pointer`}
              title="Add a proof image (uploaded when you publish)"
            >
              + Image
              <input
                type="file"
                accept={ACCEPTED_IMAGE_MIME}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Reset so re-picking the same file still fires onChange.
                  e.target.value = "";
                  if (file) pickImage(file);
                }}
              />
            </label>
          </>
        )}
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}
