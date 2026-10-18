import { apiFetch } from "./api";
import type { components } from "./api-types";

export type InviteCodeStatus = components["schemas"]["AdminInviteCodeRead"]["status"];

/** One code you minted from Settings; `link` is the register URL with the code prefilled. */
export type SponsoredInviteCode = components["schemas"]["SponsoredInviteCodeRead"];

/** Your minted codes, newest first, with the daily quota and the admin switch. */
export type SponsoredInviteCodeList = components["schemas"]["SponsoredInviteCodeList"];

export const MY_INVITE_CODES_PATH = "/users/me/invite-codes";

/** Mint a single-use code bound to the invitee's X handle. Refused with `invite_quota_exceeded`
 *  past the daily quota and `invite_minting_disabled` when an admin turned minting off. */
export function mintInviteCode(xHandle: string): Promise<SponsoredInviteCode> {
  return apiFetch<SponsoredInviteCode>(MY_INVITE_CODES_PATH, {
    method: "POST",
    body: JSON.stringify({ x_handle: xHandle }),
  });
}

/** Revoke an active code you minted. Refused with `invite_code_not_active` once it is used or
 *  revoked; another sponsor's code answers `invite_code_not_found`. */
export function revokeInviteCode(id: string): Promise<SponsoredInviteCode> {
  return apiFetch<SponsoredInviteCode>(`${MY_INVITE_CODES_PATH}/${id}/revoke`, {
    method: "POST",
  });
}
