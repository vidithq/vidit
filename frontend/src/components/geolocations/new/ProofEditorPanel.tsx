"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

import { ProofSection } from "@/components/ui/ProofSection";
import { TEXT_LINK } from "@/components/ui/styles";

const ProofEditor = dynamic(
  () => import("@/components/editor/ProofEditor"),
  { ssr: false }
);

interface ProofEditorPanelProps {
  proof: string | null;
  onChange: (proof: string) => void;
  /** Local inline images, uploaded as `proof_files[]` at publish. */
  proofFiles?: readonly File[];
  onProofFilesChange?: (files: File[]) => void;
  invalid?: boolean;
}

/** Beside the form's Proof eyebrow: the methodology guide. */
export const PROOF_GUIDE_LINK = (
  <Link href="/methodology" className={`ml-1 text-[11px] ${TEXT_LINK}`}>
    Methodology guide
  </Link>
);

/** The form's proof card: the event page's `ProofSection` holding the dynamically loaded proof
 *  editor. The editor reads both seeds once: on a remount, the current `proof` and its staged
 *  files restore the draft, inline images included. */
export function ProofEditorPanel({
  proof,
  onChange,
  proofFiles,
  onProofFilesChange,
  invalid = false,
}: ProofEditorPanelProps) {
  return (
    <ProofSection editor invalid={invalid}>
      <ProofEditor
        bare
        initialContent={proof}
        initialProofFiles={proofFiles}
        onChange={onChange}
        onProofFilesChange={onProofFilesChange}
      />
    </ProofSection>
  );
}
