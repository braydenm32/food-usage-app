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
| `ANTHROPIC_API_KEY` | Reading receipt and list photos, AI recipe ideas, smarter order-email parsing. Without it the app still works: paste, barcode and manual add, built-in recipes. AI features also need sign-in, so they need `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the server and the `ai_usage` migration applied (see "AI features" below). |
| `AI_DAILY_LIMIT` | Optional. AI calls each signed-in person can make per day (Sydney days). Default 40. |
| `LARDER_AI_MODEL` | Override the model (default `claude-haiku-5-5`). |
| `THEMEALDB_API_KEY` | TheMealDB supporter key. Without it the shared test key is used, which is fine for development; get a supporter key before a public launch. |
| `NEXT_PUBLIC_SUPABASE_URL` | Accounts, household sharing and sync between devices (see below). |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The project's publishable key (safe in the browser; data is protected by row-level security). |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Background reminders (Web Push), with the two below. See "Background reminders". |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Checks sign-in and counts the daily allowance for AI features, lets the reminder sender read each household's food, and lets account deletion remove the account. Never expose it to the browser. |
| `CRON_SECRET` | Server only. Protects `/api/push/send`, the hourly reminder sender. |

Copy `.env.example` to `.env.local` and fill in what you need. Without the Supabase variables Larder is purely local: everything stays in the browser and Sync and share says sync isn't set up.

### AI features

The AI routes (`/api/scan`, `/api/parse-text`, `/api/recipes`, `/api/recipes/import`) only answer signed-in people, and count each call against a daily allowance (`AI_DAILY_LIMIT`, default 40 per person per day). The server checks the caller's access token and counts calls with the service-role key, so **before deploying this version**:

1. Apply `supabase/migrations/20261107000100_ai_usage.sql` (the `ai_usage` table and `consume_ai_call`). Without it every AI call fails.
2. Set `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` on the server, beside `ANTHROPIC_API_KEY`. Without them AI features answer "not available" (503) even with an Anthropic key.
3. Optionally set `AI_DAILY_LIMIT`.

Signed out, the app still reads pasted lists line by line, and the built-in recipes and recipe search work as before.

## Sync and sharing (Supabase)

Larder stays local-first: the store in localStorage is the source of truth on each device. When someone signs in and starts or joins a household, every record (items, history, storage spots, shelf-life overrides, the household profile, saved recipes, shopping list, meal plan, "always keep in stock" staples) is mirrored as one row in `household_records`. Theme, reminders and other settings stay per device, and so does the memory of what each scanned barcode was.

- **Push:** local changes are diffed by id and queued in an outbox (`larder-sync` in localStorage). The queue flushes about 600 ms after the last change, when the device comes back online, and when the app comes to the front. Nothing leaves the queue until the server has it.
- **Pull:** each device pulls rows newer than the highest `seq` it has seen. Realtime only says "something changed"; the same incremental pull does the work.
- **Conflicts:** last writer wins, per record. A local edit that hasn't been sent yet beats an incoming copy of the same record.
- **Joining with food already on the device:** either bring it in (the household's copy wins where both have the same record, e.g. the built-in fridge or the household profile) or start fresh with the household's food. When the food here came from another household (the device is linked to one, someone signed out and kept it, or a different account was signed in), the screens default to starting fresh and say why.
- **Invites:** each link lets one person join and lasts 48 hours. The person who started the household can cancel every open link with "Cancel open invite links" on Sync and share. Leaving cancels the links you made; an owner removing someone cancels them all.
- **Signing out** asks whether to keep the household's food on this device or remove it (the default). With changes that haven't synced, or when the device isn't syncing with a household any more, the food is always kept. "Sign out of all devices" ends the account's sessions everywhere.
- **Storage limit:** when the household is full (25,000 live records or about 20 MB), removals still go up first; other changes stay queued, Sync and share says the household is full, and they're offered again after a few minutes or on "Sync now".
- **Deleting an account** (Sync and share → Danger zone) calls `POST /api/account/delete`, which checks the caller's access token and deletes the `auth.users` row with the service-role key (`SUPABASE_SERVICE_ROLE_KEY`; without it the route answers 503). Memberships and reminder subscriptions are deleted with it; records and invites stay with the household but forget who wrote them; the last member out deletes the household. The device then clears everything Larder stored (`clearAllLocalData` in `src/lib/local-data.ts`).

Code: `src/lib/sync/` (pure diff/outbox/apply logic with tests, plus the engine), `src/lib/supabase/`, screens at `/account` and `/join/[token]`.

### Setting up a project

1. Create a Supabase project and apply the migrations in `supabase/migrations/` in order (`supabase db push`, or paste them into the SQL editor). They create `households`, `household_members`, `household_invites` and `household_records` with row-level security, the RPCs (`create_household`, `create_household_invite`, `peek_household_invite`, `join_household`), and add `household_records` to the realtime publication.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The Content-Security-Policy in `next.config.ts` allows that URL (https and wss) automatically at build time.
3. Regenerate `src/lib/supabase/database.types.ts` after changing the schema (`supabase gen types typescript`).

This release adds two migrations. Apply them in this order, before deploying the app:

1. `20261107000000_security_hardening.sql`
2. `20261107000100_ai_usage.sql`

`supabase db push` applies them in that order (by file name). In the SQL editor, run them one after the other.

`20261107000000_security_hardening.sql` (safe to run again) takes every table grant away from `anon` and `TRUNCATE`/`REFERENCES`/`TRIGGER` from `authenticated`; stops a record being moved between households; counts only live records toward the 25,000-record limit and adds a byte budget per household (about 20 MB, `households.bytes_used`, judged on each write's net change, so a batch that removes as much as it adds always fits); closes races in the household limits; makes invites single use for 48 hours; limits the realtime publication to inserts and updates (realtime doesn't apply row-level security to DELETE events); and adds `private.purge_stale_data()`, which deletes invites 30 days after they expire or are used and sign-ups never confirmed after 7 days. If `pg_cron` is enabled when the migration runs it schedules that daily; otherwise, once `pg_cron` is on, run:

```sql
select cron.schedule('larder-retention', '23 3 * * *', 'select private.purge_stale_data()');
```

`20261030000200_harden.sql` was applied by hand on the production project, so it may be missing from the migration history and `supabase db push` would try to run it again. Check with `supabase migration list`; if it shows as not applied remotely, mark it applied (don't re-run it) with:

```sh
supabase migration repair --status applied 20261030000200
```

### Auth settings (Supabase dashboard → Authentication)

- **URL configuration:** set the Site URL to where Larder runs (e.g. `https://larder.example.com`). The redirect allow list should hold only `https://larder.example.com/account` and `https://larder.example.com/join/**` for production; no wildcard domains (such as `https://*.vercel.app/**`) and no `**` on the whole site. Use a separate Supabase project for development and previews, with `http://localhost:3000/**` there, rather than adding it to production.
- **Email OTP expiry** (Providers → Email): 600 to 900 seconds (10 to 15 minutes). The default of an hour leaves codes usable for longer than anyone needs.
- **Leaked password protection** doesn't apply: Larder signs in with emailed codes and Google, never passwords. Leave email/password sign-in off.
- **Email templates:** sign-in uses a one-time code so it works inside an installed app (a magic link would open the browser instead). Add the code to both the **Magic link** and **Confirm signup** templates, for example `<p>Your Larder code is <strong>{{ .Token }}</strong></p>`, keeping `{{ .ConfirmationURL }}` as a fallback link. Keep the email OTP length at 6.
- **SMTP:** the built-in email sender is heavily rate-limited (a few emails an hour). Set up custom SMTP before inviting real households.
- **Google (optional):** enable the Google provider with a Google Cloud OAuth client whose authorised redirect URI is `https://<project-ref>.supabase.co/auth/v1/callback`. Until it's enabled, "Continue with Google" says so instead of failing.

