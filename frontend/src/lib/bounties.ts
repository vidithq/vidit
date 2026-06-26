import { apiFetch } from "./api";
import type { MissingField } from "./geolocations";
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
  /** In-progress proof (Tiptap JSON), mirroring a geolocation's `proof`. */
  proof?: Record<string, unknown> | null;
  /** Optional, ISO YYYY-MM-DD — when the event happened. */
  event_date?: string;
  /** Optional, ISO YYYY-MM-DD — when the source posted the media. */
  source_date?: string;
  tag_ids?: string[];
  files: File[];
}

export function createBounty(input: CreateBountyInput): Promise<BountyDetail> {
  const formData = new FormData();
  formData.append("title", input.title);
  formData.append("source_url", input.source_url);
  if (input.proof) {
    formData.append("proof", JSON.stringify(input.proof));
  }
  if (input.event_date) {
    formData.append("event_date", input.event_date);
  }
  if (input.source_date) {
    formData.append("source_date", input.source_date);
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

/**
 * Every still-unmet required field for a bounty, as human labels for
 * `IncompleteFormNotice`. A bounty is an unfinished geolocation, so its floor is
 * a subset of the geolocation one (no coordinates, dates, proof, or tags) —
 * just enough to be actionable: a title, the source, and the footage. Mirrors
 * the server `POST /bounties` requirements.
 */
export function missingBountyFields(s: {
  title: string;
  sourceUrl: string;
  mediaCount: number;
}): MissingField[] {
  const missing: MissingField[] = [];
  if (!s.title.trim()) missing.push({ key: "title", label: "Title" });
  if (!s.sourceUrl.trim()) missing.push({ key: "source_url", label: "Source URL" });
  if (s.mediaCount === 0) missing.push({ key: "source_media", label: "Source media" });
  return missing;
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
