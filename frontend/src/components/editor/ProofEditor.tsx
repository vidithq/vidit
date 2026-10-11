"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type ChainedCommands } from "@tiptap/react";

import { Button, TAP_STEP } from "@/components/ui/Button";
import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { ACCEPTED_IMAGE_MIME } from "@/lib/mediaTypes";
import { PROOF_PLACEHOLDER_PREFIX, safeProofFilename } from "@/lib/proofImages";
import { HEADING_LEVELS, isSafeLinkHref, RICH_TEXT_EXTENSIONS } from "@/lib/richText";

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

// One shape for every toolbar control plus the two state paints, with the phone tap step
// `<Button>` takes (the resting control is about 24px tall).
const TOOL = `inline-flex items-center px-2 py-1 rounded text-xs ${TAP_STEP}`;
const TOOL_ON = "bg-neutral-600 text-white";
const TOOL_OFF = "text-neutral-400 hover:bg-neutral-700";
const TOOL_DIVIDER = <div className="w-px h-4 bg-neutral-700 mx-1" />;

/** One toolbar toggle per format, in groups split by a divider. Underline (Ctrl/Cmd+U) and the
 * horizontal rule (`---`) are keyboard-only; every Markdown shortcut StarterKit knows (`## `,
 * `1. `, `> `, three backticks) also works while typing. */
type Format = {
  label: string;
  title: string;
  className?: string;
  active: [string, Record<string, unknown>?];
  toggle: (chain: ChainedCommands) => ChainedCommands;
};

const FORMAT_GROUPS: Format[][] = [
  [
    {
      label: "B",
      title: "Bold",
      className: "font-bold",
      active: ["bold"],
      toggle: (c) => c.toggleBold(),
    },
    {
      label: "I",
      title: "Italic",
      className: "italic",
      active: ["italic"],
      toggle: (c) => c.toggleItalic(),
    },
    {
      label: "S",
      title: "Strikethrough",
      className: "line-through",
      active: ["strike"],
      toggle: (c) => c.toggleStrike(),
    },
    {
      label: "Code",
      title: "Inline code",
      className: "font-mono",
      active: ["code"],
      toggle: (c) => c.toggleCode(),
    },
  ],
  HEADING_LEVELS.map((level): Format => ({
    label: `H${level}`,
    title: `Heading ${level}`,
    active: ["heading", { level }],
    toggle: (c) => c.toggleHeading({ level }),
  })),
  [
    {
      label: "List",
      title: "Bulleted list",
      active: ["bulletList"],
      toggle: (c) => c.toggleBulletList(),
    },
    {
      label: "1. List",
      title: "Numbered list",
      active: ["orderedList"],
      toggle: (c) => c.toggleOrderedList(),
    },
    {
      label: "Quote",
      title: "Quote",
      active: ["blockquote"],
      toggle: (c) => c.toggleBlockquote(),
    },
    {
      label: "Code block",
      title: "Code block",
      className: "font-mono",
      active: ["codeBlock"],
      toggle: (c) => c.toggleCodeBlock(),
    },
  ],
];

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
    extensions: RICH_TEXT_EXTENSIONS,
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

  // The URL field under the toolbar: `null` while closed, else its draft value.
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(false);

  const closeLink = () => {
    setLinkDraft(null);
    setLinkInvalid(false);
    editor?.commands.focus();
  };

  const applyLink = () => {
    if (!editor || linkDraft === null) return;
    const href = linkDraft.trim();
    if (href === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      closeLink();
      return;
    }
    if (!isSafeLinkHref(href)) {
      setLinkInvalid(true);
      return;
    }
    // A caret outside any link has no text to mark, so the URL becomes its own linked text.
    if (editor.state.selection.empty && !editor.isActive("link")) {
      editor
        .chain()
        .focus()
        .insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] })
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    closeLink();
  };

  const removeLink = () => {
    editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    closeLink();
  };

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
        {FORMAT_GROUPS.map((group, i) => (
          <div key={i} className="contents">
            {i > 0 && TOOL_DIVIDER}
            {group.map((format) => (
              <button
                key={format.label}
                type="button"
                title={format.title}
                onClick={() => format.toggle(editor.chain().focus()).run()}
                className={cn(
                  TOOL,
                  format.className,
                  editor.isActive(...format.active) ? TOOL_ON : TOOL_OFF,
                )}
              >
                {format.label}
              </button>
            ))}
          </div>
        ))}
        {TOOL_DIVIDER}
        <button
          type="button"
          title="Link the selected text (http or https URL)"
          onClick={() => {
            setLinkInvalid(false);
            setLinkDraft(
              linkDraft === null ? (editor.getAttributes("link").href ?? "") : null,
            );
          }}
          className={`${TOOL} ${
            editor.isActive("link") || linkDraft !== null ? TOOL_ON : TOOL_OFF
          }`}
        >
          Link
        </button>
        {allowImages && (
          <>
            {TOOL_DIVIDER}
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

      {linkDraft !== null && (
        <div className="flex flex-wrap items-center gap-1 px-2 py-1 border-b border-neutral-700">
          <Input
            type="url"
            aria-label="Link URL"
            placeholder="https://en.wikipedia.org/wiki/..."
            autoFocus
            value={linkDraft}
            invalid={linkInvalid}
            aria-invalid={linkInvalid}
            className="flex-1 min-w-48"
            onChange={(e) => {
              setLinkDraft(e.target.value);
              setLinkInvalid(false);
            }}
            onKeyDown={(e) => {
              // Enter would otherwise submit the form this editor sits in.
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeLink();
              }
            }}
          />
          <Button variant="ghost" onClick={applyLink}>
            Apply
          </Button>
          {editor.isActive("link") && (
            <Button variant="ghost" onClick={removeLink}>
              Remove
            </Button>
          )}
          <Button variant="ghost" onClick={closeLink}>
            Cancel
          </Button>
        </div>
      )}

      <EditorContent editor={editor} />
    </div>
  );
}
