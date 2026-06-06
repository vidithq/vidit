// Single point of truth for the brand font (matches vidit.app, which
// uses Montserrat throughout). Loaded once at module init; the
// returned fontFamily string is what every text component must use.
import { loadFont } from "@remotion/google-fonts/Montserrat";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
});

export const MONTSERRAT = fontFamily;
