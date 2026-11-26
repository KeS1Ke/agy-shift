/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          '"Segoe UI Variable"',
          '"Segoe UI"',
          '"Microsoft YaHei UI"',
          'system-ui',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      colors: {
        brand: {
          50: '#EEF0FF',
          100: '#E0E3FF',
          500: '#5E6AD2',
          600: '#4F5BC4',
          700: '#424DB0',
        },
      },
    },
  },
  plugins: [],
};
