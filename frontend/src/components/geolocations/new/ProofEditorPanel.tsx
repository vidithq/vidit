"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
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

/** The "Proof" section: the event page's eyebrow, with the methodology link beside it, over the
 *  dynamically loaded proof editor. */
export function ProofEditorPanel({
  proof,
  onChange,
  proofFiles,
  onProofFilesChange,
  invalid = false,
}: ProofEditorPanelProps) {
  return (
    <section>
      {/* The link is a sibling of the heading, so it stays out of the heading's name. */}
      <div className="mb-3 flex items-center gap-1.5">
        <SectionEyebrow title="Proof" concept="section_proof" margin="none" invalid={invalid} />
        <Link href="/methodology" className={`ml-1 text-[11px] ${TEXT_LINK}`}>
          Methodology guide
        </Link>
      </div>
      <Card className={invalid ? FORM_INVALID_FIELD : ""}>
        {/* The editor reads both seeds once: on a remount, the current `proof` and its staged
            files restore the draft, inline images included. */}
        <ProofEditor
          initialContent={proof}
          initialProofFiles={proofFiles}
          onChange={onChange}
          onProofFilesChange={onProofFilesChange}
        />
      </Card>
    </section>
  );
}
