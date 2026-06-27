/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        amber: {
          dim: '#3d2e00',
          muted: '#7a5c00',
          soft: '#c8a060',
          base: '#e8840a',
          bright: '#ffab40',
        },
        surface: {
          deep: '#0e0a00',
          base: '#1a1200',
          raised: '#241a00',
          border: '#3d2e00',
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Mono"', 'monospace'],
      }
    }
  },
  plugins: []
}
