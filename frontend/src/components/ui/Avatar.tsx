import { User } from "lucide-react";

// User avatar circle: the avatar image, or a fallback (a neutral user icon, or
// the username initial). Shared by the profile header and the search user
// results, which hand-rolled the same circle. The clickable initial-avatar on
// the geolocation feed card is a different (link + hover) treatment, left as-is.
export function Avatar({
  src,
  username,
  size,
  fallback = "initial",
}: {
  src?: string | null;
  username: string;
  /** Sizing utility, e.g. `w-16 h-16` or `size-10`. */
  size: string;
  fallback?: "initial" | "icon";
}) {
  return (
    <div
      className={`${size} rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center overflow-hidden shrink-0`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`${username}'s avatar`}
          className="w-full h-full object-cover"
        />
      ) : fallback === "icon" ? (
        <User size={28} className="text-neutral-500" />
      ) : (
        <span className="text-neutral-300 font-medium">
          {username[0]?.toUpperCase() ?? "?"}
        </span>
      )}
    </div>
  );
}
