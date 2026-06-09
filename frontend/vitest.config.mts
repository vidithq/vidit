import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    environmentOptions: {
      // Pin the origin so safeNext's same-origin check is deterministic
      // in tests regardless of jsdom's default URL.
      jsdom: { url: "http://localhost:3000" },
    },
    env: {
      // Sentinel, same trick as frontend.yml's build step: lib/api.ts
      // hard-fails on import when unset, but no test sends real traffic.
      NEXT_PUBLIC_API_URL: "https://api.invalid",
    },
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
