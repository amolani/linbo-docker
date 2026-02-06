/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: 'hsl(0 0% 0%)',
        foreground: 'hsl(0 0% 95%)',
        card: {
          DEFAULT: 'hsl(0 0% 4%)',
          foreground: 'hsl(0 0% 95%)',
        },
        primary: {
          DEFAULT: 'hsl(217 91% 60%)',
          foreground: 'hsl(0 0% 100%)',
        },
        secondary: {
          DEFAULT: 'hsl(0 0% 8%)',
          foreground: 'hsl(0 0% 95%)',
        },
        muted: {
          DEFAULT: 'hsl(0 0% 8%)',
          foreground: 'hsl(0 0% 60%)',
        },
        accent: {
          DEFAULT: 'hsl(0 0% 8%)',
          foreground: 'hsl(0 0% 95%)',
        },
        destructive: {
          DEFAULT: 'hsl(0 63% 31%)',
          foreground: 'hsl(0 0% 95%)',
        },
        border: 'hsl(0 0% 12%)',
        input: 'hsl(0 0% 6%)',
        ring: 'hsl(217 91% 60%)',
      },
      borderRadius: {
        lg: '0.5rem',
        md: '0.375rem',
        sm: '0.25rem',
      },
    },
  },
  plugins: [],
}
