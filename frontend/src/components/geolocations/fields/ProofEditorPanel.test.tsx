import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Stub the `next/dynamic` editor loader: only the card around it is asserted.
vi.mock("next/dynamic", () => ({
  default: () => function ProofEditorStub() {
    return <div data-testid="editor" />;
  },
}));

import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";

import { ProofEditorPanel } from "./ProofEditorPanel";

const base = {
  proof: null,
  onChange: () => {},
};

const card = () => screen.getByTestId("editor").parentElement!;

describe("ProofEditorPanel", () => {
  it("frames the editor in the event page's proof card, unmarked", () => {
    render(<ProofEditorPanel {...base} />);
    expect(card().className).not.toContain(FORM_INVALID_FIELD);
    expect(card()).toHaveClass("p-4");
  });

  it("outlines the card red when the proof is missing", () => {
    render(<ProofEditorPanel {...base} invalid />);
    expect(card().className).toContain(FORM_INVALID_FIELD);
  });
});
