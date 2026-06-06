import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-montserrat)", "Montserrat", "system-ui", "sans-serif"],
      },
      keyframes: {
        // Sidebar labels fade in slightly translated from the left so they
        // feel like they're sliding out from behind the icon column.
        "label-in": {
          "0%": { opacity: "0", transform: "translateX(-4px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        "label-in": "label-in 150ms ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
