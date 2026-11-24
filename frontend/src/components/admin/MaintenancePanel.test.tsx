import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/test/apiStub";
vi.mock("@/lib/api", () => import("@/test/apiStub"));

import { MaintenancePanel } from "./MaintenancePanel";

describe("<MaintenancePanel>", () => {
  it("runs a reaper on one click and lists the counts it returns", async () => {
    apiFetch.mockResolvedValue({ expired: 12, old_consumed: 3 });
    render(<MaintenancePanel />);

    fireEvent.click(screen.getByRole("button", { name: "Reap reset tokens" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/admin/maintenance/reap-password-reset-tokens", {
        method: "POST",
      }),
    );
    expect(await screen.findByText("Expired reset tokens dropped: 12")).toBeInTheDocument();
    expect(screen.getByText("Old used reset tokens dropped: 3")).toBeInTheDocument();
    expect(screen.queryByText(/Analysts emailed/)).toBeNull();
  });

  it("sends the completion digests only on the second click of its in-place confirm", async () => {
    apiFetch.mockResolvedValue({
      analysts_notified: 4,
      detections_pending: 137,
      digest_send_failures: 0,
    });
    render(<MaintenancePanel />);

    fireEvent.click(screen.getByRole("button", { name: "Send completion digests" }));
    expect(apiFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm send completion digests" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/admin/maintenance/send-completion-digests", {
        method: "POST",
      }),
    );
    expect(await screen.findByText("Analysts emailed: 4")).toBeInTheDocument();
    expect(screen.getByText("Failed sends: 0")).toBeInTheDocument();
  });
});
