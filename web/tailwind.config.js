/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-body)', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'SF Mono', 'Monaco', 'Cascadia Code', 'monospace'],
      },
      colors: {
        glean: {
          blue: '#343CED',
          'blue-hover': '#2A31D4',
          'blue-light': '#E8E9FD',
          green: '#D8FD49',
          'green-dark': '#8FB800',
          oatmeal: '#F6F3EB',
          'oatmeal-dark': '#EDE9DF',
        },
        cement: {
          DEFAULT: '#777767',
          light: '#A8A898',
        },
        surface: {
          primary: '#FFFFFF',
          page: '#F6F3EB',
        },
        border: {
          DEFAULT: '#E5E2D9',
          subtle: '#EDEBE4',
        },
        score: {
          success: '#16A34A',
          warning: '#D97706',
          fail: '#DC2626',
          'success-bg': '#DCFCE7',
          'warning-bg': '#FEF3C7',
          'fail-bg': '#FEE2E2',
        },
      },
      boxShadow: {
        card: '0 1px 3px rgba(26, 26, 26, 0.04), 0 1px 2px rgba(26, 26, 26, 0.06)',
        'card-hover': '0 4px 12px rgba(26, 26, 26, 0.08), 0 2px 4px rgba(26, 26, 26, 0.04)',
        modal: '0 20px 60px rgba(26, 26, 26, 0.15), 0 8px 20px rgba(26, 26, 26, 0.1)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
