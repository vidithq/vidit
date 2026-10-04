import Icon from "../icon";

// Stable fallback favicon: Next's `<link rel=icon>` URLs carry a per-deploy hash, but Google's crawler and older
// clients fetch `/favicon.ico`. Serves the same Satori "V" as `/icon/*` (PNG bytes at an .ico path are content-sniffed); 192px clears Google's 48px floor.
export const dynamic = "force-static";

export function GET() {
  return Icon({ id: "android-192" });
}
