import { X_OAUTH_ENABLED, X_OAUTH_START_URL } from "@/lib/xOauth";

/**
 * "Continue with X" entry point on the login + register cards. `label` is the
 * text before the logo ("Continue with" / "Sign up with") — the X is rendered
 * as the brand mark, not the letter. A full-page navigation to the backend's
 * /auth/x/start — NOT an `apiFetch`, because OAuth is a browser redirect dance,
 * not an XHR. Renders nothing when the feature is unconfigured, so the button
 * can't dangle in front of a 503.
 */
export function ContinueWithX({ label = "Continue with" }: { label?: string }) {
  if (!X_OAUTH_ENABLED) return null;
  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-neutral-600">
        <span className="h-px flex-1 bg-neutral-800" />
        or
        <span className="h-px flex-1 bg-neutral-800" />
      </div>
      <a
        href={X_OAUTH_START_URL}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 py-2 text-sm font-medium text-neutral-100 transition-colors hover:border-neutral-500 hover:bg-neutral-800"
      >
        <span>{label}</span>
        <svg viewBox="0 0 24 24" role="img" aria-label="X" className="h-3.5 w-3.5 fill-current">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </a>
    </div>
  );
}
