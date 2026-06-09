import { apiFetch } from "./api";
import type { BountyDetail, BountyListItem, BountyStatus } from "@/types";

export interface BountyListParams {
  status?: BountyStatus;
  tag?: string;
  author?: string;
  limit?: number;
}

export function bountyListPath(params: BountyListParams = {}): string {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.tag) search.set("tag", params.tag);
  if (params.author) search.set("author", params.author);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  const qs = search.toString();
  return `/bounties${qs ? `?${qs}` : ""}`;
}

export function getBounty(id: string): Promise<BountyDetail> {
  return apiFetch<BountyDetail>(`/bounties/${id}`);
}

export interface CreateBountyInput {
  title: string;
  source_url: string;
  description?: Record<string, unknown> | null;
  tag_ids?: string[];
  files: File[];
}

export function createBounty(input: CreateBountyInput): Promise<BountyDetail> {
  const formData = new FormData();
  formData.append("title", input.title);
  formData.append("source_url", input.source_url);
  if (input.description) {
    formData.append("description", JSON.stringify(input.description));
  }
  if (input.tag_ids && input.tag_ids.length > 0) {
    formData.append("tag_ids", JSON.stringify(input.tag_ids));
  }
  for (const file of input.files) {
    formData.append("files", file);
  }
  return apiFetch<BountyDetail>("/bounties", {
    method: "POST",
    body: formData,
  });
}

export function deleteBounty(id: string): Promise<void> {
  return apiFetch<void>(`/bounties/${id}`, { method: "DELETE" });
}

/** Caller joins the "I'm working on this" set. Idempotent — re-claiming
 *  is a 204 no-op, not an error. */
export function claimBounty(id: string): Promise<void> {
  return apiFetch<void>(`/bounties/${id}/claim`, { method: "POST" });
}

/** Caller leaves the working set. No-op if caller wasn't a claimer. */
export function unclaimBounty(id: string): Promise<void> {
  return apiFetch<void>(`/bounties/${id}/claim`, { method: "DELETE" });
}

/** Author withdraws the bounty without anyone geolocating it. */
export function closeBounty(id: string): Promise<BountyDetail> {
  return apiFetch<BountyDetail>(`/bounties/${id}/close`, { method: "POST" });
}
