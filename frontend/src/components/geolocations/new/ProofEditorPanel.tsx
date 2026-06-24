"use client";

import dynamic from "next/dynamic";

import FieldHelp from "@/components/ui/FieldHelp";
import { OptionalHint } from "@/components/ui/OptionalHint";

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
  onUploadStateChange?: (uploading: boolean) => void;
  /** Bounty mode: a bounty's proof is in-progress (else it'd be a
   *  geolocation), so it's optional and image-free — see ProofEditor. */
  allowImages?: boolean;
  optional?: boolean;
}

/** The "Proof" section: the dynamically-loaded Tiptap editor where the
 *  analyst annotates the source-media ↔ satellite cross-reference. */
export function ProofEditorPanel({
  importedFrom,
  importGen,
  proof,
  onChange,
  onUploadStateChange,
  allowImages = true,
  optional = false,
}: ProofEditorPanelProps) {
  return (
    <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
      <header>
        <h2 className="text-sm font-medium text-neutral-200 inline-flex items-center gap-1.5">
          Proof
          <FieldHelp concept="section_proof" />
          {optional && <OptionalHint />}
        </h2>
      </header>

      {/* Re-mount the editor on every import. ``importGen`` changes even
          on same-author re-import, where the handle alone would leave the
          ``key`` unchanged and Tiptap would keep its old content despite
          the new ``initialContent``. Seeding from the current ``proof``
          (not null) also restores the draft when the panel remounts on a
          submit-type toggle. */}
      <ProofEditor
        key={importedFrom !== null ? `import-${importGen}` : "blank"}
        initialContent={proof}
        onChange={onChange}
        onUploadStateChange={onUploadStateChange}
        allowImages={allowImages}
      />
    </section>
  );
}
