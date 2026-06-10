"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

interface ProofEditorProps {
  onChange: (json: Record<string, unknown>) => void;
  // Lets the parent block submit while an upload is in flight: submitting mid-
  // upload sends a proof JSON whose <image> src is still empty, the sanitizer
  // drops the node, and the uploaded file orphans until the reaper sweeps it.
  onUploadStateChange?: (uploading: boolean) => void;
  // Optional initial Tiptap doc (the tweet-import flow seeds a source line).
  // Tiptap reads it once at construction — pair with a ``key`` on the parent to
  // re-seed after mount.
  initialContent?: Record<string, unknown> | null;
}

export default function ProofEditor({
  onChange,
  onUploadStateChange,
  initialContent,
}: ProofEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const setUploadingAndNotify = (value: boolean) => {
    setUploading(value);
    onUploadStateChange?.(value);
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Image],
    content: initialContent ?? undefined,
    editorProps: {
      attributes: {
        class:
          "prose prose-invert prose-sm max-w-none min-h-[200px] px-3 py-2 focus:outline-hidden",
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getJSON());
    },
  });

  const handleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    // Reset input first so the same file can be re-selected
    e.target.value = "";
    if (!file || !editor) return;

    setUploadError(null);
    setUploadingAndNotify(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { url } = await apiFetch<{ url: string }>(
        "/geolocations/proof-images",
        { method: "POST", body: formData }
      );
      editor.chain().focus().setImage({ src: url }).run();
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Image upload failed"
      );
    } finally {
      setUploadingAndNotify(false);
    }
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
        <div className="w-px h-4 bg-neutral-700 mx-1" />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="px-2 py-1 rounded-sm text-xs text-neutral-400 hover:bg-neutral-700 disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "+ Image"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleImageUpload}
          className="hidden"
        />
      </div>

      <EditorContent editor={editor} />

      {uploadError && (
        <div className="px-3 py-2 border-t border-red-900/50 text-xs text-red-400">
          {uploadError}
        </div>
      )}
    </div>
  );
}
