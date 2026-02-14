/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Score color coding
        'score-fail': '#ef4444',     // red-500
        'score-warning': '#f59e0b',  // amber-500
        'score-success': '#10b981',  // emerald-500
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
