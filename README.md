# beef

**put your money where your mouth is.**

beef is a mobile-first social stock competition app. friends challenge each other over which stock will perform better, post predictions, build rivalries and climb a leaderboard. it's an installable pwa (iphone + android), built with next.js, supabase and a base-ready (but deliberately disabled) onchain layer.

> **this build uses simulated market data and practice money.** no live prices, no real funds. real-money staking stays off until the data source, oracle method, custody model and legal requirements are verified.

---

## quick start

```bash
npm install
npm run build && npm start      # production server on http://localhost:3000
# or
npm run dev                      # dev server with hot reload
```

no credentials needed: without supabase env vars the app runs in **demo mode** with a seeded world (13 users, 24 posts, 18 duels, 5 communities, notifications, rivalries). you're signed in as `@demo` automatically; sign out to browse as a guest.

| command | what it does |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build (type-checks) |
| `npm start` | serve the production build |
| `npm test` | settlement engine, calendar and provider tests (vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:seed-sql` | regenerate `supabase/seed.sql` from `src/data/seed.ts` |

> don't run `next dev` and `next start` from the same folder at the same time. they share `.next/`.

## what to try in the demo

- **create a duel**: duel tab → pick two stocks → stake → deadline → opponent → review → send.
- **demo time controls** on any live duel: *simulate acceptance* → *jump to price lock* → *jump to deadline & settle*. the server fetches simulated closes and decides the winner. you can skip the wait, but you can't choose the prices.
- **reference outcomes**: [`/duel/d_rise`](http://localhost:3000/duel/d_rise) (both rise: nvda +5% beats aapl +3%), [`/duel/d_fall`](http://localhost:3000/duel/d_fall) (both fall: meta −2% beats tsla −5%), [`/duel/d_draw`](http://localhost:3000/duel/d_draw) (identical +3% returns), [`/duel/d_halt`](http://localhost:3000/duel/d_halt) (paused: simulated trading halt), [`/duel/d_group`](http://localhost:3000/duel/d_group) (4-way group beef).
- **invite links work across devices**: the challenge terms travel in the url fragment, so a friend can open the link on another phone and accept.
- **trophy & prediction cards**: share as images (native share sheet on mobile, download on desktop).

## environment variables

copy `.env.example` → `.env.local`.

| variable | required | notes |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | prod | canonical url, used for share links and metadata |
| `NEXT_PUBLIC_SUPABASE_URL` | for backend | blank = demo mode |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | for backend | public anon key (rls applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | for backend | **server only**. used by the settlement service and cron. never prefix with `NEXT_PUBLIC_` |
| `MARKET_DATA_PROVIDER` | no | `mock` (default) · `polygon` · `finnhub` · `alphavantage` |
| `POLYGON_API_KEY` / `FINNHUB_API_KEY` / `ALPHAVANTAGE_API_KEY` | with provider | server only. missing key → falls back to `mock` with a warning |
| `CRON_SECRET` | prod | bearer token for `/api/cron/settle` (vercel sends it automatically) |
| `NEXT_PUBLIC_CHAIN` | no | `base-sepolia` (default) or `base` |
| `NEXT_PUBLIC_ESCROW_ADDRESS` | no | reference escrow, not deployed |
| `NEXT_PUBLIC_REAL_MONEY_ENABLED` | no | keep `false`. even `true` does nothing without a deployed escrow, and the db schema rejects non-simulated duels |

## supabase setup

1. create a project at supabase.com and copy the url, anon key and service role key into `.env.local`.
2. apply the schema and seed:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push                 # applies supabase/migrations/*
   psql "$DATABASE_URL" -f supabase/seed.sql   # optional demo data
   ```
   or paste both files into the sql editor in order.
3. auth → url configuration: add `<your-url>/onboarding` and `<your-url>/auth/update-password` to the redirect allow list.
4. the migration creates the public `avatars` storage bucket and adds tables to the `supabase_realtime` publication.

**what's in the schema** (`supabase/migrations/20261125000000_beef_schema.sql`): profiles, stock_assets, duels, duel_participants, duel_comments, duel_reactions, posts, post_comments, post_reactions, predictions, follows, rivalries, achievements, user_achievements, communities, community_members, notifications, daily_beefs, daily_picks, duel_price_snapshots, duel_settlements, settlement_audit_logs. foreign keys, indexes and rls on every table, plus:

- duel terms are frozen once a duel leaves `pending`; completed duels can't be modified (trigger).
- snapshots, settlements and audit logs are append-only; one settlement per duel (primary key).
- clients have **no write policy** on prices, settlements or audit logs. only the service role writes them.
- `accept_duel`, `decline_duel`, `cancel_duel` rpcs perform invite checks atomically.
- `simulated_funds` must be `true` (check constraint).

the schema, seed, rls policies, triggers and rpcs were verified against postgres 16 with stubbed `auth`/`storage` schemas.

### current integration status (honest version)

| area | demo mode | supabase mode |
|---|---|---|
| auth (email sign up/in/out, reset, update password) | local | ✅ supabase auth |
| avatar upload | data url | ✅ supabase storage |
| lock / settle / cron | ✅ server, in-memory idempotency | ✅ server, postgres-backed idempotency + audit |
| social data (posts, duels, follows…) reads & writes | ✅ local store | ⚠️ schema + rls ready; the ui still reads the local store. wiring the store actions to supabase queries is the next step |

## market data

`src/lib/market/` holds a provider abstraction (`MarketDataProvider`) with:

- `mock.ts`: deterministic simulated prices (same ticker + session ⇒ same price, always), a mean-reverting walk, scripted scenarios for the reference duels, a simulated 4:1 avgo split and a simulated smci trading halt.
- `http-providers.ts`: polygon (snapshot, `v1/open-close`, splits), finnhub (quote, daily candles), alpha vantage (global quote, daily series). keys stay server-side.
- `calendar.ts`: nyse sessions 2025–2027, holidays, 1pm early closes, dst-safe et ↔ utc conversion.

every price in the ui is labelled *simulated* when it comes from the mock provider.

## settlement methodology

**return = ((ending price − starting price) ÷ starting price) × 100.** the higher percentage return wins. share prices and dollar gains never matter.

- **start price**: official close of the first session that closes after the last participant accepts. nobody can join a duel already knowing today's move.
- **end price**: official close of the deadline session. weekend/holiday deadlines use the last close at or before the deadline; if that isn't after the lock session, the next trading session.
- both stocks use exactly the same window. timestamps are stored in utc, shown in et.
- returns are compared at 4 decimals of a percentage point; equal ⇒ draw (stakes returned). group beefs rank everyone; ties for first share the pot.
- splits between lock and end adjust the starting price by the split ratio.
- missing, halted, invalid, mistimed or future-dated closes ⇒ `needs_verification`; **no winner is declared** until data is reliable.

the pure engine is `src/lib/settlement/engine.ts` (`pct-return-v1`). the service (`service.ts`) runs the 11 steps (deadline check → fetch → validate source → verify timestamps → adjust splits → compute → compare → decide → record-if-absent → status → notify), is idempotent (insert-if-absent; concurrent calls store exactly one result) and writes an audit log. the browser can only *ask* to settle: it never sends prices, and in supabase mode the server loads the duel from the database and checks that the caller is a participant.

tests: `npm test` covers the brief's examples, both-rise / both-fall / identical, dollar-gain vs percent, group ties, dst and holidays, missing data, trading halts, split adjustment, idempotency and concurrent settlement.

## base / onchain

`src/lib/chain/`: wagmi config for base + base sepolia (eip-6963 wallet discovery), usdc addresses, an `EscrowService` interface with a `SimulatedEscrow`, a configurable tokenized-stock provider registry where every capability (transferable, permissionless, dex liquidity, oracle feed) starts **unverified**, and `contracts/BeefEscrow.sol` as an **unaudited reference design** (usdc escrow, oracle-signed settlement, refunds). wallet connection on `/wallet` is read-only; nothing is ever signed. no transaction hashes or confirmations are invented: every ledger entry is labelled simulated.

## pwa

- `src/app/manifest.ts`: standalone display, theme/background colours, 192/512 + maskable icons, shortcuts.
- `public/sw.js`: precaches the shell + `/offline`, cache-first for hashed static assets, network-first for pages. **never caches `/api/*`** or per-user pages.
- ios: `apple-mobile-web-app-capable`, status bar style, apple touch icon, `viewport-fit=cover` with safe-area padding.
- install prompt appears after ~20s, uses `beforeinstallprompt` on android/chrome, shows a share → add to home screen guide on ios, hides in standalone mode and backs off for a week after a dismissal. also available in profile → settings.

**install on iphone**: open the site in safari → share → *add to home screen*.
**install on android**: open in chrome → *install app* (or the in-app prompt).

## deploy to vercel

1. push the repo to github and import it in vercel (framework: next.js, defaults are fine).
2. add env vars from the table above (at minimum `NEXT_PUBLIC_APP_URL`; add supabase + `CRON_SECRET` for the backend).
3. `vercel.json` schedules `/api/cron/settle` every 15 minutes (needs a pro plan; on hobby, change it to daily or call it from an external scheduler with the bearer token).
4. add your custom domain in vercel → domains, then update `NEXT_PUBLIC_APP_URL` and the supabase redirect urls.

the rate limiter in `src/lib/server/rate-limit.ts` is in-memory per instance; swap in redis/upstash for multi-instance production.

## project layout

```
src/
  app/                    routes (home, discover, duel, leaderboard, profile, communities, wallet, auth…)
    api/                  market quotes/search/history, duels/lock, duels/settle, cron/settle, daily
  components/             shell, cards, social, share/trophy cards, install prompt…
  data/seed.ts            demo world (also generates supabase/seed.sql)
  lib/
    market/               provider abstraction, mock + http providers, market calendar
    settlement/           pure engine, settlement service, tests
    chain/                wagmi config, escrow abstraction, tokenized provider registry
    supabase/             browser/server/admin clients, settlement repository
    store/                demo-mode client store (localStorage)
    score.ts              beef score + achievements
supabase/                 migrations + generated seed
contracts/                reference escrow (not deployed)
```

## responsible design

18+ confirmation at sign-up and onboarding, country capture for future eligibility checks, explicit terms checkbox before creating or accepting any duel, max stake $25, a beef score that ignores stake size, clear "simulated" labels on every price and balance, a full risk disclosure at `/rules#risk`, and rate limits on duel, comment, post and settlement actions.
