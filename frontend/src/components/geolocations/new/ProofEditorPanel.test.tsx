import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The Tiptap editor loads via next/dynamic(ssr:false) + ProseMirror, which
// needs DOM APIs jsdom lacks. Stub the dynamic loader so we can assert the
// section header (heading, ? help) without booting it.
vi.mock("next/dynamic", () => ({
  default: () => function ProofEditorStub() {
    return null;
  },
}));

import { FORM_INVALID_LABEL } from "@/components/ui/form-styles";

import { ProofEditorPanel } from "./ProofEditorPanel";

const base = {
  importedFrom: null,
  importGen: 0,
  proof: null,
  onChange: () => {},
};

describe("ProofEditorPanel", () => {
  it("renders the section heading, unmarked and not optional", () => {
    render(<ProofEditorPanel {...base} />);
    const heading = screen.getByRole("heading", { name: /Proof/ });
    expect(heading).toBeInTheDocument();
    expect(heading).not.toHaveClass(FORM_INVALID_LABEL);
    expect(screen.queryByText("optional")).toBeNull();
  });

  it("flags the heading red when missing, same as the section's outline", () => {
    render(<ProofEditorPanel {...base} invalid />);
    // The section card already gets FORM_INVALID_FIELD's outline; the
    // heading now turns red too, matching every other required field.
    expect(screen.getByRole("heading", { name: /Proof/ })).toHaveClass(
      FORM_INVALID_LABEL
    );
  });
});
