import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      // every colour is a css variable (src/app/globals.css), so light and dark share one set of classes
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        ink: { DEFAULT: "rgb(var(--ink) / <alpha-value>)", soft: "rgb(var(--ink-soft) / <alpha-value>)" },
        /** text on ink-coloured surfaces (white in light mode, charcoal in dark) */
        inverse: "rgb(var(--inverse) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        faint: "rgb(var(--faint) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        brand: { DEFAULT: "rgb(var(--brand) / <alpha-value>)", dark: "rgb(var(--brand-dark) / <alpha-value>)", soft: "rgb(var(--brand-soft) / <alpha-value>)", ink: "rgb(var(--brand-ink) / <alpha-value>)" },
        gain: { DEFAULT: "rgb(var(--gain) / <alpha-value>)", soft: "rgb(var(--gain-soft) / <alpha-value>)" },
        loss: { DEFAULT: "rgb(var(--loss) / <alpha-value>)", soft: "rgb(var(--loss-soft) / <alpha-value>)" },
        gold: { DEFAULT: "rgb(var(--gold) / <alpha-value>)", soft: "rgb(var(--gold-soft) / <alpha-value>)" },
        chainlink: "rgb(var(--chainlink) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "-apple-system", "BlinkMacSystemFont", "\"SF Pro Text\"", "Inter", "\"Segoe UI\"", "Roboto", "sans-serif"],
        display: ["ui-rounded", "\"SF Pro Rounded\"", "-apple-system", "BlinkMacSystemFont", "Inter", "sans-serif"],
      },
      borderRadius: { xl: "14px", "2xl": "20px", "3xl": "28px" },
      boxShadow: {
        card: "var(--shadow-card)",
        pop: "var(--shadow-pop)",
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
