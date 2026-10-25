import { Archive, AtSign } from "lucide-react";
import { XGlyph } from "@/components/ui/BrandGlyphs";

// The three ways in from X, in the order of `/import`. `anchor` is that page's section id. The glyphs
// match the Submit page's chooser.
export const IMPORT_GLYPH = {
  archive: <Archive size={13} strokeWidth={1.8} />,
  paste: <XGlyph size={12} />,
  bot: <AtSign size={13} strokeWidth={1.8} />,
};

export const IMPORT_ENTRIES = [
  { anchor: "archive", title: "Upload your X archive", when: "Your whole history, once." },
  { anchor: "paste", title: "Paste a post URL", when: "One post, no public trace." },
  { anchor: "bot", title: "Tag @ViditBot on X", when: "Every day, from your feed." },
] as const;
