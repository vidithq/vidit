import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The Tiptap editor loads via next/dynamic(ssr:false) + ProseMirror, which
// needs DOM APIs jsdom lacks. Stub the dynamic loader so we can assert the
// section header (heading, ? help, optional marker) without booting it.
vi.mock("next/dynamic", () => ({
  default: () => function ProofEditorStub() {
    return null;
  },
}));

import { ProofEditorPanel } from "./ProofEditorPanel";

const base = {
  importedFrom: null,
  importGen: 0,
  proof: null,
  onChange: () => {},
};

describe("ProofEditorPanel", () => {
  it("marks the section optional when optional is set (request mode)", () => {
    render(<ProofEditorPanel {...base} optional />);
    expect(screen.getByRole("heading", { name: /Proof/ })).toBeInTheDocument();
    expect(screen.getByText("optional")).toBeInTheDocument();
  });

  it("has no optional marker by default (geolocation mode, required)", () => {
    render(<ProofEditorPanel {...base} />);
    expect(screen.getByRole("heading", { name: /Proof/ })).toBeInTheDocument();
    expect(screen.queryByText("optional")).toBeNull();
  });
});
