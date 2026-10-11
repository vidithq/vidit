"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
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

/** The "Proof" section: the dynamically loaded proof editor. */
export function ProofEditorPanel({
  proof,
  onChange,
  proofFiles,
  onProofFilesChange,
  invalid = false,
}: ProofEditorPanelProps) {
  return (
    <Card
      as="section"
      className={invalid ? FORM_INVALID_FIELD : ""}
    >
      <SectionHeading
        title="Proof"
        concept="section_proof"
        invalid={invalid}
        trailing={
          <Link
            href="/methodology"
            className={`ml-1 text-[11px] font-normal ${TEXT_LINK}`}
          >
            Methodology guide
          </Link>
        }
      />

      {/* The editor reads both seeds once: on a remount, the current `proof` and its staged
          files restore the draft, inline images included. */}
      <ProofEditor
        initialContent={proof}
        initialProofFiles={proofFiles}
        onChange={onChange}
        onProofFilesChange={onProofFilesChange}
      />
    </Card>
  );
}
