import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { textHtml } from "@/test/proofEditorStub";

vi.mock("@/components/editor/ProofEditor", () => import("@/test/proofEditorStub"));

// The picker is `EventPicker.test.tsx`'s subject.
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

/**
 * Render, then wait for the `next/dynamic` editor (one microtask after first
 *  *  paint).
 */
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

  it("hands back the HTML the editor emitted", async () => {
    await renderForm();
    fill("March strikes", "Strikes on the corridor through March.");
    fireEvent.click(submit());

    expect(onSubmit).toHaveBeenCalledWith(
      "March strikes",
      textHtml("Strikes on the corridor through March."),
      [],
    );
  });

  it("counts the description's text, so marking a word up costs nothing", async () => {
    await renderForm();
    fill("March strikes", "Twelve chars");

    // Counted over the plain-text projection, as the server measures the cap.
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
    // The outline and the disabled submit turn over together.
    expect(descriptionField()).toHaveAttribute("data-invalid", "true");
  });

  it("opens an edit on the collection's own description", async () => {
    await renderForm({
      initialTitle: "Kupiansk rail corridor",
      initialDescription: textHtml("Three days of strikes."),
      submitLabel: "Save collection",
    });

    expect(titleField()).toHaveValue("Kupiansk rail corridor");
    fireEvent.click(screen.getByRole("button", { name: "Save collection" }));
    expect(onSubmit).toHaveBeenCalledWith(
      "Kupiansk rail corridor",
      textHtml("Three days of strikes."),
      [],
    );
  });
});
