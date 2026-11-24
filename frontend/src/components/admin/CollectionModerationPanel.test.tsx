import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/test/apiStub";
vi.mock("@/lib/api", () => import("@/test/apiStub"));

import { CollectionModerationPanel } from "./CollectionModerationPanel";

const ID = "44444444-4444-4444-4444-444444444444";
const FIELD = "Collection (ID or link)";

describe("<CollectionModerationPanel>", () => {
  it("enables its two actions once a collection ID or link is pasted", () => {
    render(<CollectionModerationPanel />);
    expect(screen.getByRole("button", { name: "Restore" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Hide" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(FIELD), {
      target: { value: `https://example.org/collections/${ID}` },
    });

    expect(screen.getByRole("button", { name: "Restore" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Hide" })).toBeEnabled();
  });

  it("restores a withheld collection in one click", async () => {
    apiFetch.mockResolvedValue({ collection_id: ID, title: "Dossier", hidden_at: null });
    render(<CollectionModerationPanel />);
    fireEvent.change(screen.getByLabelText(FIELD), { target: { value: ID } });

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(`/admin/collections/${ID}/moderation`, {
        method: "PATCH",
        body: JSON.stringify({ hidden: false }),
      }),
    );
    expect(await screen.findByText("Restored")).toBeInTheDocument();
    expect(screen.getByText("Visible on every public read.")).toBeInTheDocument();
  });

  it("hides only on the second click of its in-place confirm", async () => {
    apiFetch.mockResolvedValue({
      collection_id: ID,
      title: "Dossier",
      hidden_at: "2026-11-24T09:00:00Z",
    });
    render(<CollectionModerationPanel />);
    fireEvent.change(screen.getByLabelText(FIELD), { target: { value: ID } });

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(apiFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm hide" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(`/admin/collections/${ID}/moderation`, {
        method: "PATCH",
        body: JSON.stringify({ hidden: true }),
      }),
    );
    expect(await screen.findByText("Hidden")).toBeInTheDocument();
  });
});
