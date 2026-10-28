import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { textHtml } from "@/test/proofEditorStub";

vi.mock("@/components/editor/ProofEditor", () => import("@/test/proofEditorStub"));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

// MapLibre needs WebGL; the stub reports the pins it was handed.
vi.mock("@/components/map/Map", () => ({
  default: ({ points }: { points: unknown[] }) => (
    <div data-testid="map" data-points={points.length} />
  ),
}));

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
      title="New collection"
      owner={{ username: "ana", avatar_url: null }}
      backFallback="/profile/ana"
      username="ana"
      submitLabel="Create collection"
      submitAction="newCollection"
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
      screen.getByText(`12 / ${COLLECTION_DESCRIPTION_MAX_LEN}`),
    ).toBeInTheDocument();
  });

  it("counts what the submit still refuses, and flags it red on click", async () => {
    await renderForm();

    // Never disabled: the badge names the gaps before the click.
    expect(submit()).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: "2 missing: Title, Description" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(submit());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/^Fill in the required fields/)).toHaveTextContent(
      "Fill in the required fields before continuing: Title, Description.",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(titleField().className).toContain("border-red-500");
    expect(descriptionField()).toHaveAttribute("data-invalid", "true");

    // Filling a field clears its flag and its line.
    fireEvent.change(titleField(), { target: { value: "March strikes" } });
    expect(titleField().className).not.toContain("border-red-500");
    expect(screen.getByText(/^Fill in the required fields/)).not.toHaveTextContent("Title");
  });

  it("refuses a title alone: the description is required on its own", async () => {
    await renderForm();
    fireEvent.change(titleField(), { target: { value: "March strikes" } });

    expect(
      screen.getByRole("button", { name: "1 missing: Description" }),
    ).toBeInTheDocument();
    fireEvent.click(submit());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/^Fill in the required fields/)).toHaveTextContent(
      "Fill in the required fields before continuing: Description.",
    );
    expect(descriptionField()).toHaveAttribute("data-invalid", "true");
    expect(titleField().className).not.toContain("border-red-500");
  });

  it("refuses a description whose text is blank", async () => {
    await renderForm();
    fill("March strikes", "   ");
    fireEvent.click(submit());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/^Fill in the required fields/)).toHaveTextContent("Description");

    fireEvent.change(descriptionField(), { target: { value: "Something." } });
    expect(screen.queryByText(/^Fill in the required fields/)).toBeNull();
    fireEvent.click(submit());
    expect(onSubmit).toHaveBeenCalled();
  });

  it("refuses a description past the cap, and flags the editor red as it is typed", async () => {
    await renderForm();
    fill("March strikes", "x".repeat(COLLECTION_DESCRIPTION_MAX_LEN + 1));

    // The outline and the counter turn over together, before any click.
    expect(descriptionField()).toHaveAttribute("data-invalid", "true");
    expect(
      screen.getByRole("button", {
        name: `1 missing: Description (${COLLECTION_DESCRIPTION_MAX_LEN} characters at most)`,
      }),
    ).toBeInTheDocument();
    fireEvent.click(submit());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("puts Cancel beside the submit in the page's actions", async () => {
    await renderForm();

    const actions = screen.getByRole("complementary", { name: "Actions" });
    expect(actions).toContainElement(submit());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
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

  it("lays out like the collection page: the byline, then Coverage and Details", async () => {
    await renderForm();

    expect(screen.getByRole("link", { name: "ana" })).toHaveAttribute("href", "/profile/ana");
    expect(screen.getByText("Collection")).toBeInTheDocument();
    expect(screen.getByText("The map shows the events you add.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Details" })).toBeInTheDocument();
  });

  it("maps the held events and adds them up in Details", async () => {
    const held = (id: string, date: string, coords: { lat: number; lng: number } | null) => ({
      id,
      title: `Strike ${id}`,
      status: "geolocated" as const,
      media: null,
      is_graphic: false,
      occurred_date: date,
      coords,
      tags: [],
    });
    await renderForm({
      initialEvents: [
        held("e1", "2026-03-14", { lat: 49.71, lng: 37.616 }),
        held("e2", "2026-03-16", null),
      ],
    });

    expect(await screen.findByTestId("map")).toHaveAttribute("data-points", "1");
    expect(screen.getByText("14 Mar 2026 to 16 Mar 2026")).toBeInTheDocument();
  });
});
