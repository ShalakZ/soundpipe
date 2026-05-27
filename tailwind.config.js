/** @type {import('tailwindcss').Config} */
//
// Colors are defined as CSS variables (space-separated RGB channels) in
// src/renderer/index.css. Each theme overrides them under `[data-theme="X"]`.
// The `rgb(var(--c-X) / <alpha-value>)` form keeps Tailwind's `/40` opacity
// modifiers working (e.g. `bg-accent/30`, `border-danger/40`).
const channel = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: channel('bg'),
        surface: channel('surface'),
        surface2: channel('surface2'),
        border: channel('border'),
        accent: channel('accent'),
        accentHover: channel('accent-hover'),
        text: channel('text'),
        muted: channel('muted'),
        danger: channel('danger'),
      },
    },
  },
  plugins: [],
};
