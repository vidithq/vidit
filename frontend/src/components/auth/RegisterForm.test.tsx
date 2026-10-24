import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const register = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ register }) }));

import RegisterForm from "./RegisterForm";

function fill() {
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ana" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ana@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "validpass123" } });
}

describe("RegisterForm", () => {
  beforeEach(() => {
    register.mockReset().mockResolvedValue({ status: "pending_confirmation", email: "ana@example.test" });
  });

  it("registers with the four fields the form asks for", async () => {
    render(<RegisterForm onSuccess={vi.fn()} initialInviteCode="code" />);
    expect(screen.queryByRole("switch")).toBeNull();

    fill();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith("ana", "ana@example.test", "validpass123", "code"),
    );
  });
});
