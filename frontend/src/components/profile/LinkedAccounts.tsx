"use client";

import type { ComponentType } from "react";
import { Globe } from "lucide-react";

import { displayLinkValue, resolveLinkHref, type PublicProfile } from "@/lib/users";
import type { ExternalLinks } from "@/types";
import { DiscordGlyph, GitHubGlyph, XGlyph } from "@/components/ui/BrandGlyphs";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_LABEL } from "@/components/ui/form-styles";
import type { ProfileEditState } from "./useProfileEdit";

/** The platforms a profile can link, in reading order. One source for both the
 *  edit form and the view-mode buttons, so a platform added here shows up in
 *  both, under the same icon. Three of the four take their brand mark from
 *  [`BrandGlyphs`](../ui/BrandGlyphs.tsx), the marks the sidebar and the share
 *  row already use, so one platform reads the same everywhere. The glyphs paint
 *  `currentColor` and take no `className`, so a caller that wants a colour
 *  wraps them, which is what the fields below do. */
const LINK_PLATFORMS: {
  key: keyof ExternalLinks;
  label: string;
  Icon: ComponentType<{ size?: number }>;
  hint: string;
}[] = [
  { key: "x", label: "X / Twitter", Icon: XGlyph, hint: "@handle or https://x.com/handle" },
  { key: "discord", label: "Discord", Icon: DiscordGlyph, hint: "username" },
  { key: "website", label: "Website", Icon: Globe, hint: "https://your-site.com" },
  { key: "github", label: "GitHub", Icon: GitHubGlyph, hint: "@handle or https://github.com/handle" },
];

/** Edit-mode inputs, one per platform, sitting under the bio field so every
 *  editable field is contiguous. Nothing in view mode: reading the links is the
 *  header action cluster, not a section. */
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
                  className="block w-full bg-transparent text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-hidden"
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
 * Where to reach the analyst, as a row of square ghost icon buttons: one button
 * per platform the profile carries, the brand mark alone.
 *
 * It reads in the header action cluster, right of the handle, the same place
 * the event page keeps its share controls, so reaching the analyst is an action
 * on the page rather than a line of the identity. That also puts it above the
 * work: a visitor who wants the analyst's X account does not scroll a portfolio
 * to find it. Icons rather than tiles, because the handles are the analyst's
 * names on other platforms and printing four of them next to the one name this
 * page is about buries the handle that titles it. The account each button
 * reaches is in its `title` and its accessible name (`X / Twitter: @LoLManya`),
 * which is where a reader who wants the handle itself gets it: a bare mark says
 * the platform and nothing else.
 *
 * The name prints `displayLinkValue`, not the stored string, so an X value reads
 * `@LoLManya` whether it was stored as a profile URL or as a bare handle.
 *
 * A value `resolveLinkHref` resolves is an `<a>` wearing the button shape, the
 * sanctioned pattern for a navigation control that looks like a button, opening
 * in a new tab. Discord resolves to no URL and gets a `<CopyButton>` carrying
 * the brand mark instead: handing over the username is the one thing a reader
 * can do with it. Any other unresolved value (a website that is not a URL, a
 * handle whose shape is invalid) renders nothing, since a button that neither
 * goes anywhere nor copies anything is a dead control.
 *
 * A profile carrying no reachable account renders nothing at all.
 *
 * The row wraps inside itself, and the actions slot it sits in is already
 * capped at the header width, so four marks beside an edit button break onto a
 * second right-aligned line on a phone instead of widening the header.
 */
export function LinkedAccountsLine({ profile }: { profile: PublicProfile }) {
  const buttons = LINK_PLATFORMS.flatMap(({ key, label, Icon }) => {
    const value = profile.external_links[key]?.trim() ?? "";
    if (!value) return [];
    const shown = displayLinkValue(key, value);
    const name = `${label}: ${shown}`;
    const href = resolveLinkHref(key, value);

    if (href) {
      return [
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClasses("ghost", { icon: true })}
          title={name}
          aria-label={name}
        >
          <Icon size={15} />
        </a>,
      ];
    }
    if (key === "discord") {
      return [
        <CopyButton
          key={key}
          icon={Icon}
          value={() => value}
          label={`Copy ${label} username: ${shown}`}
          copiedLabel={`${label} username copied`}
        />,
      ];
    }
    return [];
  });

  if (buttons.length === 0) return null;

  return <div className="flex flex-wrap items-center gap-1">{buttons}</div>;
}
