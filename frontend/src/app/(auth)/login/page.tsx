"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LoginForm from "@/components/auth/LoginForm";
import { useRedirectIfAuthenticated } from "@/hooks/useRedirectIfAuthenticated";

/**
 * Sanitise the `?next=` query param before honouring it as a
 * post-login redirect target.
 *
 * The WHATWG URL parser is the source of truth: parse the raw value
 * against `window.location.origin`, and only honour the result if
 * its `origin` didn't escape. Character-position checks on the raw
 * string are not enough — the URL parser performs transformations
 * that flip a syntactically-relative path into a cross-origin URL:
 *
 * - `https://evil.com/x` — absolute URL, obvious.
 * - `//evil.com/x` — scheme-relative; `new URL('//evil.com', base)`
 *   resolves to `https://evil.com`.
 * - `/\evil.com` — in HTTP-special schemes, the parser normalises
 *   `\` → `/`, so this becomes `//evil.com` and resolves to
 *   `evil.com`. A previous version of this function rejected the
 *   literal backslash at position 1.
 * - `/\tevil.com` (encoded `%2F%09evil.com`) — the parser strips
 *   TAB, LF, CR from URL inputs before parsing, so the value
 *   becomes `/evil.com` which is a benign same-origin path; but
 *   `/\t/evil.com` strips the tab and lands at `//evil.com`. A
 *   character-position check can't see past the stripping; the
 *   origin equality check after parsing does.
 * - `javascript:alert(1)` — special scheme; the URL's `origin` is
 *   `null`, which trivially fails the origin equality check.
 *
 * Returns `pathname + search + hash` (origin stripped) on success
 * so `router.push` treats it as same-origin navigation.
 *
 * SSR safety: `useSearchParams()` returns null during prerender, so
 * `raw` is always null on the server pass and the function returns
 * `/map` before touching `window`. The `typeof window` guard is
 * defence-in-depth.
 */
function safeNext(raw: string | null): string {
  if (!raw) return "/map";
  if (!raw.startsWith("/")) return "/map";
  if (typeof window === "undefined") return "/map";
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return "/map";
  }
  if (url.origin !== window.location.origin) return "/map";
  return url.pathname + url.search + url.hash;
}

function LoginPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  // Already signed in (e.g. landed here by typing the URL or an old
  // bookmark)? Bounce to the app instead of showing a login form.
  // Render nothing while AuthContext is still resolving /auth/me —
  // otherwise a signed-in visitor sees an empty form flash for
  // 50–200ms before the redirect fires, which reads as "session
  // expired" and can prompt them to retype credentials.
  const { user, loading } = useRedirectIfAuthenticated(next);
  if (loading || user) return null;
  return <LoginForm onSuccess={() => router.push(next)} />;
}

export default function LoginPage() {
  // LoginForm calls useSearchParams() to surface the post-reset toast,
  // which forces a Suspense boundary in Next 14+. Tiny wrapper.
  return (
    <Suspense
      fallback={<span className="text-neutral-500 text-sm">Loading…</span>}
    >
      <LoginPageInner />
    </Suspense>
  );
}
