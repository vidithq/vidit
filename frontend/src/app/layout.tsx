import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import Sidebar from "@/components/Sidebar";
import ClosedBetaBanner from "@/components/ClosedBetaBanner";

const montserrat = Montserrat({
  subsets: ["latin", "cyrillic"],
  variable: "--font-montserrat",
});

export const metadata: Metadata = {
  // Anchors every page-level metadata URL (og:image, og:url, canonical,
  // etc.) to the production hostname. Without it Next falls back to
  // `https://${VERCEL_PROJECT_PRODUCTION_URL}` — the per-project Vercel
  // alias, not canonical `vidit.app` — so social crawlers publish the
  // alias URL. Also silences the "metadata.metadataBase is not set" build
  // warning.
  metadataBase: new URL("https://vidit.app"),
  title: "Vidit: OSINT/GEOINT Platform",
  description:
    "Archive and visualize geolocations of conflict-related events worldwide.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // `suppressHydrationWarning`: the inline script below sets `data-palette`
    // and `data-theme` on <html> before hydration, which the server markup
    // doesn't carry, so React would flag the attribute mismatch. Scoped to this
    // one element.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved accent palette + light/dark theme before first paint
            so themed UI doesn't flash the default hue or a dark background on
            load. Sets only attributes, so an unexpected stored value is inert
            (no matching override = default). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var d=document.documentElement.dataset,p=localStorage.getItem('vidit:palette'),t=localStorage.getItem('vidit:theme');if(p)d.palette=p;if(t)d.theme=t;}catch(e){}})();",
          }}
        />
      </head>
      <body
        className={`${montserrat.variable} font-sans bg-neutral-950 text-neutral-100 min-h-screen`}
      >
        <Providers>
          <Sidebar />
          <ClosedBetaBanner />
          {children}
        </Providers>
      </body>
    </html>
  );
}
