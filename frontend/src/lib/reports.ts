import { apiFetch } from "./api";
import type { components } from "./api-types";

/** Report buckets, aliased from the generated spec so a backend rename fails `tsc`. */
export type ContentReportReason =
  components["schemas"]["ContentReportCreate"]["reason"];

/** One report as the admin queue reads it (`resolved_at === null` means open). */
export type ContentReport = components["schemas"]["ContentReportRead"];

/** Mirrors `schemas/report.DETAILS_MAX_LENGTH`; change both. */
export const REPORT_DETAILS_MAX_LEN = 2000;

/** One label per report bucket, shared by the report form and the admin queue. Keyed by the
 *  generated union so a new backend reason fails `tsc`. */
export const REPORT_REASON_LABELS: Record<ContentReportReason, string> = {
  illegal_content: "Illegal content",
  graphic_not_flagged: "Graphic content, not flagged",
  copyright: "Copyright",
  privacy: "Privacy",
  other: "Something else",
};

/** What a report is filed against. Mirrors the three report routes. */
export type ReportTargetKind = "event" | "collection" | "site";

const REPORT_ROUTE: Record<ReportTargetKind, string> = {
  event: "events",
  collection: "collections",
  site: "sites",
};

/** `POST /{kind}s/{id}/report`. Open to anyone: `apiFetch` omits the CSRF header with no
 *  session cookie. The backend caps it per IP. */
export function reportContent(
  kind: ReportTargetKind,
  id: string,
  body: components["schemas"]["ContentReportCreate"],
): Promise<ContentReport> {
  return apiFetch<ContentReport>(
    `/${REPORT_ROUTE[kind]}/${encodeURIComponent(id)}/report`,
    { method: "POST", body: JSON.stringify(body) },
  );
}
