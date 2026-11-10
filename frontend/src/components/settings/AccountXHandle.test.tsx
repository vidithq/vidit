import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { XHandleState } from "@/lib/xHandle";

import { apiFetch } from "@/test/apiStub";

vi.mock("@/lib/api", () => import("@/test/apiStub"));

import { AccountXHandle } from "./AccountXHandle";

function serve(state: XHandleState) {
  apiFetch.mockReset().mockResolvedValue(state);
}

describe("AccountXHandle", () => {
  beforeEach(() => apiFetch.mockReset());

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
