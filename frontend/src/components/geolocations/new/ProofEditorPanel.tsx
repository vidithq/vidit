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
  proof: Record<string, unknown> | null;
  onChange: (proof: Record<string, unknown> | null) => void;
  /** Local inline images, uploaded as `proof_files[]` at publish. */
  onProofFilesChange?: (files: File[]) => void;
  invalid?: boolean;
}

/** The "Proof" section: the dynamically loaded Tiptap editor. */
export function ProofEditorPanel({
  proof,
  onChange,
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

      {/* Tiptap reads `initialContent` once: seeding from the current `proof`
          restores the draft when the panel remounts on a submit-type toggle. */}
      <ProofEditor
        initialContent={proof}
        onChange={onChange}
        onProofFilesChange={onProofFilesChange}
      />
    </Card>
  );
}
