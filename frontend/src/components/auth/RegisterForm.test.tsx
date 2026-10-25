import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const register = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ register }) }));

import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";
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

  it("lists every blank field at once, outlines them, and does not register", () => {
    render(<RegisterForm onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ana" } });

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const notice = screen.getByText(/^Fill in the required fields/);
    expect(notice).toHaveTextContent("Invite code");
    expect(notice).toHaveTextContent("Email");
    expect(notice).toHaveTextContent("Password");
    expect(notice).not.toHaveTextContent("Username");
    expect(screen.getByLabelText("Email")).toHaveClass(...FORM_INVALID_FIELD.split(" "));
    expect(screen.getByLabelText("Username")).not.toHaveClass(...FORM_INVALID_FIELD.split(" "));
    expect(register).not.toHaveBeenCalled();
  });

  it("keeps the password length message once every field is filled", () => {
    render(<RegisterForm onSuccess={vi.fn()} initialInviteCode="code" />);
    fill();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText(/at least 8 characters/)).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });
});
