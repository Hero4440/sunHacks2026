/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    "./src/ui/**/*.html"
  ],
  theme: {
    extend: {
      colors: {
        nebula: {
          50: '#f0f4ff',
          100: '#e0e9ff',
          200: '#c3d4ff',
          300: '#9bb1ff',
          400: '#6b8aff',
          500: '#4065ff',
          600: '#2a44ff',
          700: '#1a2fff',
          800: '#1625cc',
          900: '#1a2399',
        }
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-in-out',
        'slide-in': 'slideIn 0.3s ease-out',
        'pulse-subtle': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        slideIn: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' }
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      }
    },
  },
  plugins: [],
  // Prefix all classes to avoid conflicts with host page styles
  prefix: 'nebula-',
  important: true, // Make styles important to override host page styles
}