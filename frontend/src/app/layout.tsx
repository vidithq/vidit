import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import Sidebar from "@/components/Sidebar";
import BetaBanner from "@/components/BetaBanner";

const montserrat = Montserrat({
  subsets: ["latin", "cyrillic"],
  variable: "--font-montserrat",
});

export const metadata: Metadata = {
  // Pins metadata URLs to the production host; otherwise Next uses the per-project Vercel alias and crawlers publish that.
  metadataBase: new URL("https://vidit.app"),
  title: "Vidit: OSINT/GEOINT Platform",
  description:
    "Archive and visualize geolocations of conflict-related events worldwide.",
};

// `cover` lets the page paint into the display cutout and the home-indicator
// band instead of the browser letterboxing the whole document inside the safe
// rectangle, which is what makes the standalone install (`app/manifest.ts`
// declares `display: "standalone"`) read as an app rather than as a page with
// two bars of dead colour. The chrome that sits on a screen edge takes the
// insets back for itself through the `safe-*` utilities in `globals.css`.
export const viewport: Viewport = {
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The inline script below sets `data-palette` and `data-theme` before hydration; suppress the attribute-mismatch warning on this element.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the saved palette and theme before first paint to avoid a flash; sets only attributes, so a bad stored value is inert. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var d=document.documentElement.dataset,p=localStorage.getItem('vidit:palette'),t=localStorage.getItem('vidit:theme');if(p)d.palette=p;if(t)d.theme=t;}catch(e){}})();",
          }}
        />
      </head>
      <body
        className={`${montserrat.variable} font-sans bg-neutral-950 text-neutral-100 min-h-dvh`}
      >
        <Providers>
          <Sidebar />
          <BetaBanner />
          {children}
        </Providers>
        {/* Cookieless aggregate analytics (no consent banner needed); no-op outside Vercel. Data flows once the operator enables the toggles (see docs/engineering.md). */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
