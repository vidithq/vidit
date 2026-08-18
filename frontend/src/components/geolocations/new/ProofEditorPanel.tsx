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
  /** The inline proof images the editor is holding locally; the form uploads
   *  them as `proof_files[]` at publish. */
  onProofFilesChange?: (files: File[]) => void;
  /** Flag the section as a missing required field (red outline). */
  invalid?: boolean;
}

/** The "Proof" section: the dynamically-loaded Tiptap editor where the
 *  analyst annotates the source-media ↔ satellite cross-reference. */
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
      {/* The guide sits in the heading's `trailing` slot: both the submit
          form and the edit form render this panel, so the link reaches the
          analyst at the point of need in each without duplicating markup. */}
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

      {/* Tiptap reads ``initialContent`` once, at construction: seeding from
          the current ``proof`` (not null) restores the draft when the panel
          remounts on a submit-type toggle. */}
      <ProofEditor
        initialContent={proof}
        onChange={onChange}
        onProofFilesChange={onProofFilesChange}
      />
    </Card>
  );
}
