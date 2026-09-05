import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Premium Theme Colors
        "theme-bg": "#0a051c",
        "theme-surface": "#0F1620",
        "theme-muted": "#0B1220",
        "theme-elevated": "#111827",
        "theme-accent": "#3B82F6",
        "theme-accent-2": "#FB923C",
        "theme-accent-3": "#A78BFA",
        "theme-success": "#10B981",
        "theme-danger": "#EF4444",
        "theme-warning": "#F59E0B",
        "theme-info": "#06B6D4",
        "theme-text": "#E6EEF8",
        "theme-text-secondary": "#9AA7B2",
        "theme-text-muted": "#6B7280",
        "purple-glow": "rgba(167, 139, 250, 0.14)",

        // Landing Page Colors (Mapped to Premium Theme)
        landing: {
          bg: {
            900: "#0a051c",   // Matches theme-bg
            1000: "#05020e",  // Slightly darker than theme-bg for depth
          },
          surface: "#0F1620", // Matches theme-surface
          glass: "rgba(255, 255, 255, 0.1)",
          accent: {
            DEFAULT: "#3B82F6", // Matches theme-accent
            2: "#FB923C",       // Matches theme-accent-2
          },
          text: "#E6EEF8",      // Matches theme-text
          muted: "#9AA7B2",     // Matches theme-text-secondary
          success: "#10B981",   // Matches theme-success
        },

        // Admin Light Theme Colors
        admin: {
          bg: "#E8EBED",
          sidebar: "#FFFFFF",
          card: "#FFFFFF",
          panel: "#FFFFFF",
          border: "#DADDE1",
          primary: "#E05252",
          "primary-foreground": "#FFFFFF",
          secondary: "#FBBF24",
          hover: "#E4E6EB",
          active: "#F0F2F5",
          search: "#F0F2F5",
          text: "#1C1E21",
          "text-secondary": "#65676B",
          "text-placeholder": "#8A8D91",
          badge: "#F59E0B",
          shadow: "rgba(0,0,0,0.06)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        "card": "12px",
      },
      boxShadow: {
        "card": "0 6px 18px rgba(2, 6, 23, 0.45)",
        "card-hover": "0 12px 28px rgba(2, 6, 23, 0.55)",
        "glow-purple": "0 0 20px rgba(167, 139, 250, 0.14)",
        "glow-blue": "0 0 20px rgba(59, 130, 246, 0.14)",
        "glow-orange": "0 0 20px rgba(251, 146, 60, 0.14)",
        "glow-green": "0 0 20px rgba(16, 185, 129, 0.14)",
      },
      transitionDuration: {
        "160": "160ms",
      },
      transitionTimingFunction: {
        "card-hover": "cubic-bezier(0.2, 0.9, 0.2, 1)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-dot": {
          "0%, 100%": {
            transform: "scale(1)",
            opacity: "0.4"
          },
          "50%": {
            transform: "scale(1.5)",
            opacity: "1"
          },
        },
        "card-glow": {
          "0%, 100%": {
            boxShadow: "0 6px 18px rgba(2, 6, 23, 0.45)",
          },
          "50%": {
            boxShadow: "0 12px 28px rgba(2, 6, 23, 0.55), 0 0 20px rgba(167, 139, 250, 0.14)",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-dot": "pulse-dot 1.2s ease-in-out infinite",
        "card-glow": "card-glow 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
