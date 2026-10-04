import type { ReactNode } from "react";
import { Bot, ImageIcon, Play } from "lucide-react";

// A fake X post in X's dark card, so a guide can show a post's shape. Used by the
// import guide (`/import`); the composition mirrors the promo video's BotBeat
// (video/src/components/BotBeat.tsx). The analyst is a placeholder identity.
//
// Illustration only: the "links" are coloured spans (<MockPostLink>), not
// anchors, since the posts do not exist.

/** The one fake analyst every guide attributes its examples to. */
export const MOCK_ANALYST = {
  name: "analyst",
  handle: "@analyst",
  avatar: "bg-gradient-to-br from-orange-500 to-red-600",
} as const;

export const MOCK_BOT = {
  name: "Vidit",
  handle: "@viditbot",
  avatar: "bg-gradient-to-br from-orange-500 to-amber-500",
  bot: true,
} as const;

export function MockPostLink({ children }: { children: ReactNode }) {
  return <span className="text-sky-500">{children}</span>;
}

function Attachment({
  kind,
  label,
}: {
  kind: "video" | "image";
  label: string;
}) {
  return (
    <div className="flex aspect-video items-center justify-center rounded-xl border border-neutral-800 bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900">
      <span className="flex flex-col items-center gap-2 text-neutral-500">
        <span className="flex size-10 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900">
          {kind === "video" ? <Play size={16} /> : <ImageIcon size={16} />}
        </span>
        <span className="text-[11px]">{label}</span>
      </span>
    </div>
  );
}

export function MockPost({
  name,
  handle,
  avatar,
  bot = false,
  replyingTo,
  media,
  quoted,
  children,
}: {
  name: string;
  handle: string;
  /** A gradient class; the initial rides on top. */
  avatar: string;
  /** Render the bot glyph instead of the initial. */
  bot?: boolean;
  /** Handle this post answers, shown in the byline. */
  replyingTo?: string;
  media?: { kind: "video" | "image"; label: string };
  quoted?: {
    handle: string;
    text: string;
    media?: { kind: "video" | "image"; label: string };
  };
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-black p-4 text-left">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${avatar}`}
        >
          {bot ? <Bot size={20} /> : name.slice(0, 1)}
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[15px] font-bold text-neutral-100">
            {name}
          </p>
          {/* Wraps: an ellipsis on a long byline reads as broken. */}
          <p className="text-[13px] text-neutral-500">
            {handle}
            {replyingTo && (
              <>
                {" "}
                · replying to <MockPostLink>{replyingTo}</MockPostLink>
              </>
            )}
          </p>
        </div>
      </div>
      {/* `overflow-wrap:anywhere`, as on the proof body: a long mock link sets
          the column's min-content width and pushed the guide's case grid past
          its track on a phone. */}
      <div className="mt-2.5 whitespace-pre-line text-[14px] leading-[21px] text-neutral-100 [overflow-wrap:anywhere]">
        {children}
      </div>
      {quoted && (
        <div className="mt-3 rounded-xl border border-neutral-800 p-3">
          <p className="text-[13px] text-neutral-500">{quoted.handle}</p>
          <p className="mt-1 whitespace-pre-line text-[13px] leading-[19px] text-neutral-100">
            {quoted.text}
          </p>
          {quoted.media && (
            <div className="mt-2">
              <Attachment {...quoted.media} />
            </div>
          )}
        </div>
      )}
      {media && (
        <div className="mt-3">
          <Attachment {...media} />
        </div>
      )}
    </div>
  );
}
