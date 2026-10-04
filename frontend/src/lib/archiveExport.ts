import { Clock, Download, Settings } from "lucide-react";

import type { NumberedStep } from "@/components/ui/NumberedSteps";

export const X_ARCHIVE_HELP =
  "https://help.x.com/en/managing-your-account/how-to-download-your-x-archive";

/** Getting the export out of X, shared by the `/submit` import panel and the public `/import`
 * guide. Each caller appends its own closing step. */
export const ARCHIVE_EXPORT_STEPS: NumberedStep[] = [
  {
    icon: Settings,
    title: "Request your archive on X",
    body: 'On X: Settings → "Your account" → "Download an archive of your data".',
  },
  {
    icon: Clock,
    title: "Wait for X to build it",
    body: "Confirm your password. X prepares the file and notifies you when it's ready (often minutes, up to 24h).",
  },
  {
    icon: Download,
    title: "Download the .zip",
    body: "Open the link from X's email or in-app banner and save the zip to your device.",
  },
];
