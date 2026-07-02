import { twMerge } from "tailwind-merge";

// Class joiner for the ui primitives: on conflicting Tailwind utilities the
// later class wins (a caller's `gap-2` beats a primitive's `gap-1`), instead of
// the stylesheet order deciding and an override silently losing. Falsy
// segments drop out, so conditional extras read as `cond && "..."`.
export const cn = twMerge;
