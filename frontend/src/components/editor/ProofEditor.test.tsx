import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Tiptap's useEditor boots ProseMirror, which needs DOM APIs jsdom lacks. We
// only assert the toolbar wiring, so stub the editor: truthy (so the component
// renders past `if (!editor) return null`) with the `isActive` it calls at
// render time for button styling.
vi.mock("@tiptap/react", () => ({
  useEditor: () => ({ isActive: () => false }),
  EditorContent: () => null,
}));

import ProofEditor from "./ProofEditor";

describe("ProofEditor", () => {
  it("shows the image-upload control by default", () => {
    render(<ProofEditor onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "+ Image" })).toBeInTheDocument();
  });

  it("drops the image-upload control when allowImages is false", () => {
    // A bounty's proof maps to `bounties.proof` and is image-free (inline
    // images would orphan — no bounty_id on proof_images), so the editor must
    // not offer image upload there.
    render(<ProofEditor onChange={() => {}} allowImages={false} />);
    expect(screen.queryByRole("button", { name: "+ Image" })).toBeNull();
    // Formatting controls stay.
    expect(screen.getByRole("button", { name: "B" })).toBeInTheDocument();
  });
});
