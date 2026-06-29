"use client";

import { AtSign, Code, ExternalLink, Globe, MessageCircle } from "lucide-react";

import { resolveLinkHref, type PublicProfile } from "@/lib/users";
import type { ExternalLinks } from "@/types";
import { TAPPABLE_HOVER } from "@/components/ui/styles";
import { FORM_LABEL } from "@/components/ui/form-styles";
import type { ProfileEditState } from "./useProfileEdit";

const LINK_PLATFORMS: {
  key: keyof ExternalLinks;
  label: string;
  Icon: typeof AtSign;
  hint: string;
}[] = [
  { key: "x", label: "X / Twitter", Icon: AtSign, hint: "@handle or https://x.com/handle" },
  { key: "discord", label: "Discord", Icon: MessageCircle, hint: "username" },
  { key: "website", label: "Website", Icon: Globe, hint: "https://your-site.com" },
  { key: "github", label: "GitHub", Icon: Code, hint: "@handle or https://github.com/handle" },
];

/** Linked-accounts card: one input per platform in edit mode; resolved
 *  links (or plain handles) in view mode; nothing when no links exist. */
export function LinkedAccountsCard({
  profile,
  edit,
}: {
  profile: PublicProfile;
  edit: ProfileEditState;
}) {
  if (edit.editing) {
    return (
      <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-3">
        <h2 className="text-sm font-medium text-neutral-300">
          Linked accounts
        </h2>
        <div className="space-y-2">
          {LINK_PLATFORMS.map((p) => {
            const Icon = p.Icon;
            return (
              <div
                key={p.key}
                className="flex items-center gap-2 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md transition-colors focus-within:border-orange-500"
              >
                <Icon size={14} className="text-neutral-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <label
                    htmlFor={`link-${p.key}`}
                    className="text-[10px] uppercase tracking-wider text-neutral-500"
                  >
                    {p.label}
                  </label>
                  <input
                    id={`link-${p.key}`}
                    type="text"
                    placeholder={p.hint}
                    value={edit.draftLinks[p.key] ?? ""}
                    onChange={(e) =>
                      edit.setDraftLinks((prev) => ({
                        ...prev,
                        [p.key]: e.target.value,
                      }))
                    }
                    className="block w-full bg-transparent text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-hidden"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const presentLinks = LINK_PLATFORMS.filter(
    (p) => Boolean(profile.external_links[p.key])
  );
  if (presentLinks.length === 0) return null;

  return (
    <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-3">
      <h2 className="text-sm font-medium text-neutral-300">
        Linked accounts
      </h2>
      <div className="space-y-2">
        {presentLinks.map((p) => {
          const value = profile.external_links[p.key] ?? "";
          const href = resolveLinkHref(p.key, value);
          // Orange only when `href` resolves (the value sniffs as an http
          // URL), per the "if it's orange, it's clickable" rule; plain handles
          // (e.g. a Discord username) stay neutral.
          const valueClass = href
            ? "text-sm text-orange-400 truncate"
            : "text-sm text-neutral-200 truncate";
          const inner = (
            <>
              <p.Icon size={14} className="text-neutral-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className={FORM_LABEL}>{p.label}</span>
                <p className={valueClass}>{value}</p>
              </div>
              {href && (
                <ExternalLink size={12} className="text-orange-400/70 shrink-0" />
              )}
            </>
          );
          return href ? (
            <a
              key={p.key}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-3 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md ${TAPPABLE_HOVER}`}
            >
              {inner}
            </a>
          ) : (
            <div
              key={p.key}
              className="flex items-center gap-3 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md"
            >
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
