import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

// Pale status/brand text needs darker light-mode ink; violet shares purple ink.
const statusText = Object.fromEntries(
  (["red", "green", "emerald", "amber", "yellow", "orange", "blue", "sky", "cyan", "purple", "violet", "indigo"] as const).map((name) => [
    name,
    Object.fromEntries([100, 200, 300, 400].map((shade) => [shade, `var(--ink-${name === "violet" ? "purple" : name}, ${colors[name][shade as 100 | 200 | 300 | 400]})`])),
  ])
);

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
          950: "#1e1b4b",
        },
      },
      // Neutral utilities become semantic roles; emerald actions need darker white-label contrast.
      backgroundColor: {
        emerald: { 600: colors.emerald[700] },
        gray: {
          950: "rgb(var(--surface-page) / <alpha-value>)",
          900: "rgb(var(--surface-card) / <alpha-value>)",
          800: "rgb(var(--surface-raised) / <alpha-value>)",
          700: "rgb(var(--surface-hover) / <alpha-value>)",
          600: "rgb(var(--surface-active) / <alpha-value>)",
        },
      },
      textColor: {
        ...statusText,
        brand: {
          200: "var(--ink-brand, #c7d2fe)",
          300: "var(--ink-brand, #a5b4fc)",
          400: "var(--ink-brand, #818cf8)",
        },
        white: "rgb(var(--text-strong) / <alpha-value>)",
        gray: {
          100: "rgb(var(--text-primary) / <alpha-value>)",
          200: "rgb(var(--text-primary) / <alpha-value>)",
          300: "rgb(var(--text-secondary) / <alpha-value>)",
          400: "rgb(var(--text-muted) / <alpha-value>)",
          500: "rgb(var(--text-muted) / <alpha-value>)",
          600: "rgb(var(--text-muted) / <alpha-value>)",
        },
      },
      borderColor: {
        gray: {
          800: "rgb(var(--border-subtle) / <alpha-value>)",
          700: "rgb(var(--border-default) / <alpha-value>)",
          600: "rgb(var(--border-strong) / <alpha-value>)",
        },
      },
      ringOffsetColor: { gray: { 900: "rgb(var(--surface-card) / <alpha-value>)" } },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
