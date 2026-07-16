"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";

import { ACCEPTED_IMAGE_MIME } from "@/lib/mediaTypes";
import { PROOF_PLACEHOLDER_PREFIX, safeProofFilename } from "@/lib/proofImages";

interface ProofEditorProps {
  onChange: (json: Record<string, unknown>) => void;
  /** The proof body's inline images, kept locally while typing and uploaded
   *  only at publish (as `proof_files[]`). Fires on every add / removal so the
   *  parent stages exactly the files the doc still references. */
  onProofFilesChange?: (files: File[]) => void;
  // Optional initial Tiptap doc (the tweet-import flow seeds a source line).
  // Tiptap reads it once at construction — pair with a ``key`` on the parent to
  // re-seed after mount.
  initialContent?: Record<string, unknown> | null;
  /** Files already matched, by name, to the ``placeholder://<filename>`` image
   *  nodes in `initialContent` (the tweet-import flow downloads them before
   *  this component mounts, since the download is async and Tiptap reads
   *  `initialContent` synchronously at construction). Hydrated into the same
   *  local staging the "+ Image" control uses: a live preview plus a
   *  `proof_files[]` entry, so publish uploads them exactly once. */
  initialProofFiles?: File[];
  // Drops the Image extension + upload button. A request's proof maps to
  // the same `events.proof` column, in progress (else it'd be a
  // geolocation), so it stays text + formatting only there.
  allowImages?: boolean;
}

// `previewUrl` is a `blob:` URL for a manually picked "+ Image" file, or a
// `data:` URL for an import-hydrated one (see `fileToDataUrl` below);
// `emit`'s src rewrite just matches the string, so it doesn't care which.
type ImageEntry = { previewUrl: string; placeholder: string; file: File };

type ImageNode = { attrs: Record<string, unknown>; content?: unknown[] };

/**
 * Depth-first walk calling `visit` on every Tiptap image node (a node with
 * `type: "image"` and a string `attrs.src`). Shared by `matchInitialProofFiles`
 * and `emit` below, the doc's only two places that inspect image srcs, so the
 * tree-walking itself has one home.
 */
function walkImageNodes(node: unknown, visit: (n: ImageNode) => void): void {
  if (typeof node !== "object" || node === null) return;
  const n = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
  if (n.type === "image" && n.attrs && typeof n.attrs.src === "string") {
    visit(n as ImageNode);
  }
  if (Array.isArray(n.content)) n.content.forEach((c) => walkImageNodes(c, visit));
}

type MatchedProofFile = { placeholder: string; file: File };

/**
 * Pure name-match between the `placeholder://<filename>` image nodes in `doc`
 * and `files`: no browser resource created here, so it's safe to run at
 * construction (see `matchedProofFiles` below). Exported for the collision
 * regression test (see `ProofEditor.test.tsx`).
 */
export function matchInitialProofFiles(
  doc: Record<string, unknown> | null | undefined,
  files: File[]
): MatchedProofFile[] {
  if (!doc || files.length === 0) return [];
  const byName = new Map(files.map((f) => [f.name, f]));
  const matched: MatchedProofFile[] = [];
  walkImageNodes(doc, (n) => {
    const src = n.attrs.src as string;
    if (!src.startsWith(PROOF_PLACEHOLDER_PREFIX)) return;
    const file = byName.get(src.slice(PROOF_PLACEHOLDER_PREFIX.length));
    if (file) matched.push({ placeholder: src, file });
  });
  return matched;
}

/** Read `file` as a `data:` URL. Used (instead of `URL.createObjectURL`) for
 *  the import-hydration preview below, which needs no matching "revoke": a
 *  data URL is just a string, not an entry in the browser's Blob URL
 *  registry, so nothing about it can go stale or needs disposing. Exported
 *  for the collision regression test. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * A `data:` preview URL is derived purely from the file's bytes, so two
 * imported files with identical content (different filenames, different
 * placeholders) resolve to the exact same string. Appending the placeholder
 * as a URL fragment makes each entry's preview URL unique; the browser
 * ignores the fragment when decoding the payload, so rendering is
 * unaffected. Exported for the collision regression test.
 */
