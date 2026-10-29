# Larder build brief (for contributors and agents)

Larder is a web-first PWA for Australian households: track food, estimate when it spoils, show what to eat first, suggest use-it-up recipes, and compile a shopping list. Spec: https://claude.ai/artifact/28cEoMYxDBHmtbAdyKEiMK

## Stack
- Next.js 16 App Router (this version differs from older Next.js: check `node_modules/next/dist/docs/` before using an unfamiliar API), React 19, TypeScript, Tailwind CSS v4 (tokens in `src/app/globals.css`).
- Local-first: all user data lives in a persisted Zustand store (`src/lib/store.ts`, localStorage). Supabase sync comes later; don't add a backend database.
- AI: Anthropic SDK on the server only (`src/lib/ai.ts`). Every AI route must degrade gracefully when `ANTHROPIC_API_KEY` is missing (return `AI_NOT_CONFIGURED` with status 503 and let the UI offer a non-AI path).
- Icons: `lucide-react`. Pages that read the store are client components; use `useHydrated()` to avoid hydration mismatches before showing persisted data (render a quiet skeleton until hydrated).

## Shared code (read before building; don't restructure)
- `src/lib/types.ts` domain types. `src/lib/store.ts` state + actions (undo snapshot on destructive actions). `src/lib/selectors.ts` `useItemViews()` returns items with computed expiry, most urgent first. `src/lib/shelf-life/engine.ts` date maths and wording (`describeDaysLeft`). `src/lib/shelf-life/foods.ts` `getFoodType`, `matchFoodType`, `searchFoodTypes`; data in `foods-data.ts`.
- `src/components/ui.tsx` Button, IconButton, PageHeader, SectionTitle, Card, EmptyState, Chip, Segmented, Input, Field, Stepper, Switch, Sheet. `src/components/freshness.tsx` StatusPill, FreshnessBar. `src/components/toast.tsx` `toast(msg, {undoable})`.
- App shell has a mobile bottom tab bar (Today `/`, Larder `/pantry`, Add `/add`, Recipes `/recipes`, List `/list`) and a desktop side rail with Settings `/settings`.

## Design direction
Warm food-magazine feel but our own palette: sage-white paper, bottle-green ink, eucalyptus primary; Young Serif (`font-display`) for headings and big moments, Figtree for UI. Freshness scale: fresh (leaf green), use-soon (wattle), use-today (persimmon), expired/"check it" (beetroot) — always paired with words/icons. Use only the theme tokens (`bg-surface`, `text-ink-2`, `bg-primary`, `bg-soon-soft`…), never raw hex, so light and dark both work.
Avoid templated tells: no ALL-CAPS eyebrow labels, no arrows appended to button text, no gradient washes, no identical card grids for everything. Phone-first (375px), large touch targets (min 44px), visible focus, reduced motion respected.

## Copy
Australian English (capsicum, zucchini, rockmelon, bin, tin). Plain, warm, short. Sentence case. Buttons say exactly what happens ("Add 12 items", "Mark as opened"). Estimates are honest: "about 3 days left", "est.". Errors say what happened and what to do. Prefer Undo toasts over confirm dialogs.

## Quality bar
Professional release quality: empty, loading and error states for every screen; keyboard and screen-reader accessible (labels, roles, focus); no layout shift; works offline except AI/network features which explain themselves. Run `npx tsc --noEmit` and `npx eslint src` clean before finishing.
