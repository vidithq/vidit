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
  it("offers the proof-image control by default (upload-at-publish)", () => {
    // The image is held locally (blob preview + retained File) and uploaded
    // only at publish via `proof_files[]`, so the control is live, not the old
    // disabled placeholder.
    render(<ProofEditor onChange={() => {}} />);
    const control = screen.getByText("+ Image");
    expect(control).toBeInTheDocument();
    // It's a label wrapping a hidden file input, not a disabled button.
    expect(control.querySelector('input[type="file"]')).not.toBeNull();
  });

  it("drops the image control when allowImages is false", () => {
    // A request's proof maps to the same `events.proof` column, in progress
    // (else it'd be a geolocation), and stays image-free there.
    render(<ProofEditor onChange={() => {}} allowImages={false} />);
    expect(screen.queryByText("+ Image")).toBeNull();
    // Formatting controls stay.
    expect(screen.getByRole("button", { name: "B" })).toBeInTheDocument();
  });
});
