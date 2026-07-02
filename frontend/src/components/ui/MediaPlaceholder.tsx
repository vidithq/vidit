// Self-hosted, fetch-free stand-in for cards with no media. Third-party
// generators (picsum.photos, pravatar, etc.) would leak the signed-in
// analyst's IP + UA, contradicting the /about operational-security claim.

import type { CSSProperties } from "react";

interface MediaPlaceholderProps {
  // Deterministic seed: same seed → same shade, so a re-rendered list is
  // stable across navigations.
  seed: string;
  className?: string;
}

// FNV-1a-ish: short, allocation-free, good enough for a hue.
function hueFromSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h % 360;
}

export function MediaPlaceholder({
  seed,
  className = "",
}: MediaPlaceholderProps) {
  const hue = hueFromSeed(seed);
  const style: CSSProperties = {
    // Low-saturation, low-lightness gradient on a neutral base — reads as
    // "image will go here" without competing with the blur.
    backgroundImage: `linear-gradient(135deg, hsl(${hue} 25% 22%) 0%, hsl(${(hue + 30) % 360} 18% 14%) 100%)`,
  };
  return (
    <div
      aria-hidden="true"
      className={`absolute inset-0 ${className}`}
      style={style}
    />
  );
}
