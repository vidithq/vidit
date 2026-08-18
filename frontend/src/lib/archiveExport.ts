import { Clock, Download, Scissors, Settings } from "lucide-react";

import type { NumberedStep } from "@/components/ui/NumberedSteps";

/** X's official walkthrough for requesting the data archive. */
export const X_ARCHIVE_HELP =
  "https://help.x.com/en/managing-your-account/how-to-download-your-x-archive";

/**
 * Getting the export out of X, the part that happens on X's side and is the
 * same wherever it is taught: the import panel on `/submit` walks a signed-in
 * analyst through it, and the public `/import` guide teaches it to a reader
 * with no account yet. Each caller appends its own closing step, since where
 * the zip goes differs between the two.
 */
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
  {
    icon: Scissors,
    title: "Trim it to your posts (recommended)",
    body: "Open the archive and keep only your tweets.js and tweets_media folder (inside the data folder); delete the rest, then re-zip. We strip it automatically too, this is for full control.",
  },
];
