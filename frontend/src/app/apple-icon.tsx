import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ImageResponse } from "next/og";

// iOS home-screen icon (app-router convention emits the apple-touch-icon
// link). Renders a literal "V" in Montserrat-700 to match the sidebar mark.
// See `icon.tsx` for the `process.cwd()` + `outputFileTracingIncludes`
// rationale.

const MONTSERRAT_700 = readFileSync(
  join(process.cwd(), "src/app/Montserrat-700.ttf"),
);

export const dynamic = "force-static";
export const runtime = "nodejs";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          background: "transparent",
          alignItems: "center",
          justifyContent: "center",
          color: "#f97316",
          fontFamily: "Montserrat",
          fontWeight: 700,
          fontSize: `${size.width * 0.9}px`,
          lineHeight: 1,
          // Optical centring — see comment in icon.tsx.
          paddingTop: `${size.width * 0.18}px`,
        }}
      >
        V
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Montserrat",
          data: MONTSERRAT_700,
          weight: 700,
          style: "normal",
        },
      ],
    },
  );
}
