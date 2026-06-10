"use client";

import dynamic from "next/dynamic";

const ProofEditor = dynamic(
  () => import("@/components/editor/ProofEditor"),
  { ssr: false }
);

interface ProofEditorPanelProps {
  /** Handle of the most recent tweet import; null when none / cleared. */
  importedFrom: string | null;
  /** Monotonic import counter — drives the editor remount key. */
  importGen: number;
  proof: Record<string, unknown> | null;
  onChange: (proof: Record<string, unknown> | null) => void;
  onUploadStateChange: (uploading: boolean) => void;
}

/** The "Proof" section: the dynamically-loaded Tiptap editor where the
 *  analyst annotates the source-media ↔ satellite cross-reference. */
export function ProofEditorPanel({
  importedFrom,
  importGen,
  proof,
  onChange,
  onUploadStateChange,
}: ProofEditorPanelProps) {
  return (
    <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
      <header className="space-y-1">
        <h2 className="text-sm font-medium text-neutral-200">Proof</h2>
        <p className="text-xs text-neutral-500">
          Annotated cross-reference between the source media and a map
          screenshot. Highlight matching anchor points with coloured
          boxes.
        </p>
      </header>

      {/* Re-mount the editor on every import (and on Clear, which
          resets ``importedFrom`` to null). The generation
          counter changes even when the imported author handle is
          the same as the previous import — necessary because a
          same-author re-import would otherwise leave the
          ``key`` unchanged and Tiptap would keep its existing
          content despite the new ``initialContent`` prop. */}
      <ProofEditor
        key={importedFrom !== null ? `import-${importGen}` : "blank"}
        initialContent={importedFrom ? proof : null}
        onChange={onChange}
        onUploadStateChange={onUploadStateChange}
      />
    </section>
  );
}
