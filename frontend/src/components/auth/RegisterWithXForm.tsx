"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { ContinueWithX } from "@/components/auth/ContinueWithX";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation } from "@/hooks/useMutation";
import { apiFetch } from "@/lib/api";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import {
  FORM_ERROR_BANNER_COMPACT,
  FORM_INPUT,
  FORM_LABEL_COMPACT,
} from "@/components/ui/form-styles";

/**
 * Register-with-X. The OAuth callback proved a handle with no Vidit profile and
 * redirected here with a signed handoff cookie. We read the verified handle
 * from /auth/x/pending (display only — the cookie is the authority), let the
 * analyst confirm a username (default = the handle, editable if taken), and
 * create an X-only account: no password, no email; login is always re-OAuth.
 */
export default function RegisterWithXForm() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [handle, setHandle] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [username, setUsername] = useState("");

  useEffect(() => {
    let active = true;
    apiFetch<{ handle: string }>("/auth/x/pending")
      .then((res) => {
        if (!active) return;
        setHandle(res.handle);
        setUsername(res.handle); // sensible default, editable below
      })
      .catch(() => {
        if (active) setExpired(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const submit = useMutation(
    () =>
      apiFetch("/auth/x/register", {
        method: "POST",
        body: JSON.stringify({ username: username.trim() }),
      }),
    {
      fallback: "Could not finish signing up with X.",
      onSuccess: () => {
        void refresh();
        router.push("/map");
      },
    }
  );

  if (expired) {
    return (
      <AuthCard title="X sign-in expired" subtitle="That verification timed out.">
        <p className="text-sm text-neutral-400">Start again to continue with X.</p>
        <ContinueWithX />
      </AuthCard>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submit.run();
  };

  return (
    <AuthCard
      title="Finish signing up"
      subtitle="Your X handle is verified — pick a username to create your account."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {submit.error && <div className={FORM_ERROR_BANNER_COMPACT}>{submit.error}</div>}

        <div>
          <span className={FORM_LABEL_COMPACT}>Verified X handle</span>
          <p className="mt-0.5 text-sm text-neutral-100">
            {handle ? `@${handle}` : "…"}
            {handle && (
              <span className="ml-1 text-green-400" aria-label="verified">
                ✓
              </span>
            )}
          </p>
        </div>

        <div>
          <label htmlFor="username" className={FORM_LABEL_COMPACT}>
            Username
          </label>
          <input
            id="username"
            type="text"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={FORM_INPUT}
          />
        </div>

        <button
          type="submit"
          disabled={submit.loading || !handle}
          className={`w-full py-2 disabled:opacity-50 rounded-md text-sm font-medium ${PRIMARY_BUTTON}`}
        >
          {submit.loading ? "Creating account..." : "Create account"}
        </button>
      </form>
    </AuthCard>
  );
}
