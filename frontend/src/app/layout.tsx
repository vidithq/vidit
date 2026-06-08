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
  // Anchors every page-level metadata URL (og:image, og:url, twitter:image,
  // canonical, etc.) to the production hostname. Without this Next.js
  // falls back to `https://${VERCEL_PROJECT_PRODUCTION_URL}` — which is
  // the per-project Vercel alias (`vidit-frontend.vercel.app`), NOT the
  // canonical `vidit.app` the rest of the site advertises. Social
  // crawlers (X, LinkedIn, Slack) then publish the Vercel-alias URL
  // for the og:image, undercutting the rebrand the rest of the PR is
  // about. Also silences the "metadata.metadataBase is not set" build
  // warning that fires on every Vercel build.
  metadataBase: new URL("https://vidit.app"),
  title: "Vidit — OSINT/GEOINT Platform",
  description:
    "Archive and visualize geolocations of conflict-related events worldwide.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${montserrat.variable} font-sans bg-[#0a0a0a] text-neutral-100 min-h-screen`}
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
