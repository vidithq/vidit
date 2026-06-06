import { CSRF_HEADER, readCsrfToken } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL;
if (!API_URL) {
  throw new Error(
    "NEXT_PUBLIC_API_URL must be set at build time. " +
      "Set it in Vercel project settings (production/preview), " +
      ".env.local (local dev), or as a CI build env."
  );
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Error thrown by ``apiFetch`` for any non-2xx response. Carries the
 * HTTP status so callers can distinguish a real auth failure (401/403,
 * "you're logged out") from a transient one (network blip, 5xx,
 * uvicorn restart in dev). Without this, ``AuthContext`` was treating
 * every /auth/me error as "logged out" and bouncing the user to
 * ``/login`` on any backend hiccup.
 *
 * ``code`` is the stable identifier the backend attaches to errors
 * worth branching on (e.g. ``email_pending_confirmation`` →
 * resend-link flow instead of dead-end error). ``null`` for endpoints
 * whose backend returns a plain string ``detail`` — only the typed
 * registration errors emit a structured ``{code, message}`` shape
 * today.
 */
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

interface ParsedDetail {
  message: string;
  code: string | null;
}

// FastAPI returns several ``detail`` shapes depending on the error
// source: ``{detail: string}`` for hand-rolled HTTPException,
// ``{detail: [{loc, msg, type}, ...]}`` for Pydantic validation
// errors, and ``{detail: {code, message}}`` for the typed registration
// errors that the frontend wants to branch on without English-prose
// substring matching. Stringifying the array directly produces
// "[object Object]" in the UI; pull out the first ``msg`` instead so
// the user sees something useful.
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

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };

  // Only set Content-Type to JSON if body is not FormData
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

  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}
