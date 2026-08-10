import Link from "next/link";

import TrustBadge from "@/components/profile/TrustBadge";
import { Avatar } from "@/components/ui/Avatar";
import { TEXT_LINK } from "@/components/ui/styles";
import { cn } from "@/lib/cn";

/**
 * The "by @user + trust badge" assembly: profile link plus `TrustBadge`,
 * previously hand-built on the geolocation and request detail subtitles, the
 * map side panel header, and the detail body's Author row, with wrapper drift
 * between them. Text size and colour stay at the call site (a PageShell
 * subtitle already sets both); `size` scales the gap + badge for the dense
 * panel header; `avatar` leads with the author's profile picture where the
 * byline is the page's author signature (the detail-page slots).
 */
export function AuthorByline({
  author,
  prefix = true,
  size = "sm",
  avatar = false,
  className = "",
}: {
  author: {
    username: string;
    is_trusted: boolean;
    trust_reason?: string | null;
    avatar_url?: string | null;
  };
  /** Render the leading "by ". Off for slots whose label already says it
   *  (the detail body's Author row). */
  prefix?: boolean;
  /** `sm`: default; `xs`: the dense map-panel header (smaller badge + gap). */
  size?: "sm" | "xs";
  /** Lead with the author's avatar (initial fallback). Implies no "by "
   *  prefix: picture + handle already read as a signature. */
  avatar?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center",
        size === "xs" ? "gap-1" : "gap-1.5",
        className,
      )}
    >
      {avatar && (
        <Avatar
          src={author.avatar_url}
          username={author.username}
          size={size === "xs" ? "size-4 text-[9px]" : "size-5 text-[10px]"}
        />
      )}
      {prefix && !avatar && <>by </>}
      <Link href={`/profile/${author.username}`} className={TEXT_LINK}>
        {author.username}
      </Link>
      <TrustBadge
        isTrusted={author.is_trusted}
        trustReason={author.trust_reason}
        size={size === "xs" ? 12 : 14}
      />
    </span>
  );
}
