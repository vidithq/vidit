import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const register = vi.fn();
vi.mock("@/lib/users", () => ({ register: (body: unknown) => register(body) }));

import RegisterForm from "./RegisterForm";

function fill() {
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ana" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ana@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "validpass123" } });
}

describe("RegisterForm", () => {
  beforeEach(() => {
    register.mockResolvedValue({ status: "pending_confirmation", email: "ana@example.test" });
  });

  it("registers with the four fields the form asks for", async () => {
    render(<RegisterForm onSuccess={vi.fn()} initialInviteCode="code" />);
    expect(screen.queryByRole("switch")).toBeNull();

    fill();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({
        username: "ana",
        email: "ana@example.test",
        password: "validpass123",
        invite_code: "code",
      }),
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
    expect(screen.getByLabelText("Email")).toBeInvalid();
    expect(screen.getByLabelText("Username")).not.toBeInvalid();
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

  it.each(["ana b", "ana.b", "café", "a".repeat(51)])(
    "refuses the username %j before submit and states the rule",
    (username) => {
      render(<RegisterForm onSuccess={vi.fn()} initialInviteCode="code" />);
      fill();
      fireEvent.change(screen.getByLabelText("Username"), { target: { value: username } });

      fireEvent.click(screen.getByRole("button", { name: "Continue" }));

      expect(
        screen.getByText(/letters A to Z, digits, underscores or hyphens/),
      ).toBeInTheDocument();
      expect(register).not.toHaveBeenCalled();
    },
  );

  it.each(["Ana_B-2", "a".repeat(50)])("submits the username %j", async (username) => {
    render(<RegisterForm onSuccess={vi.fn()} initialInviteCode="code" />);
    fill();
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: username } });

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith(expect.objectContaining({ username })),
    );
  });
});
