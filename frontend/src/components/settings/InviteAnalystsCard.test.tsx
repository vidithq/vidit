import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SponsoredInviteCode, SponsoredInviteCodeList } from "@/lib/inviteCodes";

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  ApiError: class extends Error {},
  errorMessage: (err: unknown, fallback = "Something went wrong.") =>
    err instanceof Error ? err.message : fallback,
}));

import { InviteAnalystsCard } from "./InviteAnalystsCard";

const USED: SponsoredInviteCode = {
  id: "c1",
  code: "used-code",
  link: "https://vidit.app/register?code=used-code",
  x_handle: "osint_hawk",
  status: "exhausted",
  created_at: "2026-10-17T10:00:00Z",
  used_at: "2026-10-17T12:00:00Z",
};

const MINTED: SponsoredInviteCode = {
  id: "c2",
  code: "new-code",
  link: "https://vidit.app/register?code=new-code",
  x_handle: "new_hawk",
  status: "active",
  created_at: "2026-10-18T09:00:00Z",
  used_at: null,
};

function list(overrides: Partial<SponsoredInviteCodeList> = {}): SponsoredInviteCodeList {
  return {
    items: [USED],
    minting_enabled: true,
    daily_limit: 5,
    minted_today: 1,
    resets_at: "2026-10-19T00:00:00Z",
    ...overrides,
  };
}

describe("InviteAnalystsCard", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    api.apiFetch.mockReset();
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  it("lists your codes with their handle and status", async () => {
    api.apiFetch.mockResolvedValue(list());
    render(<InviteAnalystsCard />);

    expect(await screen.findByText("@osint_hawk")).toBeInTheDocument();
    expect(screen.getByText("used")).toBeInTheDocument();
    expect(screen.getByText(/4 of 5 left today/)).toBeInTheDocument();
  });

  function mintNewHawk() {
    let minted = false;
    api.apiFetch.mockImplementation((_path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        minted = true;
        return Promise.resolve(MINTED);
      }
      return Promise.resolve(list(minted ? { items: [MINTED, USED], minted_today: 2 } : {}));
    });
  }

  it("mints a code and copies its link to the clipboard", async () => {
    mintNewHawk();
    render(<InviteAnalystsCard />);

    fireEvent.change(await screen.findByLabelText("Invitee's X handle"), {
      target: { value: " @new_hawk " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mint invite code" }));

    expect(
      await screen.findByText("Invite link for @new_hawk copied to your clipboard."),
    ).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(MINTED.link);
    expect(
      await screen.findByRole("button", { name: "Copy the invite link for @new_hawk" }),
    ).toBeInTheDocument();
    const post = api.apiFetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post![1].body)).toEqual({ x_handle: "@new_hawk" });
  });

  it("points to the row's copy button when the clipboard refuses the write", async () => {
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    mintNewHawk();
    render(<InviteAnalystsCard />);

    fireEvent.change(await screen.findByLabelText("Invitee's X handle"), {
      target: { value: "new_hawk" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mint invite code" }));

    expect(
      await screen.findByText("Invite code for @new_hawk minted. Copy its link below."),
    ).toBeInTheDocument();
  });

  it("shows the quota refusal from the server", async () => {
    api.apiFetch.mockImplementation((_path: string, init?: RequestInit) =>
      init?.method === "POST"
        ? Promise.reject(new Error("The quota resets at 2026-10-19 00:00 UTC."))
        : Promise.resolve(list({ minted_today: 5 })),
    );
    render(<InviteAnalystsCard />);

    fireEvent.change(await screen.findByLabelText("Invitee's X handle"), {
      target: { value: "new_hawk" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mint invite code" }));

    await waitFor(() =>
      expect(screen.getByText(/quota resets at 2026-10-19/)).toBeInTheDocument(),
    );
  });

  it("hides the mint control when an admin turned minting off", async () => {
    api.apiFetch.mockResolvedValue(list({ minting_enabled: false }));
    render(<InviteAnalystsCard />);

    expect(await screen.findByText("@osint_hawk")).toBeInTheDocument();
    expect(screen.queryByLabelText("Invitee's X handle")).toBeNull();
    expect(screen.queryByRole("button", { name: "Mint invite code" })).toBeNull();
  });
});
