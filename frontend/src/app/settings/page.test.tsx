import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({
    user: { id: "u1", username: "ana", email: "ana@example.test" },
    loading: false,
  }),
}));

import SettingsPage from "./page";

describe("SettingsPage account section", () => {
  it("shows the account's email, read-only, beside the username", () => {
    render(<SettingsPage />);

    const account = screen.getByRole("heading", { name: "Account" }).parentElement!;
    expect(account).toHaveTextContent("ana@example.test");
    expect(account).toHaveTextContent("ana");
    // Read-only: the address prints as text, not as a field.
    expect(screen.queryByDisplayValue("ana@example.test")).toBeNull();
  });
});
