# Seer Frontend Design Spec

**Purpose:** Redesign Seer's web UI to align with Glean's brand system and elevate the visual quality from generic Tailwind dashboard to a distinctive, polished evaluation instrument.

**Status:** Spec — ready for implementation
**Tech stack:** Next.js 14 (App Router), Tailwind CSS 3.4, React 18, DM Sans + DM Mono (Google Fonts)

---

## Design Philosophy

Seer is an **evaluation oracle** — it judges agent quality with precision. The UI should feel like a well-calibrated scientific instrument: warm but precise, data-dense but readable, clearly part of the Glean ecosystem but with its own identity.

**Tone:** Refined analytical — not cold, not playful. Think research dashboard meets luxury data visualization.

**Key principles:**
- Glean-native color palette (Electric Blue, Bright Green, Oatmeal)
- DM Sans typography (Glean's official fallback font)
- Warm surfaces over cold grays
- Data-first hierarchy — scores and metrics are the hero, not chrome
- Purposeful motion — subtle transitions, no gratuitous animation

---

## 1. Design Tokens

### Color Palette

Define as CSS custom properties in `globals.css` and extend into `tailwind.config.js`.

```
/* Glean Brand */
--glean-blue: #343CED;          /* Electric Blue — primary actions, links, focus rings */
--glean-blue-hover: #2A31D4;    /* Darkened for hover states */
--glean-blue-light: #E8E9FD;    /* Tinted bg for info states, selected items */
--glean-green: #D8FD49;         /* Bright Green — success accents, highlights */
--glean-green-dark: #8FB800;    /* Darkened green for text on light backgrounds */
--glean-oatmeal: #F6F3EB;      /* Warm background — replaces gray-50 */
--glean-oatmeal-dark: #EDE9DF;  /* Slightly darker oatmeal for hover/nested surfaces */

/* Neutrals (warm-shifted) */
--text-primary: #1A1A1A;        /* Near-black — headings, primary text */
--text-secondary: #777767;      /* Dark Cement — descriptions, secondary text */
--text-tertiary: #A8A898;       /* Light cement — placeholders, disabled */
--border-default: #E5E2D9;      /* Warm border — replaces gray-200 */
--border-subtle: #EDEBE4;       /* Very subtle dividers */
--surface-primary: #FFFFFF;     /* Cards, panels */
--surface-page: #F6F3EB;        /* Page background (oatmeal) */

/* Score Colors (functional — keep distinct from brand) */
--score-success: #16A34A;       /* green-600 — scores 7-10 */
--score-warning: #D97706;       /* amber-600 — scores 4-6 */
--score-fail: #DC2626;          /* red-600 — scores 0-3 */

/* Score Badge Backgrounds */
--score-success-bg: #DCFCE7;    /* green-100 */
--score-warning-bg: #FEF3C7;    /* amber-100 */
--score-fail-bg: #FEE2E2;       /* red-100 */

/* Feedback (status messages, toasts) */
--feedback-success: #16A34A;
--feedback-error: #DC2626;
--feedback-info: #343CED;       /* Use brand blue */
--feedback-loading: #555550;
```

### Typography

**Font stack:** Replace Inter with DM Sans (body) + DM Mono (code/IDs).

```
--font-body: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
--font-mono: 'DM Mono', 'SF Mono', 'Monaco', 'Cascadia Code', monospace;
```

Load via `next/font/google`:
```tsx
import { DM_Sans, DM_Mono } from 'next/font/google'

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-body' })
const dmMono = DM_Mono({ weight: ['400', '500'], subsets: ['latin'], variable: '--font-mono' })
```

**Type scale:** Keep Tailwind defaults but ensure:
- Page titles: `text-2xl font-semibold` (not 3xl bold — slightly more restrained)
- Section titles: `text-lg font-semibold`
- Body: `text-sm` (14px)
- Labels: `text-xs font-medium tracking-wide uppercase`
- Mono values: `font-mono text-sm` (agent IDs, latency, tokens)

### Spacing & Radius

- Border radius: `rounded-lg` (8px) for cards, `rounded-md` (6px) for buttons/inputs, `rounded-full` for badges/pills
- Card padding: `p-5` or `p-6`
- Section spacing: `space-y-6` between major sections
- 8px base grid (Tailwind default is fine)

### Shadows

```
--shadow-card: 0 1px 3px rgba(26, 26, 26, 0.04), 0 1px 2px rgba(26, 26, 26, 0.06);
--shadow-card-hover: 0 4px 12px rgba(26, 26, 26, 0.08), 0 2px 4px rgba(26, 26, 26, 0.04);
--shadow-modal: 0 20px 60px rgba(26, 26, 26, 0.15), 0 8px 20px rgba(26, 26, 26, 0.1);
```

---

## 2. File-by-File Changes

### `tailwind.config.js`

Replace the existing config with extended Glean-aligned tokens:

```js
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
```

### `globals.css`

Replace entirely:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-surface-page text-[#1A1A1A] antialiased;
  }
}

