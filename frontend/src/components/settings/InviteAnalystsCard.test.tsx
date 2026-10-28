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

import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";
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

  async function mintThroughTheForm(value: string) {
    fireEvent.change(await screen.findByLabelText("Invitee's X handle"), {
      target: { value },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mint invite code" }));
  }

  it("mints a code and flashes its row's copy button once the link is copied", async () => {
    mintNewHawk();
    render(<InviteAnalystsCard />);

    await mintThroughTheForm(" @new_hawk ");

    expect(
      await screen.findByRole("button", { name: "Copy the invite link for @new_hawk" }),
    ).toBeInTheDocument();
    expect(await screen.findAllByText("Link copied")).toHaveLength(2);
    expect(writeText).toHaveBeenCalledWith(MINTED.link);
    expect(screen.queryByText(/copied to your clipboard|Copy its link below/)).toBeNull();
    const post = api.apiFetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post![1].body)).toEqual({ x_handle: "@new_hawk" });
  });

  it("leaves the row's copy button at rest when the clipboard refuses the write", async () => {
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    mintNewHawk();
    render(<InviteAnalystsCard />);

    await mintThroughTheForm("new_hawk");

    expect(
      await screen.findByRole("button", { name: "Copy the invite link for @new_hawk" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.queryByText("Link copied")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("revokes an active code on the confirming second click", async () => {
    let revoked = false;
    api.apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        revoked = true;
        return Promise.resolve({ ...MINTED, status: "revoked" });
      }
      const fresh = revoked ? { ...MINTED, status: "revoked" as const } : MINTED;
      return Promise.resolve(list({ items: [fresh, USED] }));
    });
    render(<InviteAnalystsCard />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Revoke the invite code for @new_hawk" }),
    );
    expect(api.apiFetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm revoking the invite code for @new_hawk" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /invite code for @new_hawk/ })).toBeNull(),
    );
    const post = api.apiFetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post![0]).toBe("/users/me/invite-codes/c2/revoke");
  });

  it("shows a refused revoke in the error banner", async () => {
    api.apiFetch.mockImplementation((_path: string, init?: RequestInit) =>
      init?.method === "POST"
        ? Promise.reject(new Error("This invite code is exhausted, so it cannot be revoked."))
        : Promise.resolve(list({ items: [MINTED, USED] })),
    );
    render(<InviteAnalystsCard />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Revoke the invite code for @new_hawk" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm revoking the invite code for @new_hawk" }),
    );

    expect(await screen.findByText(/cannot be revoked/)).toBeInTheDocument();
  });

  it("offers neither copy nor revoke on a code that is no longer active", async () => {
    api.apiFetch.mockResolvedValue(list());
    render(<InviteAnalystsCard />);

    expect(await screen.findByText("@osint_hawk")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /@osint_hawk/ })).toBeNull();
  });

  it("announces the blank handle and does not mint", async () => {
    api.apiFetch.mockResolvedValue(list());
    render(<InviteAnalystsCard />);

    fireEvent.click(await screen.findByRole("button", { name: "Mint invite code" }));

    expect(screen.getByText(/^Fill in the required fields/)).toHaveTextContent("Invitee's X handle");
    expect(screen.getByLabelText("Invitee's X handle")).toHaveClass(...FORM_INVALID_FIELD.split(" "));
    expect(api.apiFetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("shows the quota refusal from the server", async () => {
    api.apiFetch.mockImplementation((_path: string, init?: RequestInit) =>
      init?.method === "POST"
        ? Promise.reject(new Error("The quota resets at 2026-10-19 00:00 UTC."))
        : Promise.resolve(list({ minted_today: 5 })),
    );
    render(<InviteAnalystsCard />);

    await mintThroughTheForm("new_hawk");

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
