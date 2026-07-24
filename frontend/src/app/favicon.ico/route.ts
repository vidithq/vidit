import Icon from "../icon";

// Stable fallback favicon. The `<link rel=icon>` tags Next emits point at
// `/icon/*?<hash>` with a per-deploy cache-buster, and Google's favicon
// crawler (plus older browsers and most third-party services) also fetches
// the fixed `/favicon.ico` path; a 404 there keeps the generic globe icon
// in search results. Serves the same Satori-rendered "V" as `/icon/*` so
// there is one glyph source of truth. PNG bytes at an .ico path are
// accepted by every consumer (content-sniffed). The 192px variant clears
// Google's ≥48px guidance.
export const dynamic = "force-static";

export function GET() {
  return Icon({ id: "android-192" });
}
