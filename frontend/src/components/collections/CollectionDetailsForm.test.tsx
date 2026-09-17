import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The one-paragraph document the proof editor emits for unmarked text. */
function textDoc(text: string): Record<string, unknown> {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

// The description is written in the Tiptap proof editor, which boots
// ProseMirror. What this file locks in is what the form does with the document
// the editor hands it, so the editor is a textarea that emits one, and the
// props the form passes it are asserted through the marks it prints.
vi.mock("@/components/editor/ProofEditor", () => ({
  default: ({
    onChange,
    allowImages,
    invalid,
  }: {
    onChange: (doc: Record<string, unknown>) => void;
    allowImages?: boolean;
    invalid?: boolean;
  }) => (
    <textarea
      aria-label="Description"
      data-allow-images={String(allowImages)}
      data-invalid={String(invalid)}
      onChange={(e) => onChange(textDoc(e.target.value))}
    />
  ),
}));

// The picker reaches the catalogue; what it lists is its own test's subject.
vi.mock("@/hooks/useCursorList", () => ({
  useCursorList: () => ({
    items: [],
    error: null,
    loading: false,
    loadingMore: false,
    hasMore: false,
    loadMore: vi.fn(),
    reload: vi.fn(),
  }),
}));

import { COLLECTION_DESCRIPTION_MAX_LEN } from "@/lib/collections";

import { CollectionDetailsForm } from "./CollectionDetailsForm";

const onSubmit = vi.fn();
const onCancel = vi.fn();

/** Render, then wait for the editor: the form loads it through `next/dynamic`,
 *  so the description field lands one microtask after the first paint. */
async function renderForm(props: Record<string, unknown> = {}) {
  const result = render(
    <CollectionDetailsForm
      username="ana"
      submitLabel="Create collection"
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...props}
    />,
  );
  await screen.findByRole("textbox", { name: "Description" });
  return result;
}

const titleField = () => screen.getByLabelText("Title");
const descriptionField = () =>
  screen.getByRole("textbox", { name: "Description" });
const submit = () => screen.getByRole("button", { name: "Create collection" });

function fill(title: string, description: string) {
  fireEvent.change(titleField(), { target: { value: title } });
  fireEvent.change(descriptionField(), { target: { value: description } });
}

beforeEach(() => {
  onSubmit.mockReset();
  onCancel.mockReset();
});

describe("CollectionDetailsForm", () => {
  it("writes the description in the proof editor, without images", async () => {
    await renderForm();

    expect(descriptionField()).toHaveAttribute("data-allow-images", "false");
  });

  it("hands back the document the editor emitted, not a string", async () => {
    await renderForm();
    fill("March strikes", "Strikes on the corridor through March.");
    fireEvent.click(submit());

    expect(onSubmit).toHaveBeenCalledWith(
      "March strikes",
      textDoc("Strikes on the corridor through March."),
      [],
    );
  });

  it("counts the document's text, so marking a word up costs nothing", async () => {
    await renderForm();
    fill("March strikes", "Twelve chars");

    // `remaining / cap`, over the projection rather than over the serialised
    // document: the same reading the server measures the cap on.
    expect(
      screen.getByText(`${COLLECTION_DESCRIPTION_MAX_LEN - 12} / ${COLLECTION_DESCRIPTION_MAX_LEN}`),
    ).toBeInTheDocument();
  });

  it("refuses a description whose text is blank", async () => {
    await renderForm();
    fireEvent.change(titleField(), { target: { value: "March strikes" } });

    expect(submit()).toBeDisabled();

    fireEvent.change(descriptionField(), { target: { value: "   " } });
    expect(submit()).toBeDisabled();

    fireEvent.change(descriptionField(), { target: { value: "Something." } });
    expect(submit()).not.toBeDisabled();
  });

  it("refuses a description past the cap, and flags the editor red", async () => {
    await renderForm();
    fill("March strikes", "x".repeat(COLLECTION_DESCRIPTION_MAX_LEN + 1));

    expect(submit()).toBeDisabled();
    // The outline and the disabled submit turn over together, the way every
    // capped field on the site behaves.
    expect(descriptionField()).toHaveAttribute("data-invalid", "true");
  });

  it("opens an edit on the collection's own document", async () => {
    await renderForm({
      initialTitle: "Kupiansk rail corridor",
      initialDescription: textDoc("Three days of strikes."),
      submitLabel: "Save collection",
    });

    expect(titleField()).toHaveValue("Kupiansk rail corridor");
    // Nothing retyped: the save carries what the form opened on.
    fireEvent.click(screen.getByRole("button", { name: "Save collection" }));
    expect(onSubmit).toHaveBeenCalledWith(
      "Kupiansk rail corridor",
      textDoc("Three days of strikes."),
      [],
    );
  });
});