## Background reminders (Web Push)

People with an account in a household get their reminder digest as a push notification at the hour they chose, in their own time zone, even when Larder is closed. Without an account (or until this is set up) reminders show when Larder is opened after that hour, and a missed weekly one shows on the next open. Settings says which applies.

How it works: when someone allows notifications (from Settings, or the prompt after their first add), the device subscribes with the VAPID public key and saves the subscription plus its reminder time, zone, cadence and "use soon" days through the `save_push_subscription` RPC into `push_subscriptions` (row-level security: people see and delete only their own rows; leaving a household removes its subscriptions). Every hour `/api/push/send` (called by Supabase `pg_cron`) finds the subscriptions whose slot has passed since they last got one, claims each row (so overlapping runs never send twice), builds each household's digest from its synced food with the same shelf-life engine as the app, and sends it with `web-push`. It only ever contacts the browser push services (Google FCM, Mozilla, Apple, Microsoft): the `save_push_subscription` RPC and the sender both refuse any other endpoint. Expired subscriptions are removed, and signing out or leaving a household removes that device's subscription. Code: `src/lib/push/`, `src/app/api/push/`, `public/sw.js`.

### Setting it up

1. Apply `supabase/migrations/20261102000000_push_subscriptions.sql` and `20261102000100_sync_staples.sql` (with the others, `supabase db push`).
2. Generate a key pair once: `npx web-push generate-vapid-keys`. Keep it: changing the keys stops existing subscriptions, and people would need to turn reminders off and on again.
3. In Vercel (Project → Settings → Environment Variables), set:
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`: the public key.
   - `VAPID_PRIVATE_KEY`: the private key.
   - `VAPID_SUBJECT`: a contact for push services, `mailto:you@example.com` or your site's URL.
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase dashboard → Project Settings → API keys → `service_role` (or a secret key). Account deletion (`/api/account/delete`) uses it too.
   - `CRON_SECRET`: any long random string (`openssl rand -hex 32`).
   Redeploy afterwards: the public key is built into the client.
4. Schedule the sender with Supabase `pg_cron` and `pg_net` (works on Vercel's free Hobby plan, whose cron jobs only run once a day; there is no cron in `vercel.json`). In the Supabase dashboard → Database → Extensions, enable `pg_cron` and `pg_net`. Then in the SQL editor, keep the secret in Vault (not in plain text in `cron.job`) and schedule the call at the top of every hour:
   ```sql
   select vault.create_secret('<CRON_SECRET>', 'larder_cron_secret');
   select vault.create_secret('https://<your-site>/api/push/send', 'larder_push_url');

   select cron.schedule('larder-reminders', '0 * * * *', $$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'larder_push_url'),
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'larder_cron_secret')
       ),
       body := '{}'::jsonb,
       timeout_milliseconds := 30000
     );
   $$);
   ```
   To change the secret later: `select vault.update_secret((select id from vault.secrets where name = 'larder_cron_secret'), '<new secret>');`. Recent runs are in `cron.job_run_details`, responses in `net._http_response`.
5. Check it: sign in, turn on Settings → Reminders → Notifications, then tap "Send a test". You can also call the sender by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://<your-site>/api/push/send` returns how many were checked, due and sent.

