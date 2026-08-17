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

import ProofEditor, { isProofLinkUri, resolveProofDoc } from "./ProofEditor";

describe("ProofEditor", () => {
  it("offers the proof-image control by default (upload-at-publish)", () => {
    // The image is held locally (blob preview + retained File) and uploaded
    // only at publish via `proof_files[]`, so the control is live.
    render(<ProofEditor onChange={() => {}} />);
    const control = screen.getByText("+ Image");
    expect(control).toBeInTheDocument();
    expect(control.querySelector('input[type="file"]')).not.toBeNull();
  });
});

describe("link URI allowlist", () => {
  // The editor may only mint what survives publication: both sanitisers
  // (`services/sanitize.py::safe_link_href`, `lib/proof.tsx::isSafeLinkHref`)
  // take absolute http(s) only, so anything else would be a link the analyst
  // sees and the reader never gets.
  it("accepts absolute http(s) URLs", () => {
    expect(isProofLinkUri("https://x.com/user/status/1")).toBe(true);
    expect(isProofLinkUri("http://localhost:8000/p")).toBe(true);
    expect(isProofLinkUri("HTTPS://X.COM/a")).toBe(true);
  });

  it("rejects the other protocols linkify registers by default", () => {
    for (const url of [
      "mailto:analyst@example.com",
      "tel:+33123456789",
      "sms:+33123456789",
      "ftp://files.example.com/x",
      "xmpp:analyst@example.com",
    ]) {
      expect(isProofLinkUri(url)).toBe(false);
    }
  });

  it("rejects a scheme-less value, an email, and a smuggled javascript: scheme", () => {
    expect(isProofLinkUri("example.com/a")).toBe(false);
    expect(isProofLinkUri("analyst@example.com")).toBe(false);
    expect(isProofLinkUri("javascript:alert(1)")).toBe(false);
    expect(isProofLinkUri("java\nscript:alert(1)")).toBe(false);
  });
});
