import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const login = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ login }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";
import LoginForm from "./LoginForm";

describe("LoginForm", () => {
  beforeEach(() => {
    login.mockReset().mockResolvedValue(undefined);
  });

  it("signs in with the two fields", async () => {
    const onSuccess = vi.fn();
    render(<LoginForm onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ana@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(login).toHaveBeenCalledWith("ana@example.test", "pw");
  });

  it("names the blank fields in a notice and outlines them instead of signing in", () => {
    render(<LoginForm onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ana@example.test" } });

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Password");
    expect(screen.getByLabelText("Password")).toHaveClass(...FORM_INVALID_FIELD.split(" "));
    expect(screen.getByLabelText("Email")).not.toHaveClass(...FORM_INVALID_FIELD.split(" "));
    expect(login).not.toHaveBeenCalled();
  });
});
