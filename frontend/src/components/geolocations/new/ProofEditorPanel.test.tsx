import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Stub the `next/dynamic` Tiptap loader (jsdom lacks the DOM APIs ProseMirror
// needs) to assert the section header.
vi.mock("next/dynamic", () => ({
  default: () => function ProofEditorStub() {
    return null;
  },
}));

import { FORM_INVALID_LABEL } from "@/components/ui/form-styles";

import { ProofEditorPanel } from "./ProofEditorPanel";

const base = {
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
    expect(screen.getByRole("heading", { name: /Proof/ })).toHaveClass(
      FORM_INVALID_LABEL
    );
  });
});