/* Prose overrides for Markdown component (light theme context) */
@layer components {
  .prose-seer {
    @apply prose prose-sm max-w-none;
    --tw-prose-body: #1A1A1A;
    --tw-prose-headings: #1A1A1A;
    --tw-prose-links: #343CED;
    --tw-prose-bold: #1A1A1A;
    --tw-prose-counters: #777767;
    --tw-prose-bullets: #A8A898;
    --tw-prose-quotes: #777767;
    --tw-prose-code: #1A1A1A;
    --tw-prose-pre-bg: #F6F3EB;
  }
}
```

### `layout.tsx` — Root Layout

**Major changes:**
1. Replace Inter font with DM Sans + DM Mono
2. Replace top horizontal nav with a **compact left sidebar**
3. Oatmeal page background
4. New Seer wordmark treatment
5. Warmer footer

**Target layout structure:**

```
┌─────────────────────────────────────────────────┐
│ ┌──────┐ ┌──────────────────────────────────┐   │
│ │      │ │                                  │   │
│ │ SIDE │ │        MAIN CONTENT              │   │
│ │ BAR  │ │        (oatmeal bg)              │   │
│ │      │ │                                  │   │
│ │ 64px │ │      max-w-6xl centered          │   │
│ │ wide │ │                                  │   │
│ │      │ │                                  │   │
│ └──────┘ └──────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

**Sidebar spec:**
- Width: `w-16` (64px) collapsed, visually minimal
- Background: white surface with right border
- Contains: Seer icon/logo at top, nav icons stacked vertically, settings at bottom
- Nav items: icon-only with tooltip on hover
- Active state: `bg-glean-blue-light text-glean-blue` rounded indicator
- Icons: Use simple text/emoji or inline SVG:
  - Dashboard: ◎ (or grid icon)
  - New Set: + (circled plus)
  - Settings: ⚙ (gear)
- The word "Seer" displayed vertically or as a small wordmark at the top of the sidebar, styled in `font-semibold text-glean-blue tracking-tight`

**Alternative (if sidebar feels too heavy for 3 nav items):** Keep top nav but restyle it:
- White bg, warm border-bottom (`border-border`)
- Seer wordmark: `text-xl font-semibold tracking-tight text-glean-blue` (branded, not generic gray)
- Nav links: `text-cement hover:text-[#1A1A1A]` with active state using `text-glean-blue font-medium` and a 2px bottom border indicator in Glean blue
- Add a subtle "Built on Glean" or small Glean logomark in the header right side

**Implementer's choice:** Use whichever navigation pattern you think works best for this tool's scale. The top nav is simpler and might be more appropriate for just 3 links.

**Footer:**
- `border-t border-border bg-white`
- Text: `text-xs text-cement` — "Seer v0.2.0 · Built on Glean"

---

### Dashboard (`app/page.tsx`)

**Page header:**
- Title: `text-2xl font-semibold text-[#1A1A1A]` — "Evaluation Sets"
- Subtitle: `text-sm text-cement mt-1`
- CTA button: `bg-glean-blue text-white rounded-md hover:bg-glean-blue-hover px-4 py-2 text-sm font-medium`

**Eval set cards:**
- Container: `bg-white rounded-lg shadow-card p-5 border border-border hover:shadow-card-hover hover:border-glean-blue transition-all duration-200`
- Title: `text-base font-semibold text-[#1A1A1A]`
- Description: `text-sm text-cement line-clamp-2`
- Metadata labels: `text-xs text-cement`
- Agent ID: `font-mono text-xs text-cement`
- Score display: keep traffic-light colors (`text-score-success`, `text-score-warning`, `text-score-fail`)
- Score number styling: `font-semibold tabular-nums` for aligned digits

