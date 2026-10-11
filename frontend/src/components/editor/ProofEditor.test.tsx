import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Tiptap's useEditor boots ProseMirror, which needs DOM APIs jsdom lacks. Only toolbar wiring is
// asserted, so stub the editor: every chained command is recorded and `run()` ends the chain.
const stub = vi.hoisted(() => {
  const calls: Array<[string, unknown[]]> = [];
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_target, name: string) =>
        (...args: unknown[]) => {
          if (name === "run") return true;
          calls.push([name, args]);
          return chain;
        },
    },
  );
  const state = { linkActive: false, emptySelection: false, href: undefined as string | undefined };
  const editor = {
    isActive: (name: string) => name === "link" && state.linkActive,
    getAttributes: () => ({ href: state.href }),
    chain: () => chain,
    commands: { focus: () => true },
    get state() {
      return { selection: { empty: state.emptySelection } };
    },
  };
  return { calls, state, editor };
});

vi.mock("@tiptap/react", () => ({
  useEditor: () => stub.editor,
  EditorContent: () => null,
}));

import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";

import ProofEditor, { resolveProofDoc } from "./ProofEditor";

beforeEach(() => {
  stub.calls.length = 0;
  Object.assign(stub.state, { linkActive: false, emptySelection: false, href: undefined });
});

const commandNames = () => stub.calls.map(([name]) => name);

function openLinkField(): HTMLInputElement {
  render(<ProofEditor onChange={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Link" }));
  return screen.getByRole("textbox", { name: "Link URL" }) as HTMLInputElement;
}

describe("ProofEditor", () => {
  it("offers the proof-image control by default (upload-at-publish)", () => {
    // The image is held locally and uploaded only at publish via `proof_files[]`, so the control is live.
    render(<ProofEditor onChange={() => {}} />);
    const control = screen.getByText("+ Image");
    expect(control).toBeInTheDocument();
    expect(control.querySelector('input[type="file"]')).not.toBeNull();
  });

  it("drops the image control, and nothing else, under allowImages={false}", () => {
    // A collection's description is stored with `allow_images=False`, so offering the control would
    // stage a file the server drops. Marks, list and link controls stay: one editor serves both.
    render(<ProofEditor onChange={() => {}} allowImages={false} />);
    expect(screen.queryByText("+ Image")).not.toBeInTheDocument();
    for (const label of ["B", "I", "S", "Code", "H2", "H3", "List", "1. List", "Quote", "Code block", "Link"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("toggles each format through its own command", () => {
    render(<ProofEditor onChange={() => {}} />);
    const expected: Array<[string, string, unknown[]]> = [
      ["B", "toggleBold", []],
      ["I", "toggleItalic", []],
      ["S", "toggleStrike", []],
      ["Code", "toggleCode", []],
      ["H2", "toggleHeading", [{ level: 2 }]],
      ["H3", "toggleHeading", [{ level: 3 }]],
      ["List", "toggleBulletList", []],
      ["1. List", "toggleOrderedList", []],
      ["Quote", "toggleBlockquote", []],
      ["Code block", "toggleCodeBlock", []],
    ];
    for (const [label, command, args] of expected) {
      stub.calls.length = 0;
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(stub.calls).toEqual([["focus", []], [command, args]]);
    }
  });

  it("wears the shared invalid outline when the caller flags it", () => {
    const { container, rerender } = render(<ProofEditor onChange={() => {}} />);
    const box = container.firstElementChild as HTMLElement;
    expect(box.className).not.toContain(FORM_INVALID_FIELD);

    rerender(<ProofEditor onChange={() => {}} invalid />);
    expect(
      (container.firstElementChild as HTMLElement).className,
    ).toContain(FORM_INVALID_FIELD);
  });

  it("keeps resolveProofDoc pure: a doc with no staged images passes through", () => {
    const json = { type: "doc", content: [] };
    expect(resolveProofDoc(json, [])).toEqual({ doc: json, files: [] });
  });
});

describe("ProofEditor link control", () => {
  it("links the selected text to an https URL", () => {
    const field = openLinkField();
    fireEvent.change(field, { target: { value: " https://en.wikipedia.org/wiki/Leopard_2 " } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(stub.calls).toContainEqual([
      "setLink",
      [{ href: "https://en.wikipedia.org/wiki/Leopard_2" }],
    ]);
    expect(screen.queryByRole("textbox", { name: "Link URL" })).not.toBeInTheDocument();
  });

  it("inserts the URL as its own linked text at a bare caret", () => {
    stub.state.emptySelection = true;
    const field = openLinkField();
    fireEvent.change(field, { target: { value: "https://example.com/a" } });
    fireEvent.keyDown(field, { key: "Enter" });

    const href = "https://example.com/a";
    expect(stub.calls).toContainEqual([
      "insertContent",
      [{ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }],
    ]);
    expect(commandNames()).not.toContain("setLink");
  });

  it("refuses a URL that is not http(s) and keeps the field open, flagged", () => {
    const field = openLinkField();
    for (const value of ["javascript:alert(1)", "example.com", "mailto:a@example.com"]) {
      fireEvent.change(field, { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      expect(field).toHaveAttribute("aria-invalid", "true");
    }
    expect(commandNames()).not.toContain("setLink");
    expect(commandNames()).not.toContain("insertContent");
  });

  it("prefills the current href and offers Remove on an existing link", () => {
    stub.state.linkActive = true;
    stub.state.href = "https://example.com/old";
    const field = openLinkField();
    expect(field.value).toBe("https://example.com/old");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(commandNames()).toEqual(["focus", "extendMarkRange", "unsetLink"]);
  });

  it("hides Remove when the selection holds no link", () => {
    openLinkField();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });
});
