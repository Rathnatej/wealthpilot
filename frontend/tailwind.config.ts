import type { Config } from "tailwindcss";

// Tokens come from DESIGN.md (Coinbase analysis). Colors are CSS variables so
// light/dark themes swap without touching components.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: v("primary"), active: v("primary-active"), disabled: v("primary-disabled") },
        ink: v("ink"),
        body: v("body"),
        muted: v("muted"),
        canvas: v("canvas"),
        soft: v("surface-soft"),
        strong: v("surface-strong"),
        card: v("surface-card"),
        hairline: v("hairline"),
        dark: { DEFAULT: "#0a0b0d", elevated: "#16181c" },
        up: "#05b169",
        down: "#cf202f",
        warn: "#f4b000",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "-apple-system", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: { xs: "4px", sm: "8px", md: "12px", lg: "16px", xl: "24px", pill: "100px" },
      boxShadow: { soft: "0 4px 12px rgba(0, 0, 0, 0.04)" },
      maxWidth: { page: "1200px" },
      spacing: { section: "96px" },
    },
  },
  plugins: [],
};
export default config;
