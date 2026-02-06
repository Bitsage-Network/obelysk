import type { Config } from "tailwindcss";

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
        brand: {
          50: "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6", // Primary violet - exact spec
          600: "#7c3aed",
          700: "#6d28d9",
          800: "#5b21b6",
          900: "#4c1d95",
          950: "#2e1065",
        },
        // Fuchsia accent for AI/privacy features
        accent: {
          fuchsia: "#d946ef",
          "fuchsia-light": "#e879f9",
          "fuchsia-dark": "#c026d3",
          cyan: "#22d3ee",
          emerald: "#10b981",
          orange: "#f97316",
        },
        // Surface colors - Ultra-dark theme
        surface: {
          dark: "#0a0a0f",      // space-black
          card: "#12121a",      // slightly lighter
          elevated: "#1a1a24",  // elevated surfaces
          border: "#2a2a3a",    // subtle borders
          "border-light": "#3a3a4a",
        },
        // Semantic colors
        success: {
          DEFAULT: "#10b981",
          light: "#34d399",
          dark: "#059669",
        },
        warning: {
          DEFAULT: "#f59e0b",
          light: "#fbbf24",
          dark: "#d97706",
        },
        error: {
          DEFAULT: "#ef4444",
          light: "#f87171",
          dark: "#dc2626",
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
