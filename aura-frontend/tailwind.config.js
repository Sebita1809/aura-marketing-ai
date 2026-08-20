tailwind.config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        "surface-tint": "#ddb7ff",
        "on-secondary": "#002e6a",
        "secondary": "#adc6ff",
        "on-secondary-container": "#e6ecff",
        "surface": "#131313",
        "on-primary": "#490080",
        "inverse-primary": "#842bd2",
        "tertiary": "#c5c7c8",
        "inverse-surface": "#e5e2e1",
        "surface-container": "#201f1f",
        "surface-variant": "#353534",
        "primary-container": "#b76dff",
        "on-error": "#690005",
        "surface-container-lowest": "#0e0e0e",
        "surface-container-high": "#2a2a2a",
        "error-container": "#93000a",
        "tertiary-container": "#8f9192",
        "on-surface": "#e5e2e1",
        "surface-container-low": "#1c1b1c",
        "secondary-container": "#0566d9",
        "outline": "#988d9f",
        "on-surface-variant": "#cfc2d6",
        "error": "#ffb4ab",
        "background": "#131313",
        "on-error-container": "#ffdad6",
        "on-background": "#e5e2e1",
        "primary": "#ddb7ff",
        "surface-bright": "#3a3939",
        "surface-container-highest": "#353534",
        "inverse-on-surface": "#313030",
        "surface-dim": "#131313",
        "outline-variant": "#4d4354",
        "on-primary-container": "#400071"
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        xl: "0.75rem",
        full: "9999px"
      },
      spacing: {
        "margin-mobile": "16px",
        "margin-desktop": "40px",
        "container-max": "1440px",
        "base": "8px",
        "gutter": "24px"
      },
      fontFamily: {
        "body-md": ["Inter", "sans-serif"],
        "label-sm": ["Geist", "sans-serif"],
        "headline-lg": ["Hanken Grotesk", "sans-serif"],
        "display-lg": ["Hanken Grotesk", "sans-serif"]
      },
      fontSize: {
        "body-md": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "label-sm": ["12px", { lineHeight: "16px", letterSpacing: "0.05em", fontWeight: "500" }],
        "headline-lg": ["32px", { lineHeight: "40px", letterSpacing: "-0.01em", fontWeight: "600" }],
        "headline-lg-mobile": ["24px", { lineHeight: "32px", fontWeight: "600" }],
        "display-lg": ["48px", { lineHeight: "56px", letterSpacing: "-0.02em", fontWeight: "700" }]
      }
    }
  },
  plugins: []
};
