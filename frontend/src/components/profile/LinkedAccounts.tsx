"use client";

import type { ComponentType } from "react";
import { Check, Globe } from "lucide-react";

import { displayLinkValue, resolveLinkHref, type PublicProfile } from "@/lib/users";
import type { ExternalLinks } from "@/types";
import { DiscordGlyph, GitHubGlyph, XGlyph } from "@/components/ui/BrandGlyphs";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Glyph } from "@/components/ui/Glyph";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_LABEL } from "@/components/ui/form-styles";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import type { ProfileEditState } from "./useProfileEdit";

/** The platforms a profile can link, in reading order. One source for both the
 *  edit form and the view-mode buttons, so a platform added here shows up in
 *  both, under the same icon. Three of the four take their brand mark from
 *  [`BrandGlyphs`](../ui/BrandGlyphs.tsx), the marks the sidebar and the share
 *  row already use, so one platform reads the same everywhere. The glyphs paint
 *  `currentColor` and take no `className`, so a caller that wants a colour
 *  wraps them, which is what the fields below do.
 *
 *  `action` is what the reader can do with the account: `link` opens the
 *  profile, `copy` hands the value over. It is a property of the platform, not
 *  of the value, since Discord publishes no profile URL for a username at all.
 *  The hint is the shape the backend accepts, so a value the form suggests is
 *  one that saves. */
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
 * to find it. Marks rather than tiles printing the handles: four names the
 * analyst holds elsewhere, set beside the one name this page is about, take the
 * weight off the handle that titles the page. The account each button reaches
 * is in its `title` and its accessible name (`X / Twitter: @LoLManya`), which
 * is where a reader who wants the handle itself gets it: a bare mark says the
 * platform and nothing else.
 *
 * The name prints `displayLinkValue`, not the stored string, so an X value reads
 * `@LoLManya` whether it was stored as a profile URL or as a bare handle.
 *
 * The platform's `action` decides the control. `copy` is `<CopyHandle>`, the
 * brand mark over `useCopyToClipboard`, which is Discord: the platform
 * publishes no profile URL for a username, so handing it over is the one thing
 * a reader can do with it. `link` is an anchor carrying the button shape, the
 * pattern for a navigation control that looks like a button, opening in a new
 * tab.
 *
 * A `link` platform whose value `resolveLinkHref` refuses renders nothing: a
 * button that goes nowhere is a dead control. The backend validates these
 * values on the way in, so an unresolvable one cannot be stored, and what falls
 * here is a stored value the strict parse still refuses, a URL on a host the
 * platform does not own among them.
 *
 * A profile carrying no reachable account renders nothing at all.
 *
 * The row wraps inside itself, and the actions slot it sits in is already
 * capped at the header width, so four marks beside an edit button break onto a
 * second right-aligned line on a phone instead of widening the header.
 */
export function LinkedAccountsLine({ profile }: { profile: PublicProfile }) {
  const buttons = LINK_PLATFORMS.flatMap(({ key, label, Icon, action }) => {
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
        className={buttonClasses("ghost", { icon: true })}
        title={name}
        aria-label={name}
      >
        <Icon size={14} />
      </a>,
    ];
  });

  if (buttons.length === 0) return null;

  return <div className="flex flex-wrap items-center gap-1">{buttons}</div>;
}

/**
 * The account a reader can only take away: the brand mark, flipping to a check
 * for the flash window.
 *
 * The gesture and its feedback are `useCopyToClipboard`, the one home for the
 * clipboard write and the flash timer, worn here the way `<CoordinateActions>`
 * wears it: a `<Glyph>` mark rather than a boxed control. The resting mark
 * stays the platform's own, since this row is brand marks and a generic copy
 * mark would say less than the one it replaced; only the flash is fixed,
 * because what confirms a write reads the same everywhere.
 *
 * The accessible name is static and names the handle, and the confirmation
 * lands in a sibling live region: a name that changes on click is re-announced
 * as a new control. Only the tooltip and the mark flip.
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
      <Glyph
        icon={copied ? Check : Icon}
        label={name}
        title={copied ? copiedLabel : name}
        onClick={() => void copy(value)}
      />
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? copiedLabel : ""}
      </span>
    </>
  );
}