export function uniqueDataUrl(dataUrl: string, placeholder: string): string {
  return `${dataUrl}#${encodeURIComponent(placeholder)}`;
}

/**
 * The core of `emit` below, pulled out as a pure function so the
 * `previewUrl` → file matching (and its identical-content collision fix)
 * is directly testable without booting a real Tiptap editor. Rewrites
 * live-preview srcs in a copy of `json` back to their `placeholder://`
 * form, and returns the files the rewritten doc still references (a
 * deleted image node drops its file from the upload batch).
 */
export function resolveProofDoc(
  json: Record<string, unknown>,
  entries: ImageEntry[]
): { doc: Record<string, unknown>; files: File[] } {
  const byPreviewUrl = new Map(entries.map((e) => [e.previewUrl, e]));
  const referenced = new Set<string>();

  // Deep-clone first: mutating Tiptap's own JSON in place corrupts its
  // document state. `structuredClone` is available in every runtime this
  // ships to (modern browsers + the test env).
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
 * The Tiptap proof editor with proof-at-publish image handling. "+ Image" holds
 * a picked file locally: it inserts an image node with a blob-URL src for a live
 * preview, and remembers the file under a `placeholder://<filename>` key. The
 * tweet-import flow stages files the same way, through `initialProofFiles`: this
 * component resolves those to a preview once mounted (see the effect below).
 * On every edit the emitted JSON rewrites live-preview srcs back to their
 * `placeholder://` form, so the document handed up (and eventually stored) never
 * carries one. Nothing touches S3 until the parent submits: it reads the
 * still-referenced files via `onProofFilesChange` and posts them as
 * `proof_files[]` on create / geolocate, where the server matches each file to
 * its placeholder by filename and rewrites the src to the stored URL (see
 * `docs/data-model.md` → media → "Upload timing").
 */
export default function ProofEditor({
  onChange,
  onProofFilesChange,
  initialContent,
  initialProofFiles,
  allowImages = true,
}: ProofEditorProps) {
  // Computed once at construction (the lazy `useState` initializer): pure
  // name-matching, no blob URLs yet, so nothing here needs cleanup and a
  // Strict-Mode double-render can't leak anything.
  const [matchedProofFiles] = useState(() =>
    matchInitialProofFiles(initialContent, initialProofFiles ?? []),
  );

  // Files staged locally, keyed by blob URL. A ref (not state) so the Tiptap
  // `onUpdate` closure always sees the live map without re-creating the editor.
  const entriesRef = useRef<ImageEntry[]>([]);
  // Filenames already claimed this session, so two picks of `IMG.jpg` don't
  // collide on one placeholder (the server rejects a duplicate proof filename).
  // Pre-seeded with the matched import names for the same reason.
  const usedNamesRef = useRef<Set<string>>(
    new Set(
      matchedProofFiles.map((m) => m.placeholder.slice(PROOF_PLACEHOLDER_PREFIX.length)),
    ),
  );

  // Rewrite blob srcs → their `placeholder://` form in a copy of the emitted
  // doc, then report the copy plus the files it still references. Kept in a ref
  // so the editor's `onUpdate` callback stays stable. The actual matching
  // lives in `resolveProofDoc` (pulled out for testability).
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
    extensions: allowImages ? [StarterKit, Image] : [StarterKit],
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

  // Resolve the import-matched placeholders into live previews once the
  // editor exists (Tiptap's initial `content` still carries the raw
  // `placeholder://` src, which the browser can't render on its own). Reads
  // each file as a `data:` URL rather than `URL.createObjectURL`: React's
  // dev-mode Strict Mode mounts, cleans up, and re-mounts every effect once
  // right after the initial commit, and a `blob:` URL revoked by that
  // practice cleanup would leave the already-painted `<img>` pointing at a
  // dead reference with nothing to recreate it (the doc's placeholder src
  // is gone the moment the first pass rewrites it, so a second pass has
  // nothing left to match). A `data:` URL sidesteps this: it isn't tracked
  // in a revocable registry, so the standard "ignore a stale async result"
  // guard (`cancelled`) is all the safety this needs, same as any other
  // async effect.
  useEffect(() => {
    if (!editor || matchedProofFiles.length === 0) return;
    let cancelled = false;

    (async () => {
      const resolved = await Promise.all(
        matchedProofFiles.map(async ({ placeholder, file }) => {
          const dataUrl = await fileToDataUrl(file);
          return {
            placeholder,
            file,
            // See `uniqueDataUrl`: two imported files with identical bytes
            // would otherwise resolve to the exact same `data:` string,
            // and `resolveProofDoc`'s `previewUrl`-keyed lookup would
            // collapse the pair onto one file and silently drop the other
            // from `proof_files[]`.
            previewUrl: uniqueDataUrl(dataUrl, placeholder),
          };
        }),
      );
      if (cancelled) return;

      entriesRef.current.push(...resolved);

      // Rewrite each placeholder image node's src to its resolved preview via
      // a transaction dispatched straight on the view: this also fires
      // Tiptap's `onUpdate` (see the `onUpdate` callback above), so `emit`
      // immediately reports these files up through the normal
      // `onProofFilesChange` path, the same one a manually picked "+ Image"
      // file goes through.
      const byPlaceholder = new Map(resolved.map((e) => [e.placeholder, e.previewUrl]));
      const { tr } = editor.state;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "image" && typeof node.attrs.src === "string") {
          const previewUrl = byPlaceholder.get(node.attrs.src);
          if (previewUrl) tr.setNodeAttribute(pos, "src", previewUrl);
        }
      });
      if (tr.docChanged) editor.view.dispatch(tr);
    })();

    return () => {
      cancelled = true;
    };
    // `matchedProofFiles` is stable for the life of this instance (a new
    // import remounts the editor via its `key`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Revoke every "+ Image"-staged blob URL on unmount so a compose → navigate
  // cycle doesn't leak object URLs. Import-hydrated entries use `data:` URLs
  // (see above), for which `revokeObjectURL` is a harmless no-op, so this
  // stays scoped to whatever ends up in `entriesRef.current` without needing
  // to distinguish the two sources.
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
    // Upload the file under exactly `name` so the server's
    // `safe_original_filename` reproduces the placeholder suffix. When the
    // sanitised / disambiguated name differs from the original, rebuild the
    // File so its `.name` matches (a bare rename can't be done on a File).
    const staged =
      file.name === name ? file : new File([file], name, { type: file.type });
    const blobUrl = URL.createObjectURL(staged);
    entriesRef.current.push({
      previewUrl: blobUrl,
      placeholder: `${PROOF_PLACEHOLDER_PREFIX}${name}`,
      file: staged,
    });
    // The blob URL is the *live preview* src; `emit` swaps it for the
    // placeholder in everything that leaves this component.
    editor.chain().focus().setImage({ src: blobUrl }).run();
  };

  if (!editor) return null;

  return (
    <div className="border border-neutral-700 rounded-sm bg-neutral-800">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-neutral-700 flex-wrap">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`px-2 py-1 rounded text-xs font-bold ${
            editor.isActive("bold") ? "bg-neutral-600 text-white" : "text-neutral-400 hover:bg-neutral-700"
          }`}
        >
          B
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`px-2 py-1 rounded text-xs italic ${
            editor.isActive("italic") ? "bg-neutral-600 text-white" : "text-neutral-400 hover:bg-neutral-700"
          }`}
        >
          I
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={`px-2 py-1 rounded text-xs ${
            editor.isActive("heading", { level: 3 }) ? "bg-neutral-600 text-white" : "text-neutral-400 hover:bg-neutral-700"
          }`}
        >
          H3
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`px-2 py-1 rounded text-xs ${
            editor.isActive("bulletList") ? "bg-neutral-600 text-white" : "text-neutral-400 hover:bg-neutral-700"
          }`}
        >
          List
        </button>
        {allowImages && (
          <>
            <div className="w-px h-4 bg-neutral-700 mx-1" />
            {/* Holds the picked file locally (blob preview + retained File);
                the upload happens at publish via proof_files[]. */}
            <label
              className="px-2 py-1 rounded-sm text-xs text-neutral-400 hover:bg-neutral-700 cursor-pointer"
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
