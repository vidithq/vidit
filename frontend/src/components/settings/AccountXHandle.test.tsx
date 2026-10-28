import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { XHandleState } from "@/lib/xHandle";

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  ApiError: class extends Error {},
  errorMessage: (err: unknown, fallback = "Something went wrong.") =>
    err instanceof Error ? err.message : fallback,
}));

import { AccountXHandle } from "./AccountXHandle";

function serve(state: XHandleState) {
  api.apiFetch.mockReset().mockResolvedValue(state);
}

describe("AccountXHandle", () => {
  beforeEach(() => api.apiFetch.mockReset());

  it("shows the bound handle read-only", async () => {
    serve({ x_handle: "osint_hawk" });
    render(<AccountXHandle />);

    expect(await screen.findByText("@osint_hawk")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    // The only button is the label's help.
    expect(screen.getByRole("button")).toHaveAccessibleName("What is the X handle for?");
  });

  it("says so when no handle is linked", async () => {
    serve({ x_handle: null });
    render(<AccountXHandle />);

    expect(await screen.findByText("No X handle linked")).toBeInTheDocument();
  });
});
