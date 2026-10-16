import { apiFetch } from "./api";
import type { components } from "./api-types";

export type XHandleState = components["schemas"]["XHandleRead"];
export type XHandleRequestBody = components["schemas"]["XHandleRequestCreate"];
export type AdminXHandleRequest = components["schemas"]["AdminXHandleRequestRead"];

/** Mirrors `schemas/x_handle_request.REASON_MAX_LENGTH`; change both. */
export const X_HANDLE_REASON_MAX_LEN = 500;

export const MY_X_HANDLE_PATH = "/users/me/x-handle";
export const X_HANDLE_REQUESTS_PATH = "/admin/x-handle-requests";

/** File a change request; it replaces the analyst's earlier one. */
export function requestXHandleChange(body: XHandleRequestBody): Promise<XHandleState> {
  return apiFetch<XHandleState>("/users/me/x-handle-request", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function approveXHandleRequest(id: string): Promise<void> {
  return apiFetch<void>(`${X_HANDLE_REQUESTS_PATH}/${id}/approve`, { method: "POST" });
}

export function declineXHandleRequest(id: string, reason: string): Promise<void> {
  return apiFetch<void>(`${X_HANDLE_REQUESTS_PATH}/${id}/decline`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}
