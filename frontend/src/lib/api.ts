import { CSRF_HEADER, readCsrfToken } from "./auth";
import { nextCursor } from "./pagination";

const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL;
if (!configuredApiUrl) {
  throw new Error(
    "NEXT_PUBLIC_API_URL must be set at build time. " +
      "Set it in Vercel project settings (production/preview), " +
      ".env.local (local dev), or as a CI build env."
  );
}

/** Backend base URL including `/api/v1`; shared with the server-side readers (share cards)
 * so the env guard lives once. */
export const API_URL: string = configuredApiUrl;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Thrown by `apiFetch` for any non-2xx. `status` separates a real auth failure (401/403)
 * from a transient one (5xx, network), so a backend hiccup doesn't bounce to `/login`.
 * `code` is the backend's stable identifier for errors worth branching on (e.g.
 * `email_pending_confirmation`); `null` for plain string `detail`s. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** User-facing message from an unknown thrown value; non-Error throws use `fallback`. Pair
 * with `useMutation`. */
export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  return err instanceof Error ? err.message : fallback;
}

interface ParsedDetail {
  message: string;
  code: string | null;
}

// FastAPI `detail` shapes: a string (HTTPException), `[{loc, msg, type}]` (Pydantic; take the
// first `msg`, since stringifying yields "[object Object]"), and `{code, message}` (typed
// errors the frontend branches on).
function parseApiError(body: unknown, status: number): ParsedDetail {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") {
      return { message: detail, code: null };
    }
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (first && typeof first === "object" && "msg" in first) {
        return { message: String((first as { msg: unknown }).msg), code: null };
      }
    }
    if (detail && typeof detail === "object" && "code" in detail && "message" in detail) {
      const obj = detail as { code: unknown; message: unknown };
      return {
        message: typeof obj.message === "string" ? obj.message : `API error ${status}`,
        code: typeof obj.code === "string" ? obj.code : null,
      };
    }
  }
  return { message: `API error ${status}`, code: null };
}

/** The one request path: CSRF on unsafe methods, credentials, and the error envelope as an
 * `ApiError`. Returns the raw `Response` so `apiFetchPage` can read `Link`. */
async function send(path: string, options?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };

  if (!(options?.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const method = (options?.method ?? "GET").toUpperCase();
  if (!SAFE_METHODS.has(method)) {
    const csrf = readCsrfToken();
    if (csrf) {
      headers[CSRF_HEADER] = csrf;
    }
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const parsed = parseApiError(body, res.status);
    throw new ApiError(parsed.message, res.status, parsed.code);
  }
  return res;
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await send(path, options);

  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

/** One page of a capped list plus the cursor for the next (`Link: rel="next"`); `null` on
 * the last page. */
export async function apiFetchPage<T>(
  path: string,
  options?: RequestInit
): Promise<{ items: T; nextCursor: string | null }> {
  const res = await send(path, options);
  return {
    // Same 204 guard as `apiFetch`.
    items: (res.status === 204 ? undefined : await res.json()) as T,
    nextCursor: nextCursor(res.headers.get("Link")),
  };
}
