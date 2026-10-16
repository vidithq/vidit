import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  previewProductUpdate: vi.fn(),
  sendTestProductUpdate: vi.fn(),
  sendProductUpdate: vi.fn(),
}));
vi.mock("@/lib/productUpdates", () => ({ PRODUCT_UPDATES_PATH: "/admin/product-updates", ...api }));

const refetch = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: () => ({
    data: {
      items: [
        {
          id: "p1",
          label: "1.3.0",
          title: "Collections",
          link_url: null,
          created_at: "2026-09-01T00:00:00Z",
          recipient_count: 40,
          progress: { queued: 10, sending: 0, sent: 28, failed: 2, skipped: 0 },
        },
      ],
    },
    error: null,
    loading: false,
    refetch,
  }),
}));

import { ProductUpdatesPanel } from "./ProductUpdatesPanel";

const PREVIEW = {
  subject: "Vidit 1.4.0: Approvals",
  html: "<p>Approvals</p>",
  text: "Approvals",
  recipients: 75,
  daily_cap: 30,
  batch_size: 10,
  days: 3,
};

function compose() {
  fireEvent.change(screen.getByLabelText("Release"), { target: { value: "1.4.0" } });
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Approvals" } });
  fireEvent.change(screen.getByLabelText("Body"), { target: { value: "New." } });
}

describe("ProductUpdatesPanel", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    refetch.mockReset();
    api.previewProductUpdate.mockResolvedValue(PREVIEW);
    api.sendTestProductUpdate.mockResolvedValue(undefined);
    api.sendProductUpdate.mockResolvedValue({
      ...PREVIEW,
      id: "p2",
      label: "1.4.0",
      title: "Approvals",
      link_url: null,
      created_at: "2026-10-15T00:00:00Z",
      recipient_count: 75,
      progress: { queued: 75, sending: 0, sent: 0, failed: 0, skipped: 0 },
    });
  });

  it("shows each sent release with its delivery progress", () => {
    render(<ProductUpdatesPanel />);
    expect(screen.getByText("28 of 40 sent · 10 waiting · 0 skipped")).toBeInTheDocument();
    expect(screen.getByText("2 failed")).toBeInTheDocument();
  });

  it("sends only after a preview that states the audience and the pace", async () => {
    render(<ProductUpdatesPanel />);
    compose();
    expect(screen.queryByRole("button", { name: /Send to/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Send a test to me" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(
      await screen.findByText("75 analysts opted in. At 30 a day, 10 per worker pass, the send takes 3 days."),
    ).toBeInTheDocument();
    expect(screen.getByTitle("Email preview")).toHaveAttribute("srcdoc", "<p>Approvals</p>");

    fireEvent.click(screen.getByRole("button", { name: "Send a test to me" }));
    expect(await screen.findByText("Test email sent to your address.")).toBeInTheDocument();
    expect(api.sendTestProductUpdate).toHaveBeenCalledWith({
      label: "1.4.0",
      title: "Approvals",
      body: "New.",
      link_url: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "Send to 75 analysts" }));
    expect(api.sendProductUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText("Release 1.4.0 queued for 75 analysts.")).toBeInTheDocument();
    expect(refetch).toHaveBeenCalled();
  });

  it("drops the preview when the draft changes", async () => {
    render(<ProductUpdatesPanel />);
    compose();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByTitle("Email preview");

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Approvals, again" } });

    await waitFor(() => expect(screen.queryByTitle("Email preview")).toBeNull());
  });
});
