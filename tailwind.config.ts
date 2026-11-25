import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#F6F5F2",
        surface: "#FFFFFF",
        ink: { DEFAULT: "#1D1D1F", soft: "#3A3A3D" },
        muted: "#6E6E73",
        faint: "#A1A1A6",
        line: "#E7E5E0",
        brand: { DEFAULT: "#E5552C", dark: "#C7431D", soft: "#FCEAE3", ink: "#8E2E12" },
        gain: { DEFAULT: "#11915A", soft: "#E3F4EB" },
        loss: { DEFAULT: "#D33F49", soft: "#FBE7E8" },
        gold: { DEFAULT: "#B7871C", soft: "#FBF1D9" },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "-apple-system", "BlinkMacSystemFont", "\"SF Pro Text\"", "Inter", "\"Segoe UI\"", "Roboto", "sans-serif"],
        display: ["ui-rounded", "\"SF Pro Rounded\"", "-apple-system", "BlinkMacSystemFont", "Inter", "sans-serif"],
      },
      borderRadius: { xl: "14px", "2xl": "20px", "3xl": "28px" },
      boxShadow: {
        card: "0 1px 2px rgba(20,20,20,0.04), 0 1px 1px rgba(20,20,20,0.02)",
        pop: "0 8px 30px rgba(20,20,20,0.10)",
      },
      keyframes: {
        "fade-up": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: { "fade-up": "fade-up .25s ease-out both" },
    },
  },
  plugins: [],
} satisfies Config;
