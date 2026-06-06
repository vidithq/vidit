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
