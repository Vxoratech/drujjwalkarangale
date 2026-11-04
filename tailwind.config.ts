import type { Config } from 'tailwindcss';

// All values reference CSS custom properties defined in src/styles/tokens.css,
// so the design tokens have a single source of truth.

// Tailwind can't apply opacity modifiers (`text-sage/80`) to a bare `var()`
// colour and silently emits nothing; color-mix keeps them working.
const token = (name: string) => `color-mix(in srgb, var(--color-${name}) calc(<alpha-value> * 100%), transparent)`;

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    screens: { sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px' },
    extend: {
      colors: {
        forest: { DEFAULT: token('forest'), deep: token('forest-deep'), hover: token('forest-hover') },
        sage: { DEFAULT: token('sage'), strong: token('sage-strong') },
        gold: { DEFAULT: token('gold'), ink: token('gold-ink'), soft: token('gold-soft') },
        ivory: token('ivory'),
        surface: token('surface'),
        ink: { DEFAULT: token('text'), muted: token('text-muted'), subtle: token('text-subtle'), inverse: token('text-inverse') },
        line: { DEFAULT: token('border'), strong: token('border-strong') },
        danger: { DEFAULT: token('danger'), soft: token('danger-soft') },
        warning: { DEFAULT: token('warning'), soft: token('warning-soft') },
        success: { DEFAULT: token('success'), soft: token('success-soft') },
        info: { DEFAULT: token('info'), soft: token('info-soft') },
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
