import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const unsubscribe = vi.hoisted(() => vi.fn());
vi.mock("@/lib/productUpdates", () => ({ unsubscribeFromProductUpdates: unsubscribe }));

const search = vi.hoisted(() => ({ token: "tok.sig" as string | null }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => search.token }),
}));

import UnsubscribePage from "./page";

describe("UnsubscribePage", () => {
  beforeEach(() => {
    unsubscribe.mockReset();
    search.token = "tok.sig";
  });

  it("withdraws nothing until the reader confirms, then confirms the withdrawal", async () => {
    unsubscribe.mockResolvedValue(undefined);
    render(<UnsubscribePage />);
    expect(unsubscribe).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));

    expect(await screen.findByText("You are unsubscribed")).toBeInTheDocument();
    expect(unsubscribe).toHaveBeenCalledWith("tok.sig");
  });

  it("says so when the link does not verify", async () => {
    unsubscribe.mockRejectedValue(new Error("This unsubscribe link is not valid."));
    render(<UnsubscribePage />);

    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));

    expect(await screen.findByText("This unsubscribe link is not valid.")).toBeInTheDocument();
  });

  it("offers no button without a token", () => {
    search.token = null;
    render(<UnsubscribePage />);
    expect(screen.getByRole("button", { name: "Unsubscribe" })).toBeDisabled();
  });
});
