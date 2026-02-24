import type { Config } from "tailwindcss";

/**
 * Helper to convert hex to Tailwind-compatible RGB function format.
 * This enables opacity modifiers like bg-surface-card/80.
 */
function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r} ${g} ${b}`;
}

/**
 * Convert a flat color map of hex values to rgb() format for Tailwind opacity support.
 */
function rgbColors(colors: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    result[key] = `rgb(${hexToRgb(value)} / <alpha-value>)`;
  }
  return result;
}

export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      screens: {
        'xs': '384px',
      },
      colors: {
        // Obelysk Brand Colors - Violet primary with Fuchsia accent
        brand: rgbColors({
          50: "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
          700: "#6d28d9",
          800: "#5b21b6",
          900: "#4c1d95",
          950: "#2e1065",
        }),
        // Fuchsia accent for AI/privacy features
        accent: rgbColors({
          fuchsia: "#d946ef",
          "fuchsia-light": "#e879f9",
          "fuchsia-dark": "#c026d3",
          cyan: "#22d3ee",
          emerald: "#10b981",
          orange: "#f97316",
        }),
        // Surface colors - Ultra-dark theme
        surface: rgbColors({
          dark: "#0a0a0f",
          card: "#12121a",
          elevated: "#1a1a24",
          border: "#2a2a3a",
          "border-light": "#3a3a4a",
        }),
        // Semantic colors
        success: {
          DEFAULT: `rgb(${hexToRgb("#10b981")} / <alpha-value>)`,
          light: `rgb(${hexToRgb("#34d399")} / <alpha-value>)`,
          dark: `rgb(${hexToRgb("#059669")} / <alpha-value>)`,
        },
        warning: {
          DEFAULT: `rgb(${hexToRgb("#f59e0b")} / <alpha-value>)`,
          light: `rgb(${hexToRgb("#fbbf24")} / <alpha-value>)`,
          dark: `rgb(${hexToRgb("#d97706")} / <alpha-value>)`,
        },
        error: {
          DEFAULT: `rgb(${hexToRgb("#ef4444")} / <alpha-value>)`,
          light: `rgb(${hexToRgb("#f87171")} / <alpha-value>)`,
          dark: `rgb(${hexToRgb("#dc2626")} / <alpha-value>)`,
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      backgroundImage: {
        // Gradient presets
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'gradient-violet': 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
        'gradient-fuchsia': 'linear-gradient(135deg, #d946ef 0%, #c026d3 100%)',
        'gradient-violet-fuchsia': 'linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%)',
        'gradient-dark': 'linear-gradient(180deg, #0a0a0f 0%, #12121a 100%)',
      },
      boxShadow: {
        'glow-violet': '0 0 20px rgba(139, 92, 246, 0.3)',
        'glow-violet-lg': '0 0 40px rgba(139, 92, 246, 0.4)',
        'glow-fuchsia': '0 0 20px rgba(217, 70, 239, 0.3)',
        'glow-fuchsia-lg': '0 0 40px rgba(217, 70, 239, 0.4)',
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'shimmer': 'shimmer 2s linear infinite',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'spin-slow': 'spin 3s linear infinite',
        'gradient': 'gradient 8s ease infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        glow: {
          '0%': { boxShadow: '0 0 20px rgba(139, 92, 246, 0.2)' },
          '100%': { boxShadow: '0 0 30px rgba(139, 92, 246, 0.4)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        gradient: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
} satisfies Config;
