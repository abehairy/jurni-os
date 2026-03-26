/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#FAF7F2',
        'cream-dark': '#F0EBE3',
        terracotta: '#C4745A',
        'terracotta-light': '#D4917D',
        'terracotta-dark': '#A85D45',
        sage: '#8BA888',
        'sage-light': '#A8C4A5',
        'sage-dark': '#6B8B68',
        amber: '#D4A843',
        'amber-light': '#E4C06A',
        charcoal: '#2C2C2C',
        'charcoal-light': '#4A4A4A',
        'warm-gray': '#8A8278',
        'score-green': '#6B9E6B',
        'score-yellow': '#D4A843',
        'score-red': '#C4745A',
      },
      fontFamily: {
        display: ['Playfair Display', 'serif'],
        body: ['DM Sans', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
