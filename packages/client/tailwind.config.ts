import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Approximate the Holodle palette from the reference screenshot.
        holo: {
          bg: "#eef3fb", // soft blue-grey page background
          card: "#ffffff",
          ink: "#1d2944", // navy "DLE" half of the wordmark
          accent: "#22b8e6", // sky-blue "HOLO" half of the wordmark
          ok: "#16a34a",
          okBg: "#dcfce7",
          okBd: "#86efac", // border for green box cells
          bad: "#dc2626",
          badBg: "#fee2e2",
          badBd: "#fca5a5", // border for red box cells
          muted: "#64748b",
        },
      },
      fontFamily: {
        display: ["'Inter'", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)",
      },
    },
  },
  plugins: [],
} satisfies Config;
