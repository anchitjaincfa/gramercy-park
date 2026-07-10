import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deep ink / navy foundation
        ink: {
          DEFAULT: '#111d2e',
          50: '#f4f6f9',
          100: '#e6ebf1',
          700: '#1d2d44',
          800: '#152234',
          900: '#0d1826',
          950: '#0a1220',
        },
        // Warm parchment surfaces
        parchment: {
          DEFAULT: '#faf7f1',
          100: '#f6f2ea',
          200: '#eee7da',
          300: '#e3d9c6',
        },
        // Refined gold accent
        gold: {
          DEFAULT: '#b3894f',
          400: '#c6a067',
          500: '#b3894f',
          600: '#9a733d',
          700: '#7d5d31',
        },
        // Muted sage for secondary accents / positive states
        sage: {
          DEFAULT: '#5f7161',
          500: '#5f7161',
          600: '#4d5c4f',
        },
      },
      fontFamily: {
        serif: [
          'Iowan Old Style',
          'Palatino Linotype',
          'Palatino',
          'Georgia',
          'Cambria',
          'Times New Roman',
          'serif',
        ],
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 2px rgba(17, 29, 46, 0.04), 0 8px 24px -12px rgba(17, 29, 46, 0.12)',
        statement: '0 1px 3px rgba(17, 29, 46, 0.06), 0 20px 48px -24px rgba(17, 29, 46, 0.22)',
      },
      letterSpacing: {
        label: '0.14em',
      },
    },
  },
  plugins: [],
};

export default config;
