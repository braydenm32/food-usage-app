# Larder

Know what's in your kitchen, what to eat first, and what to cook with it. A web-first PWA for Australian households.

- **Add food** from a receipt photo, a photo or paste of a shopping list, a pasted Woolworths/Coles order email, a barcode, or by hand. Everything goes through a review screen first.
- **Estimated dates** from a curated table of 319 foods (Australian food-safety guidance), adjusted for where it's stored, whether it's opened, frozen or thawed. Printed dates always win; your corrections are remembered (within safe limits).
- **Today** shows what to eat first, what to check, and quick actions with Undo.
- **Recipes** ranked by how many at-risk items they use, filtered by your household's diets, allergies and dislikes. 33 built-in recipes work offline; AI ideas and TheMealDB are optional extras. "I cooked this" deducts what you used.
- **Shopping list** grouped by aisle, with staples and "running low" suggestions; tick items and put them straight into the larder.
- **Optional meal planner**, waste insights (used vs binned, $), reminders digest, light and dark themes, offline support, JSON export/import.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # vitest
npm run build && npm start
```

### Optional environment variables

| Variable | What it enables |
| --- | --- |
| `ANTHROPIC_API_KEY` | Reading receipt and list photos, AI recipe ideas, smarter order-email parsing. Without it the app still works: paste, barcode and manual add, built-in recipes. |
| `LARDER_AI_MODEL` | Override the model (default `claude-haiku-5-5`). |

Data is stored on the device (localStorage) for now. Household sharing and sync across devices are planned with Supabase.

## Project layout

- `src/lib/` — domain types, store (Zustand, persisted), shelf-life engine and food table, parsers, recipe ranking and filters, reminders.
- `src/app/` — screens and API routes (`/api/scan`, `/api/parse-text`, `/api/barcode/[code]`, `/api/recipes`).
- `src/components/` — UI kit, app shell, item sheet, add flow, recipe components.
- `docs/BUILD_BRIEF.md` — design direction and quality bar.

Shelf-life estimates are guidance only. Always trust printed use-by dates and your senses.
