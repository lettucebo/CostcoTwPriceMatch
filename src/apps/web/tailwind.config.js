/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        bg: '#0f1020',
        card: '#1a1a2e',
        accent: '#facc15',
      },
    },
  },
  plugins: [],
}
