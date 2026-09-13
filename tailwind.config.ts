import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0e14",
        panel: "#141924",
        "panel-2": "#1b2230",
        line: "#2a3242",
        muted: "#8a94a6",
        pos: "#3ecf8e",
        neg: "#ff6b6b",
        warn: "#f5b544",
        accent: "#6ea8fe",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
