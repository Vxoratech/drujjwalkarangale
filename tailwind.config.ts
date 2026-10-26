import type { Config } from 'tailwindcss';

// All values reference CSS custom properties defined in src/styles/tokens.css,
// so the design tokens have a single source of truth.
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    screens: { sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px' },
    extend: {
      colors: {
        forest: { DEFAULT: 'var(--color-forest)', deep: 'var(--color-forest-deep)', hover: 'var(--color-forest-hover)' },
        sage: { DEFAULT: 'var(--color-sage)', strong: 'var(--color-sage-strong)' },
        gold: { DEFAULT: 'var(--color-gold)', ink: 'var(--color-gold-ink)', soft: 'var(--color-gold-soft)' },
        ivory: 'var(--color-ivory)',
        surface: 'var(--color-surface)',
        ink: { DEFAULT: 'var(--color-text)', muted: 'var(--color-text-muted)', subtle: 'var(--color-text-subtle)', inverse: 'var(--color-text-inverse)' },
        line: { DEFAULT: 'var(--color-border)', strong: 'var(--color-border-strong)' },
        danger: { DEFAULT: 'var(--color-danger)', soft: 'var(--color-danger-soft)' },
        warning: { DEFAULT: 'var(--color-warning)', soft: 'var(--color-warning-soft)' },
        success: { DEFAULT: 'var(--color-success)', soft: 'var(--color-success-soft)' },
        info: { DEFAULT: 'var(--color-info)', soft: 'var(--color-info-soft)' },
      },
      fontFamily: {
        // Noto Sans Devanagari covers Marathi glyphs that Manrope/DM Sans lack.
        display: ['Manrope', '"Noto Sans Devanagari"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"DM Sans"', '"Noto Sans Devanagari"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        xs: ['var(--text-xs)', { lineHeight: '1.5' }],
        sm: ['var(--text-sm)', { lineHeight: '1.5' }],
        base: ['var(--text-base)', { lineHeight: '1.6' }],
        lg: ['var(--text-lg)', { lineHeight: '1.5' }],
        xl: ['var(--text-xl)', { lineHeight: '1.4' }],
        '2xl': ['var(--text-2xl)', { lineHeight: '1.3' }],
        '3xl': ['var(--text-3xl)', { lineHeight: '1.2' }],
      },
      borderRadius: { sm: 'var(--radius-sm)', DEFAULT: 'var(--radius-md)', md: 'var(--radius-md)', lg: 'var(--radius-lg)', xl: 'var(--radius-xl)' },
      boxShadow: { xs: 'var(--shadow-xs)', sm: 'var(--shadow-sm)', md: 'var(--shadow-md)', lg: 'var(--shadow-lg)', focus: 'var(--focus-ring)' },
      maxWidth: { content: 'var(--layout-content-max)', form: 'var(--layout-form-max)', prose: 'var(--layout-prose-max)' },
      width: { sidebar: 'var(--layout-sidebar)', 'sidebar-collapsed': 'var(--layout-sidebar-collapsed)' },
      height: { header: 'var(--layout-header)' },
      zIndex: { dropdown: 'var(--z-dropdown)', sticky: 'var(--z-sticky)', drawer: 'var(--z-drawer)', modal: 'var(--z-modal)', toast: 'var(--z-toast)', tooltip: 'var(--z-tooltip)' },
      transitionDuration: { fast: 'var(--duration-fast)', base: 'var(--duration-base)' },
    },
  },
  plugins: [],
};

export default config;