**Empty state:**
- `bg-white rounded-lg border border-border p-12 text-center`
- Larger empty state text: `text-base text-cement`
- CTA link: `text-glean-blue hover:underline font-medium`

**Grid:** Keep `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5`

---

### Eval Set Detail (`app/sets/[id]/page.tsx`)

**Breadcrumb:**
- `text-sm text-cement` with `hover:text-[#1A1A1A]` on links
- Separator: `text-cement-light` — use `/` or `›`

**Metadata card:**
- Same card treatment: `bg-white rounded-lg shadow-card border border-border p-6`
- Labels: `text-xs font-medium text-cement uppercase tracking-wide`
- Values: `text-[#1A1A1A]`
- Large number (test case count): `text-2xl font-semibold text-[#1A1A1A]`
- Agent ID: `font-mono text-sm text-cement`

**Test Cases section:**
- Section header bar: `bg-white rounded-t-lg border border-border px-6 py-4 flex justify-between items-center`
- "+ Add Case" button: `bg-glean-blue text-white text-sm rounded-md hover:bg-glean-blue-hover px-3 py-1.5 font-medium`
- Table inside same card: border-top only separating header from body

**Recent Runs list:**
- Run cards: `border border-border rounded-lg p-4 hover:border-glean-blue hover:shadow-card-hover transition-all duration-200`
- Date text: `text-sm text-cement`
- Judge model: `text-xs text-cement-light font-mono`
- Score: large `text-2xl font-semibold` with traffic-light colors
- "Run Evaluation" button: `bg-glean-blue text-white` (not green — brand-primary for primary actions)

---

### New Eval Set (`app/sets/new/page.tsx`)

**Form card:**
- `bg-white rounded-lg shadow-card border border-border p-8 max-w-2xl mx-auto`

**Form inputs:**
- Label: `text-sm font-medium text-[#1A1A1A] mb-1.5`
- Input: `w-full px-3 py-2 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-glean-blue/30 focus:border-glean-blue bg-white`
- Placeholder: `text-cement-light`
- Helper text: `text-xs text-cement mt-1`

**AI Generation section:**
- Replace the blue-to-purple gradient with Glean-branded treatment:
  - Background: `bg-glean-blue-light border border-glean-blue/20 rounded-lg p-4`
  - "AI-Powered Generation" title: `text-sm font-semibold text-[#1A1A1A]`
  - Generate button: `bg-glean-blue text-white rounded-md hover:bg-glean-blue-hover text-sm px-4 py-2`
  - Remove the ✨ emoji or replace with a subtle SVG sparkle icon
  - Kill the gradient button entirely — use solid `bg-glean-blue`

**Generated cases preview:**
- Case items: `p-3 bg-surface-page rounded-md border border-border-subtle text-sm`
- Case numbers: `font-mono text-cement text-xs`

**Action buttons:**
- Primary: `bg-glean-blue text-white rounded-md hover:bg-glean-blue-hover`
- Cancel: `border border-border text-cement hover:bg-surface-page rounded-md`
- Disabled: `bg-border text-cement-light cursor-not-allowed`

---

### Run Results (`app/runs/[id]/page.tsx`)

**Overall score display — make this the hero moment:**
- Keep the large score number but make it more dramatic:
  - Score: `text-6xl font-bold tabular-nums` with traffic-light color
  - Add a subtle circular background/ring behind the score:
    - Score ≥ 7: ring/bg tinted with `score-success-bg`
    - Score 4-6: `score-warning-bg`
    - Score < 4: `score-fail-bg`
  - Size: ~80px diameter circle containing the score, like a gauge reading
  - Label "Overall Score" above in `text-xs font-medium text-cement uppercase tracking-wide`

**Metadata grid:**
- Same card treatment as other pages
- "Judge Model" value in `font-mono text-sm`
- Status badge: if completed, show a subtle green pill: `bg-score-success-bg text-score-success text-xs font-medium px-2 py-0.5 rounded-full`

---

### ResultsTable Component

**Table header:**
- `bg-surface-page border-b border-border`
- Column headers: `text-xs font-medium text-cement uppercase tracking-wide px-4 py-3`

