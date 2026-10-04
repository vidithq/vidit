import { twMerge } from "tailwind-merge";

// On conflicting Tailwind utilities the later class wins (a caller's `gap-2` beats a primitive's `gap-1`).
export const cn = twMerge;
