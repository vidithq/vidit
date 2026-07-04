"use client";

import { useCallback, useEffect, useRef } from "react";
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
  // Drops the Image extension + upload button. A request's proof maps to
  // the same `events.proof` column, in progress (else it'd be a
  // geolocation), so it stays text + formatting only there.
  allowImages?: boolean;
}

type ImageEntry = { blobUrl: string; placeholder: string; file: File };

/**
 * The Tiptap proof editor with proof-at-publish image handling. "+ Image" holds
 * a picked file locally: it inserts an image node with a blob-URL src for a live
 * preview, and remembers the file under a `placeholder://<filename>` key. On
 * every edit the emitted JSON rewrites those blob srcs back to their
 * `placeholder://` form, so the document handed up (and eventually stored) never
 * carries a blob URL. Nothing touches S3 until the parent submits: it reads the
 * still-referenced files via `onProofFilesChange` and posts them as
 * `proof_files[]` on create / geolocate, where the server matches each file to
 * its placeholder by filename and rewrites the src to the stored URL (see
 * `docs/data-model.md` → media → "Upload timing").
 */
export default function ProofEditor({
  onChange,
  onProofFilesChange,
  initialContent,
  allowImages = true,
}: ProofEditorProps) {
  // Files staged locally, keyed by blob URL. A ref (not state) so the Tiptap
  // `onUpdate` closure always sees the live map without re-creating the editor.
  const entriesRef = useRef<ImageEntry[]>([]);
  // Filenames already claimed this session, so two picks of `IMG.jpg` don't
  // collide on one placeholder (the server rejects a duplicate proof filename).
  const usedNamesRef = useRef<Set<string>>(new Set());

  // Rewrite blob srcs → their `placeholder://` form in a copy of the emitted
  // doc, then report the copy plus the files it still references. Kept in a ref
  // so the editor's `onUpdate` callback stays stable.
  const emit = useCallback(
    (json: Record<string, unknown>) => {
      const byBlob = new Map(entriesRef.current.map((e) => [e.blobUrl, e]));
      const referenced = new Set<string>();

      const walk = (node: unknown): void => {
        if (typeof node !== "object" || node === null) return;
        const n = node as {
          type?: string;
          attrs?: Record<string, unknown>;
          content?: unknown[];
        };
        if (n.type === "image" && n.attrs && typeof n.attrs.src === "string") {
          const entry = byBlob.get(n.attrs.src);
          if (entry) {
            n.attrs.src = entry.placeholder;
            referenced.add(entry.placeholder);
          } else if (n.attrs.src.startsWith(PROOF_PLACEHOLDER_PREFIX)) {
            referenced.add(n.attrs.src);
          }
        }
        if (Array.isArray(n.content)) n.content.forEach(walk);
      };

      // Deep-clone first: mutating Tiptap's own JSON in place corrupts its
      // document state. `structuredClone` is available in every runtime this
      // ships to (modern browsers + the test env).
      const doc = structuredClone(json);
      walk(doc);
      onChange(doc);

      // Surface only the files the doc still references (a deleted image node
      // drops its file from the upload batch, so it never reaches S3).
      onProofFilesChange?.(
        entriesRef.current
          .filter((e) => referenced.has(e.placeholder))
          .map((e) => e.file),
      );
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

  // Revoke every staged blob URL on unmount so a compose → navigate cycle
  // doesn't leak object URLs. `entriesRef.current` is a stable array (only ever
  // pushed to, never reassigned), so capturing it here still sees every image
  // added later, and satisfies the ref-in-cleanup lint rule.
  useEffect(() => {
    const entries = entriesRef.current;
    return () => {
      for (const e of entries) URL.revokeObjectURL(e.blobUrl);
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
      blobUrl,
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