**Table rows:**
- Default: `border-b border-border-subtle`
- Hover: `hover:bg-surface-page/50`
- Expanded row: `bg-surface-page`

**Score cells:**
- Continuous (0-10): `font-semibold tabular-nums` with traffic-light text colors
- Categorical badges: `px-2 py-0.5 text-xs font-medium rounded-full` (use rounded-full for pill shape)
  - complete: `bg-score-success-bg text-score-success`
  - partial: `bg-score-warning-bg text-score-warning`
  - incomplete: `bg-score-fail-bg text-score-fail`
- Binary badges: same pill treatment, Yes = success, No = fail

**Expand/collapse toggle:**
- Replace `▲`/`▼` text with a proper chevron (CSS or SVG): rotates 180deg on expand
- Color: `text-cement hover:text-[#1A1A1A]`
- Add `transition-transform duration-200`

**Expanded details:**
- Background: `bg-surface-page`
- Section labels: `text-xs font-medium text-cement uppercase tracking-wide`
- Full query/response: rendered in `prose-seer` class (Markdown component)
- Metrics bar: horizontal flex with subtle dividers
  - `text-sm text-[#1A1A1A]`
  - Labels: `font-medium text-cement`
  - Values: `font-mono`

**Tool call cards (expanded):**
- `p-3 bg-white rounded-md border border-border text-sm`
- Tool name: `font-medium text-[#1A1A1A]`
- Duration: `text-xs font-mono text-cement`
- Input JSON: `font-mono text-xs text-cement whitespace-pre-wrap`

**Judge reasoning cards (expanded):**
- `p-4 bg-white rounded-md border border-border`
- Criterion name: `text-sm font-medium text-[#1A1A1A]`
- Score badge inline
- Reasoning text: `prose-seer` rendered markdown

---

### CaseTable Component

**Same table styling as ResultsTable:**
- Header: `bg-surface-page border-b border-border`
- Row hover: `hover:bg-surface-page/50`
- Borders: `border-b border-border-subtle`

**Edit mode:**
- Active textarea border: `border-glean-blue` (not blue-500)
- Focus ring: `focus:ring-2 focus:ring-glean-blue/30`

**Action buttons:**
- Edit: `text-glean-blue hover:text-glean-blue-hover text-sm`
- Delete: `text-score-fail hover:text-red-700 text-sm`
- Save: `text-score-success hover:text-green-700 text-sm font-medium`

---

### RunEvalModal Component

**Overlay:**
- `fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50`
- Add subtle `backdrop-blur-sm` for depth

**Modal card:**
- `bg-white rounded-lg shadow-modal max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col`

**Header:**
- `px-6 py-4 border-b border-border`
- Title: `text-lg font-semibold text-[#1A1A1A]`

**Criteria checkboxes:**
- Container: `border border-border rounded-md p-3 hover:bg-surface-page transition-colors cursor-pointer`
- Selected state: `border-glean-blue bg-glean-blue-light`
- Checkbox accent: style with `accent-color: #343CED` or Tailwind `accent-glean-blue`
- Type badge: `text-xs px-2 py-0.5 rounded-full bg-surface-page text-cement border border-border-subtle`

**Selection info bar:**
- `bg-glean-blue-light border border-glean-blue/20 rounded-md p-3`
- Text: `text-sm text-glean-blue font-medium`

**Footer buttons:**
- Run button: `bg-glean-blue text-white rounded-md hover:bg-glean-blue-hover font-medium` (not green-600)
- Replace `▶` with a subtle play SVG icon or keep text-only: "Run Evaluation (3)"
- Cancel: `border border-border text-cement rounded-md hover:bg-surface-page`

---

### Toast Component