iPhone and iPad only receive web push once Larder is added to the Home Screen and opened from there (iOS 16.4 or later).

## Project layout

- `src/lib/` — domain types, store (Zustand, persisted), shelf-life engine and food table, parsers, recipe ranking and filters, reminders.
- `src/lib/sync/`, `src/lib/supabase/` — household sync engine and the Supabase client; `supabase/migrations/` — the database schema.
- `src/app/` — screens (including `/account` and `/join/[token]`) and API routes (`/api/scan`, `/api/parse-text`, `/api/barcode/[code]`, `/api/recipes`).
- `src/components/` — UI kit, app shell, item sheet, add flow, recipe components.
- `docs/BUILD_BRIEF.md` — design direction and quality bar.

Shelf-life estimates are guidance only. Always trust printed use-by dates and your senses.

## Recipe sources and licences

Larder only stores and shows recipes it is allowed to: its own built-in recipes, AI-written "Larder originals", [TheMealDB](https://www.themealdb.com/) (credited on each recipe) and the [Wikibooks Cookbook](https://en.wikibooks.org/wiki/Cookbook:Table_of_Contents) (CC BY-SA 4.0; each recipe names the page, links its contributors and the licence, and says it was reformatted). Wikibooks recipes are a bundled snapshot in `src/lib/recipes/data/wikibooks.json`, because Wikimedia rate-limits live API calls from cloud servers; refresh it with `NODE_USE_ENV_PROXY=1 node scripts/import-wikibooks.ts`. Big recipe sites such as taste.com.au and RecipeTin Eats don't allow reuse, so Larder only links to their search pages. Recipes a person imports from a link stay in their own household's box with a link back to the author.
