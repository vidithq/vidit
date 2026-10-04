"use client";

import type { ComponentType } from "react";
import { Check, Globe } from "lucide-react";

import { displayLinkValue, resolveLinkHref, type PublicProfile } from "@/lib/users";
import type { ExternalLinks } from "@/types";
import { DiscordGlyph, GitHubGlyph, XGlyph } from "@/components/ui/BrandGlyphs";
import { Button, buttonClasses } from "@/components/ui/Button";
import { FIELD_TEXT } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_LABEL } from "@/components/ui/form-styles";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import type { ProfileEditState } from "./useProfileEdit";

/** The platforms a profile can link, in reading order: one source for the edit form and the view
 * buttons. Three of four take their mark from [`BrandGlyphs`](../ui/BrandGlyphs.tsx), which paint
 * `currentColor` and take no `className`, so callers wrap them. `action` is what the reader can
 * do: `link` opens the profile, `copy` hands the value over (a platform property: Discord
 * publishes no profile URL for a username). The hint is the shape the backend accepts, so a
 * suggested value is one that saves. */
const LINK_PLATFORMS: {
  key: keyof ExternalLinks;
  label: string;
  Icon: ComponentType<{ size?: number }>;
  hint: string;
  action: "link" | "copy";
}[] = [
  {
    key: "x",
    label: "X / Twitter",
    Icon: XGlyph,
    hint: "@handle or https://x.com/handle",
    action: "link",
  },
  { key: "discord", label: "Discord", Icon: DiscordGlyph, hint: "username", action: "copy" },
  {
    key: "website",
    label: "Website",
    Icon: Globe,
    hint: "https://your-site.com",
    action: "link",
  },
  {
    key: "github",
    label: "GitHub",
    Icon: GitHubGlyph,
    hint: "@handle or https://github.com/handle",
    action: "link",
  },
];

/** Edit-mode inputs, one per platform, under the bio field. Nothing in view mode: reading the links is the header action cluster. */
export function LinkedAccountsFields({ edit }: { edit: ProfileEditState }) {
  if (!edit.editing) return null;

  return (
    <Card>
      <SectionEyebrow title="Linked accounts" margin="none" />
      <div className="space-y-2">
        {LINK_PLATFORMS.map((p) => {
          const Icon = p.Icon;
          return (
            <div
              key={p.key}
              className="flex items-center gap-2 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md transition-colors focus-within:border-orange-500"
            >
              <span className="inline-flex shrink-0 text-neutral-500">
                <Icon size={14} />
              </span>
              <div className="flex-1 min-w-0">
                <label htmlFor={`link-${p.key}`} className={FORM_LABEL}>
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
                  className={`block w-full bg-transparent ${FIELD_TEXT} text-neutral-200 placeholder:text-neutral-600 focus:outline-hidden`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/**
 * Where to reach the analyst: one ghost icon button per linked platform, the brand mark alone, in
 * the header action cluster right of the handle (above the work, like the event page's share
 * controls). The account each mark reaches is in its `title` and accessible name
 * (`X / Twitter: @LoLManya`). The row is the site's one icon control, the owner's Edit profile
 * included.
 *
 * The name prints `displayLinkValue`, not the stored string, so an X value reads `@LoLManya`
 * whether stored as a URL or a bare handle.
 *
 * `action` decides what the mark does, never how it looks. `copy` is `<CopyHandle>` (Discord: no
 * profile URL exists, so copying the value is all a reader can do); `link` opens the profile in a
 * new tab.
 *
 * A `link` platform whose value `resolveLinkHref` refuses renders nothing: a mark that goes
 * nowhere is a dead control. The backend validates on the way in, so this is a stored value the
 * strict parse still refuses (a URL on a host the platform does not own, for one). A profile with
 * no reachable account renders nothing, which on someone else's profile leaves the Follow button
 * alone.
 *
 * A fragment, not a row: the header cluster owns the row, since the owner's Edit profile mark
 * belongs to it too.
 */
export function LinkedAccountsLine({ profile }: { profile: PublicProfile }) {
  return (
    <>
      {LINK_PLATFORMS.flatMap(({ key, label, Icon, action }) => {
        const value = profile.external_links[key]?.trim() ?? "";
        if (!value) return [];
        const shown = displayLinkValue(key, value);
        const name = `${label}: ${shown}`;

        if (action === "copy") {
          return [
            <CopyHandle key={key} Icon={Icon} label={label} shown={shown} value={value} />,
          ];
        }

        const href = resolveLinkHref(key, value);
        if (!href) return [];
        return [
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={name}
            title={name}
            className={buttonClasses("ghost", { icon: true })}
          >
            <Icon size={14} />
          </a>,
        ];
      })}
    </>
  );
}

/**
 * The account a reader can only take away: the brand mark, flipping to a check for the flash
 * window. The gesture and feedback are `useCopyToClipboard`, worn as `<CoordinateActions>` wears
 * it. The accessible name is static and names the handle, with the confirmation in a sibling live
 * region: a name that changes on click is re-announced as a new control. Only the tooltip and the
 * mark flip.
 */
function CopyHandle({
  Icon,
  label,
  shown,
  value,
}: {
  Icon: ComponentType<{ size?: number }>;
  /** The platform's name, for both the action name and the confirmation. */
  label: string;
  /** The handle as a reader reads it (`displayLinkValue`). */
  shown: string;
  /** What lands on the clipboard: the stored value. */
  value: string;
}) {
  const { copied, copy } = useCopyToClipboard();
  const name = `Copy ${label} username: ${shown}`;
  const copiedLabel = `${label} username copied`;

  return (
    <>
      <Button
        icon
        variant="ghost"
        onClick={() => void copy(value)}
        aria-label={name}
        title={copied ? copiedLabel : name}
      >
        {copied ? <Check size={14} /> : <Icon size={14} />}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? copiedLabel : ""}
      </span>
    </>
  );
}
