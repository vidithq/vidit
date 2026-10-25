"use client";

import "@blocknote/mantine/style.css";

import { useEffect, useRef } from "react";
import {
  BlockNoteSchema,
  createHeadingBlockSpec,
  defaultBlockSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";
import {
  FileCaptionButton,
  FilePanel,
  FilePanelController,
  FilePreviewButton,
  FileReplaceButton,
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  NestBlockButton,
  TextAlignButton,
  UnnestBlockButton,
  UploadTab,
  useCreateBlockNote,
  useDictionary,
  type FilePanelProps,
  type FormattingToolbarProps,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";

import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";
import { FIELD_TEXT } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { ACCEPTED_IMAGE_MIME } from "@/lib/mediaTypes";
import { isSafeLinkHref, proofImageSrcs } from "@/lib/proof";
import { PROOF_PLACEHOLDER_PREFIX, safeProofFilename } from "@/lib/proofImages";

interface ProofEditorProps {
  onChange: (html: string) => void;
  /** The proof body's inline images, kept locally while typing and uploaded at publish (as
   * `proof_files[]`). Fires on every change so the parent stages exactly the files the body
   * still references. */
  onProofFilesChange?: (files: File[]) => void;
  /** Stored HTML to start from. Read once at mount: pair with a `key` on the parent to re-seed. */
  initialContent?: string | null;
  /** The files `onProofFilesChange` last reported, read once at mount: a remount seeded with
   *  `placeholder://` srcs still previews and reports them. */
  initialProofFiles?: readonly File[];
  /** False for a body stored without images (a collection's description): no image block, no
   * upload path. */
  allowImages?: boolean;
  /** Red invalid outline on the editor's box (FORM_INVALID_FIELD) for a caller whose submit refuses the body. */
  invalid?: boolean;
  /** The editor is the section's card itself, padded like the event page's proof card, its text
   *  starting where that card's text starts: an event form's Proof. Otherwise it is a field. */
  bare?: boolean;
}

type StagedImage = { placeholder: string; previewUrl: string; file: File };

// A transparent pixel: what an image shows when its placeholder has no staged file.
const BLANK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** What an image block's URL loads from: a staged file's blob URL, a stored URL as is. A
 *  placeholder with no staged file (the staging emptied as the editor unmounts) loads a blank
 *  pixel, so no `placeholder://` src reaches an `img`, which the browser cannot fetch. */
export function previewUrl(url: string, staged: readonly StagedImage[]): string {
  const hit = staged.find((s) => s.placeholder === url);
  if (hit) return hit.previewUrl;
  return url.startsWith(PROOF_PLACEHOLDER_PREFIX) ? BLANK_IMAGE : url;
}

/** The staged files the emitted HTML still references as an `<img src>`: a deleted image drops
 *  its file. */
export function referencedProofFiles(html: string, staged: readonly StagedImage[]): File[] {
  const srcs = new Set(proofImageSrcs(html));
  return staged.filter((s) => srcs.has(s.placeholder)).map((s) => s.file);
}

const { paragraph, bulletListItem, numberedListItem, quote, divider, codeBlock, image } =
  defaultBlockSpecs;
const { bold, italic, strike, code } = defaultStyleSpecs;

const IMAGE_MIMES = ACCEPTED_IMAGE_MIME.split(",");

// The picker and paste/drop read `fileBlockAccept`; BlockNote's default is `image/*`.
const proofImage = {
  ...image,
  implementation: {
    ...image.implementation,
    meta: { ...image.implementation.meta, fileBlockAccept: IMAGE_MIMES },
  },
};

// BlockNote turns a pasted or dropped file outside every block's `fileBlockAccept` into a `file`
// block, which neither schema has: the insert throws in a floating promise and the paste or drop
// does nothing visible. Refusing the transfer up front skips that path.
function refusesFiles(transfer: DataTransfer | null, allowImages: boolean): boolean {
  const files = Array.from(transfer?.files ?? []);
  return files.some((f) => !allowImages || !IMAGE_MIMES.includes(f.type));
}

// The blocks and styles the server's `sanitize.py` tag allowlist stores (h2, h3, lists,
// blockquote, pre, hr, img; strong, em, s, code); change both. Underline is left out: the server
// drops `<u>`.
const TEXT_BLOCKS = {
  paragraph,
  heading: createHeadingBlockSpec({ levels: [2, 3], defaultLevel: 2, allowToggleHeadings: false }),
  bulletListItem,
  numberedListItem,
  quote,
  divider,
  codeBlock,
};
const STYLES = { bold, italic, strike, code };

const SCHEMA_WITH_IMAGES = BlockNoteSchema.create({
  blockSpecs: { ...TEXT_BLOCKS, image: proofImage },
  styleSpecs: STYLES,
});

const SCHEMA_TEXT_ONLY = BlockNoteSchema.create({
  blockSpecs: TEXT_BLOCKS,
  styleSpecs: STYLES,
});

// The neutral scale and accent as CSS variables, so the editor follows the reader's theme and
// accent like every Tailwind utility does (`globals.css` remaps both). The wrapper paints the
// field's background.
const VIDIT_THEME = {
  colors: {
    editor: { text: "var(--color-neutral-300)", background: "transparent" },
    menu: { text: "var(--color-neutral-200)", background: "var(--color-neutral-900)" },
    tooltip: { text: "var(--color-neutral-200)", background: "var(--color-neutral-800)" },
    hovered: { text: "var(--color-neutral-100)", background: "var(--color-neutral-800)" },
    selected: { text: "var(--color-neutral-950)", background: "var(--color-orange-400)" },
    disabled: { text: "var(--color-neutral-500)", background: "var(--color-neutral-900)" },
    shadow: "#000000",
    border: "var(--color-neutral-700)",
    sideMenu: "var(--color-neutral-500)",
  },
  borderRadius: 6,
  fontFamily: "var(--font-sans)",
};

// Alignment and nesting do not survive the server allowlist. The replace button opens
// BlockNote's default file panel, whose Embed tab mints off-host image URLs the server refuses.
// With the preview off an image exports as a link, and a caption as `<figure>`, which the server
// drops or flattens. Matched by component, not by BlockNote's item keys, so a key rename can't
// let one back in.
const DROPPED_TOOLBAR_BUTTONS = new Set<unknown>([
  TextAlignButton,
  NestBlockButton,
  UnnestBlockButton,
  FileReplaceButton,
  FilePreviewButton,
  FileCaptionButton,
]);

function ProofFormattingToolbar({ blockTypeSelectItems }: FormattingToolbarProps) {
  return (
    <FormattingToolbar>
      {getFormattingToolbarItems(blockTypeSelectItems).filter(
        (item) => !DROPPED_TOOLBAR_BUTTONS.has(item.type),
      )}
    </FormattingToolbar>
  );
}

// Upload only: images must live on the media host, so the Embed (URL) tab is gone.
function UploadOnlyFilePanel({ blockId }: FilePanelProps) {
  const dict = useDictionary();
  return (
    <FilePanel
      blockId={blockId}
      tabs={[
        {
          name: dict.file_panel.upload.title,
          tabPanel: <UploadTab blockId={blockId} setLoading={() => {}} />,
        },
      ]}
    />
  );
}

/**
 * The BlockNote proof editor, HTML in and out. A picked image never leaves the browser while
 * typing: BlockNote's upload hook stages the file and stores `placeholder://<filename>` as the
 * block's URL, and `resolveFileUrl` previews it from a blob URL. The parent posts the files still
 * referenced as `proof_files[]` at publish, where the server matches each to its placeholder by
 * filename (see `docs/design.md`, rich text).
 *
 * `allowImages={false}` drops the image block for a body stored without images (a collection's
 * description): one editor, so marks, lists and link rules stay the same.
 */
export default function ProofEditor({
  onChange,
  onProofFilesChange,
  initialContent,
  initialProofFiles,
  allowImages = true,
  invalid = false,
  bare = false,
}: ProofEditorProps) {
  const stagedRef = useRef<StagedImage[]>([]);
  // Filenames claimed this session, so two picks of `IMG.jpg` don't share a placeholder (the
  // server rejects a duplicate proof filename).
  const usedNamesRef = useRef<Set<string>>(new Set());
  const seedingRef = useRef(false);

  const stage = (file: File) => {
    usedNamesRef.current.add(file.name);
    const placeholder = `${PROOF_PLACEHOLDER_PREFIX}${file.name}`;
    stagedRef.current.push({ placeholder, previewUrl: URL.createObjectURL(file), file });
    return placeholder;
  };

  const uploadFile = async (file: File) => {
    const name = safeProofFilename(file.name, usedNamesRef.current);
    if (name === null) throw new Error("Unusable filename");
    // Upload under exactly `name` so the server's `safe_original_filename` reproduces the
    // placeholder suffix (a File can't be renamed).
    return stage(file.name === name ? file : new File([file], name, { type: file.type }));
  };

  const editor = useCreateBlockNote({
    schema: allowImages ? SCHEMA_WITH_IMAGES : SCHEMA_TEXT_ONLY,
    links: { isValidLink: isSafeLinkHref },
    uploadFile: allowImages ? uploadFile : undefined,
    resolveFileUrl: async (url: string) => previewUrl(url, stagedRef.current),
    pasteHandler: ({ event, defaultPasteHandler }) =>
      refusesFiles(event.clipboardData, allowImages) || defaultPasteHandler(),
    // Drop has no public hook. A direct editor prop runs before BlockNote's own drop plugin, and
    // its drop cursor still clears on the event.
    _tiptapOptions: {
      editorProps: {
        handleDOMEvents: {
          drop: (_view, event) => {
            if (!refusesFiles(event.dataTransfer, allowImages)) return false;
            event.preventDefault();
            return true;
          },
        },
      },
    },
  });

  // Seed once; the parent re-keys to re-seed. The cleanup empties the staging, so a dev double
  // mount restages, and revokes the staged blob URLs (compose then navigate must not leak them)
  // on the next task, once the editor's images are gone: a revoked blob still in an `img` fails.
  useEffect(() => {
    const staged = stagedRef.current;
    const usedNames = usedNamesRef.current;
    initialProofFiles?.forEach(stage);
    if (initialContent) {
      seedingRef.current = true;
      editor.replaceBlocks(editor.document, editor.tryParseHTMLToBlocks(initialContent));
      seedingRef.current = false;
    }
    return () => {
      const dropped = staged.splice(0);
      usedNames.clear();
      setTimeout(() => {
        for (const s of dropped) URL.revokeObjectURL(s.previewUrl);
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const emit = () => {
    if (seedingRef.current) return;
    // BlockNote writes U+FFFC into an empty block so it survives its own round trip; it is not text.
    const html = editor.blocksToHTMLLossy(editor.document).replaceAll("\uFFFC", "");
    onChange(html);
    onProofFilesChange?.(referencedProofFiles(html, stagedRef.current));
  };

  return (
    <div
      className={cn(
        "border focus-within:border-orange-500",
        bare
          ? // `ProofSection`'s card: its padding, and no inline padding of BlockNote's own, so the
            // text starts where the event page's proof text starts. The side menu floats into the
            // card's padding.
            "rounded-lg border-neutral-700 bg-neutral-900 p-4 [&_.bn-editor]:px-0"
          : "rounded-sm border-neutral-700 bg-neutral-800 py-2",
        FIELD_TEXT,
        invalid && FORM_INVALID_FIELD,
      )}
    >
      <BlockNoteView
        editor={editor}
        theme={VIDIT_THEME}
        // BlockNote pins 16px on its root; inherit the field text size instead.
        className="[&_.bn-default-styles]:[font-size:inherit] [&_.bn-editor]:min-h-[184px]"
        formattingToolbar={false}
        filePanel={false}
        onChange={emit}
      >
        <FormattingToolbarController formattingToolbar={ProofFormattingToolbar} />
        <FilePanelController filePanel={UploadOnlyFilePanel} />
      </BlockNoteView>
    </div>
  );
}
