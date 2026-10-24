import { apiFetch } from "./api";
import type { components } from "./api-types";
import type { InviteAnswer } from "./geolocatorCredit";
import type { AuthorRef, ExternalLinks } from "@/types";
import { countLabel } from "./format";

/** `GET /organizations/{slug}`, with `external_links` kept as the narrow per-platform shape. */
export type Organization = Omit<
  components["schemas"]["OrganizationRead"],
  "external_links"
> & { external_links: ExternalLinks };
export type OrganizationMember = components["schemas"]["OrganizationMemberRead"];
export type OrganizationInvite = components["schemas"]["OrganizationInviteRead"];
export type OrganizationMembership = components["schemas"]["OrganizationMembershipRead"];
export type OrganizationRole = OrganizationMember["role"];
export type OrganizationCreate = components["schemas"]["OrganizationCreate"];
export type OrganizationUpdate = components["schemas"]["OrganizationUpdate"];
export type InviteCandidate = AuthorRef;
export type AdminOrganization = components["schemas"]["AdminOrganizationRead"];
export type OrganizationRef = components["schemas"]["OrganizationRef"];

export const ADMIN_ORGANIZATIONS_PATH = "/admin/organizations";

export const ROLE_LABEL: Record<OrganizationRole, string> = {
  manager: "Org manager",
  member: "Member",
};

/** One organization: the page route and the API path share this shape. */
export function organizationPath(slug: string): string {
  return `/organizations/${encodeURIComponent(slug)}`;
}

export function memberCountLabel(count: number): string {
  return countLabel(count, "member");
}

/** An organization as an `AuthorByline` name: its picture, its name, and a link to its page. */
export function organizationByline(org: OrganizationRef) {
  return { username: org.name, avatar_url: org.avatar_url, href: organizationPath(org.slug) };
}

export function userOrganizationsPath(username: string): string {
  return `/users/${encodeURIComponent(username)}/organizations`;
}

export function createOrganization(body: OrganizationCreate): Promise<Organization> {
  return apiFetch<Organization>(ADMIN_ORGANIZATIONS_PATH, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateOrganization(
  slug: string,
  body: OrganizationUpdate,
): Promise<Organization> {
  return apiFetch<Organization>(organizationPath(slug), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function uploadOrganizationAvatar(slug: string, file: File): Promise<Organization> {
  const body = new FormData();
  body.append("file", file);
  return apiFetch<Organization>(`${organizationPath(slug)}/avatar`, { method: "PUT", body });
}

export function deleteOrganizationAvatar(slug: string): Promise<Organization> {
  return apiFetch<Organization>(`${organizationPath(slug)}/avatar`, { method: "DELETE" });
}

export function inviteToOrganization(
  slug: string,
  username: string,
): Promise<OrganizationInvite> {
  return apiFetch<OrganizationInvite>(`${organizationPath(slug)}/invites`, {
    method: "POST",
    body: JSON.stringify({ username }),
  });
}

export function cancelOrganizationInvite(slug: string, username: string): Promise<void> {
  return apiFetch<void>(`${organizationPath(slug)}/invites/${encodeURIComponent(username)}`, {
    method: "DELETE",
  });
}

/** Answer your own pending invite. */
export function answerOrganizationInvite(
  slug: string,
  answer: InviteAnswer,
): Promise<void> {
  return apiFetch<void>(`${organizationPath(slug)}/invite/${answer}`, { method: "POST" });
}

export function setOrganizationRole(
  slug: string,
  username: string,
  role: OrganizationRole,
): Promise<OrganizationMember> {
  return apiFetch<OrganizationMember>(
    `${organizationPath(slug)}/members/${encodeURIComponent(username)}`,
    { method: "PATCH", body: JSON.stringify({ role }) },
  );
}

/** Remove a member, or leave when `username` is your own. */
export function removeOrganizationMember(slug: string, username: string): Promise<void> {
  return apiFetch<void>(
    `${organizationPath(slug)}/members/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
}

/** A site admin deletes the organization with everything in its name. */
export function deleteOrganization(slug: string): Promise<void> {
  return apiFetch<void>(`${ADMIN_ORGANIZATIONS_PATH}/${encodeURIComponent(slug)}`, {
    method: "DELETE",
  });
}

/** A site admin makes the live analyst `username` an org manager of the organization, joining it
 *  if needed: the way back for an organization left without one. */
export function appointOrganizationManager(slug: string, username: string): Promise<OrganizationMember> {
  return apiFetch<OrganizationMember>(
    `${ADMIN_ORGANIZATIONS_PATH}/${encodeURIComponent(slug)}/managers`,
    { method: "POST", body: JSON.stringify({ username }) },
  );
}
