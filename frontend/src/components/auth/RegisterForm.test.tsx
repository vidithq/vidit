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

  it("leaves the major release email switch off by default", async () => {
    render(<RegisterForm onSuccess={vi.fn()} initialInviteCode="code" />);
    const releases = screen.getByRole("switch", { name: "Email me about major releases" });
    expect(releases).toHaveAttribute("aria-checked", "false");

    fill();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith("ana", "ana@example.test", "validpass123", "code", false),
    );
  });

  it("sends the consent when the analyst turns the switch on", async () => {
    render(<RegisterForm onSuccess={vi.fn()} initialInviteCode="code" />);
    fireEvent.click(screen.getByRole("switch", { name: "Email me about major releases" }));

    fill();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith("ana", "ana@example.test", "validpass123", "code", true),
    );
  });
});
