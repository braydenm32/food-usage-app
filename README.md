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
| `NEXT_PUBLIC_SUPABASE_URL` | Accounts, household sharing and sync between devices (see below). |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The project's publishable key (safe in the browser; data is protected by row-level security). |

Copy `.env.example` to `.env.local` and fill in what you need. Without the Supabase variables Larder is purely local: everything stays in the browser and Sync and share says sync isn't set up.

## Sync and sharing (Supabase)

Larder stays local-first: the store in localStorage is the source of truth on each device. When someone signs in and starts or joins a household, every record (items, history, storage spots, shelf-life overrides, the household profile, saved recipes, shopping list, meal plan) is mirrored as one row in `household_records`. Theme, reminders and other settings stay per device.

- **Push:** local changes are diffed by id and queued in an outbox (`larder-sync` in localStorage). The queue flushes about 600 ms after the last change, when the device comes back online, and when the app comes to the front. Nothing leaves the queue until the server has it.
- **Pull:** each device pulls rows newer than the highest `seq` it has seen. Realtime only says "something changed"; the same incremental pull does the work.
- **Conflicts:** last writer wins, per record. A local edit that hasn't been sent yet beats an incoming copy of the same record.
- **Joining with food already on the device:** either bring it in (the household's copy wins where both have the same record, e.g. the built-in fridge or the household profile) or start fresh with the household's food.

Code: `src/lib/sync/` (pure diff/outbox/apply logic with tests, plus the engine), `src/lib/supabase/`, screens at `/account` and `/join/[token]`.

### Setting up a project

1. Create a Supabase project and apply the migrations in `supabase/migrations/` in order (`supabase db push`, or paste them into the SQL editor). They create `households`, `household_members`, `household_invites` and `household_records` with row-level security, the RPCs (`create_household`, `create_household_invite`, `peek_household_invite`, `join_household`), and add `household_records` to the realtime publication.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The Content-Security-Policy in `next.config.ts` allows that URL (https and wss) automatically at build time.
3. Regenerate `src/lib/supabase/database.types.ts` after changing the schema (`supabase gen types typescript`).

### Auth settings (Supabase dashboard → Authentication)

- **URL configuration:** set the Site URL to where Larder runs (e.g. `https://larder.example.com`) and add redirect URLs `https://larder.example.com/account` and `https://larder.example.com/join/**` (plus `http://localhost:3000/**` for development).
- **Email templates:** sign-in uses a one-time code so it works inside an installed app (a magic link would open the browser instead). Add the code to both the **Magic link** and **Confirm signup** templates, for example `<p>Your Larder code is <strong>{{ .Token }}</strong></p>`, keeping `{{ .ConfirmationURL }}` as a fallback link. Keep the email OTP length at 6.
- **SMTP:** the built-in email sender is heavily rate-limited (a few emails an hour). Set up custom SMTP before inviting real households.
- **Google (optional):** enable the Google provider with a Google Cloud OAuth client whose authorised redirect URI is `https://<project-ref>.supabase.co/auth/v1/callback`. Until it's enabled, "Continue with Google" says so instead of failing.

## Project layout

- `src/lib/` — domain types, store (Zustand, persisted), shelf-life engine and food table, parsers, recipe ranking and filters, reminders.
- `src/lib/sync/`, `src/lib/supabase/` — household sync engine and the Supabase client; `supabase/migrations/` — the database schema.
- `src/app/` — screens (including `/account` and `/join/[token]`) and API routes (`/api/scan`, `/api/parse-text`, `/api/barcode/[code]`, `/api/recipes`).
- `src/components/` — UI kit, app shell, item sheet, add flow, recipe components.
- `docs/BUILD_BRIEF.md` — design direction and quality bar.

Shelf-life estimates are guidance only. Always trust printed use-by dates and your senses.
