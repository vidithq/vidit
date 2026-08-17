import type { ReactNode } from "react";
import { Bot, ImageIcon, Play } from "lucide-react";

// A fake X post, rendered in X's own dark card so a guide can show the shape of
// a real post instead of describing it. Used by the two import guides (`/bot`
// teaches what to write, `/archive` shows what an exported thread looked like);
// the composition mirrors the promo video's BotBeat
// (video/src/components/BotBeat.tsx). The analyst is a placeholder identity,
// never a real account.
//
// Illustration only: nothing here is interactive, and the "links" are coloured
// spans (<MockPostLink>), not anchors, since they point at posts that do not
// exist.

/** The one fake analyst the guides attribute their examples to, so a reader
 *  moving between them reads one person's posts rather than three accounts. */
export const MOCK_ANALYST = {
  name: "an analyst",
  handle: "@an_analyst",
  avatar: "bg-gradient-to-br from-orange-500 to-red-600",
} as const;

/** The bot's own identity, for the reply a guide shows it posting. */
export const MOCK_BOT = {
  name: "Vidit",
  handle: "@viditbot",
  avatar: "bg-gradient-to-br from-orange-500 to-amber-500",
  bot: true,
} as const;

/** X's anchor colour for a "link" inside a mock body. Display only. */
export function MockPostLink({ children }: { children: ReactNode }) {
  return <span className="text-sky-500">{children}</span>;
}

/** The grey box standing in for an attached photo or video. */
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
  /** Avatar paint (a gradient class). The initial rides on top of it. */
  avatar: string;
  /** Render the bot glyph instead of the name's initial. */
  bot?: boolean;
  /** Handle this post answers, shown in the byline. */
  replyingTo?: string;
  /** One attachment placeholder under the body. */
  media?: { kind: "video" | "image"; label: string };
  /** The quote card X renders when the post quotes another post. */
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
          {/* Wraps rather than truncates: "@handle · replying to @handle" is
              longer than a narrow mock is wide, and an ellipsis there reads as
              a broken byline. The name above it still truncates. */}
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
      {/* `overflow-wrap:anywhere` for the same reason the proof body carries it:
          a mock link is one unbreakable token, and a long one sets the column's
          min-content width, which pushed the guide's two-column case grid a few
          pixels past its track on a phone. */}
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
