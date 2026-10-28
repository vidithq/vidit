import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events")>()),
  presignArchiveUpload: vi.fn(),
}));

import { NOT_A_ZIP_MESSAGE } from "@/lib/archive";
import { presignArchiveUpload } from "@/lib/events";

import { ImportArchivePanel } from "./ImportArchivePanel";

function renderPanel() {
  return render(
    <ImportArchivePanel
      username="ana"
      shell={({ actions, body }) => (
        <>
          <aside aria-label="Actions">{actions}</aside>
          {body}
        </>
      )}
    />
  );
}

function drop(file: File) {
  fireEvent.drop(screen.getByText("Choose your X archive (.zip)").closest("label")!, {
    dataTransfer: { files: [file] },
  });
}

const importButton = () =>
  within(screen.getByRole("complementary", { name: "Actions" })).getByRole("button", {
    name: "Import archive",
  });

describe("ImportArchivePanel", () => {
  it("refuses a dropped file that is not a zip on the spot, with one message and no steps", () => {
    renderPanel();

    drop(new File(["notes"], "notes.txt", { type: "text/plain" }));

    expect(screen.getByRole("alert")).toHaveTextContent(NOT_A_ZIP_MESSAGE);
    expect(screen.getAllByText(NOT_A_ZIP_MESSAGE)).toHaveLength(1);
    expect(screen.queryByText("notes.txt")).toBeNull();
    expect(screen.queryByText(/ready to import/)).toBeNull();
    expect(screen.queryByText("Filtering out private data")).toBeNull();
    expect(importButton()).toBeDisabled();
    fireEvent.click(importButton());
    expect(presignArchiveUpload).not.toHaveBeenCalled();
  });

  it("stages a zip once picked, and clears the refusal", () => {
    renderPanel();

    drop(new File(["notes"], "notes.txt", { type: "text/plain" }));
    drop(new File(["PK"], "twitter-2026.zip", { type: "application/zip" }));

    expect(screen.queryByText(NOT_A_ZIP_MESSAGE)).toBeNull();
    expect(screen.getByText("twitter-2026.zip")).toBeInTheDocument();
    expect(screen.getByText(/ready to import/)).toBeInTheDocument();
    expect(importButton()).toBeEnabled();
  });
});