**Color mapping:**
- Success: `bg-score-success` (#16A34A)
- Error: `bg-score-fail` (#DC2626)
- Info: `bg-glean-blue` (#343CED)
- Loading: `bg-[#555550]`

**Shape:** `rounded-md shadow-lg` — keep bottom-right position

**Replace emoji icons** (✓ ✕ ℹ ⏳) with simple SVG or keep but smaller (`text-lg` instead of `text-2xl`)

---

### Markdown Component

Replace the dark-theme prose classes with `prose-seer`:

```tsx
<div className={`prose-seer ${className || ''}`}>
  <ReactMarkdown>{content}</ReactMarkdown>
</div>
```

The `prose-seer` class is defined in `globals.css` with warm-toned Glean colors.

---

### RunEvalButton Component

- Change from `bg-green-600` to `bg-glean-blue text-white rounded-md hover:bg-glean-blue-hover`
- The "Run Evaluation" action should use brand-primary, not green (green = score/success state, blue = action)

---

## 3. Global Patterns

### Breadcrumbs
Every sub-page uses this pattern:
```tsx
<div className="flex items-center gap-1.5 text-sm text-cement mb-4">
  <Link href="/" className="hover:text-[#1A1A1A] transition-colors">Dashboard</Link>
  <span className="text-cement-light">›</span>
  <span className="text-[#1A1A1A] font-medium">{currentPage}</span>
</div>
```

### Card Pattern
```tsx
<div className="bg-white rounded-lg shadow-card border border-border p-6">
  {children}
</div>
```

Hover variant (for clickable cards):
```tsx
<div className="bg-white rounded-lg shadow-card border border-border p-5 hover:shadow-card-hover hover:border-glean-blue transition-all duration-200 cursor-pointer">
  {children}
</div>
```

### Button Hierarchy
1. **Primary:** `bg-glean-blue text-white rounded-md hover:bg-glean-blue-hover px-4 py-2 text-sm font-medium transition-colors`
2. **Secondary:** `border border-border text-[#1A1A1A] rounded-md hover:bg-surface-page px-4 py-2 text-sm font-medium transition-colors`
3. **Ghost:** `text-cement hover:text-[#1A1A1A] text-sm transition-colors`
4. **Danger:** `text-score-fail hover:text-red-700 text-sm font-medium transition-colors`
5. **Disabled:** `bg-border text-cement-light cursor-not-allowed`

### Form Input Pattern
```tsx
<input className="w-full px-3 py-2 border border-border rounded-md text-sm bg-white
  placeholder:text-cement-light
  focus:outline-none focus:ring-2 focus:ring-glean-blue/30 focus:border-glean-blue
  transition-colors" />
```

### Score Color Helper
Keep the traffic-light logic throughout, but use the new token names:
```tsx
const scoreColor = score >= 7 ? 'text-score-success' : score >= 4 ? 'text-score-warning' : 'text-score-fail'
const scoreBg = score >= 7 ? 'bg-score-success-bg' : score >= 4 ? 'bg-score-warning-bg' : 'bg-score-fail-bg'
```

---

## 4. What NOT to Change

- **Data logic** — all server queries, API calls, state management stay identical
- **File structure** — no new files needed except possibly a small SVG icon component
- **Component API** — props and interfaces stay the same
- **Score thresholds** — 7+ success, 4-6 warning, <4 fail
- **Responsive breakpoints** — keep existing md/lg grid logic
- **Database layer** — `lib/db.ts` untouched
- **Dark mode** — not implementing; remove the `prefers-color-scheme` block from globals.css (Seer is light-only for now)

---

## 5. Implementation Order

1. `tailwind.config.js` — new color tokens, font config, shadows
2. `globals.css` — new base styles, prose-seer class
3. `layout.tsx` — font imports (DM Sans/Mono), nav restyle, footer, body classes
4. `app/page.tsx` — dashboard cards, header, empty state
5. `app/sets/[id]/page.tsx` — metadata card, breadcrumb, run list
6. `app/sets/new/page.tsx` — form styling, AI generation section
7. `app/runs/[id]/page.tsx` — hero score display, metadata grid
8. `components/ResultsTable.tsx` — table styling, score badges, expanded details
9. `components/CaseTable.tsx` — table alignment, action button colors
10. `components/RunEvalModal.tsx` — modal treatment, checkbox styling
11. `components/Toast.tsx` — color mapping, icon sizing
12. `components/RunEvalButton.tsx` — button color swap
13. `components/Markdown.tsx` — prose-seer class

---

## 6. Reference

**Glean brand resources:** https://www.glean.com/brand-resources
**Scout design system (internal reference):** https://github.com/askscio/scout/blob/main/DESIGN_SYSTEM.md
**Glean primary font:** PolySans (proprietary) → DM Sans (Google Fonts fallback)
**Glean design system (Confluence):** https://askscio.atlassian.net/wiki/spaces/ENGINEERIN/pages/1761312781

-- Axon | 2026-02-17
