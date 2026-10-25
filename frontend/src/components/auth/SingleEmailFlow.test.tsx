import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({
  apiFetch,
  errorMessage: (err: unknown, fallback = "Something went wrong.") =>
    err instanceof Error ? err.message : fallback,
}));

import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";
import { SingleEmailFlow } from "./SingleEmailFlow";

function renderFlow() {
  return render(
    <SingleEmailFlow
      endpoint="/auth/forgot-password"
      submitLabel="Send link"
      renderSent={(email) => <p>Sent to {email}</p>}
    />,
  );
}

describe("SingleEmailFlow", () => {
  beforeEach(() => {
    apiFetch.mockReset().mockResolvedValue(undefined);
  });

  it("posts the trimmed address and swaps in the sent view", async () => {
    renderFlow();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: " ana@example.test " } });
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));

    expect(await screen.findByText("Sent to ana@example.test")).toBeInTheDocument();
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ email: "ana@example.test" });
  });

  it("flags a blank address instead of posting", async () => {
    renderFlow();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));

    expect(screen.getByText(/^Fill in the required fields/)).toHaveTextContent("Email");
    expect(screen.getByLabelText("Email")).toHaveClass(...FORM_INVALID_FIELD.split(" "));
    await waitFor(() => expect(apiFetch).not.toHaveBeenCalled());
  });
});
