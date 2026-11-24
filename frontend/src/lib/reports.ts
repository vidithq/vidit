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

type ContentReportCreate = components["schemas"]["ContentReportCreate"];

/** What a report is filed against. */
export type ReportTargetKind = ContentReportCreate["kind"];

/** `POST /reports`. Open to anyone: `apiFetch` omits the CSRF header with no session cookie.
 *  The backend caps it per IP. */
export function reportContent(
  kind: ReportTargetKind,
  id: string,
  body: Omit<ContentReportCreate, "kind" | "target_id">,
): Promise<ContentReport> {
  return apiFetch<ContentReport>("/reports", {
    method: "POST",
    body: JSON.stringify({ kind, target_id: id, ...body }),
  });
}
