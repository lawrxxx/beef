import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      // every colour is a css variable (src/app/globals.css), so light and dark share one set of classes
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        slab: { DEFAULT: "rgb(var(--slab) / <alpha-value>)", 2: "rgb(var(--slab-2) / <alpha-value>)", text: "rgb(var(--slab-text) / <alpha-value>)", muted: "rgb(var(--slab-muted) / <alpha-value>)" },
        sunken: "rgb(var(--sunken) / <alpha-value>)",
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
        // archivo (one family, two widths) for display and interface, jetbrains mono for every number,
        // newsreader italic only where a person speaks. all self-hosted in src/app/fonts.
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui", "-apple-system", "\"Segoe UI\"", "Roboto", "sans-serif"],
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
      },
      // print-like corners: nothing pillowy
      borderRadius: { none: "0px", sm: "0px", DEFAULT: "0px", md: "0px", lg: "0px", xl: "0px", "2xl": "0px", "3xl": "0px", full: "0px" },
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
