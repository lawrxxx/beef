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

no credentials needed: without supabase env vars the app runs in **demo mode** with a seeded world: 13 users, 25 posts, 63 duels (52 settled), 5 communities, notifications and rivalries. you're signed in as `@demo` automatically; sign out to browse as a guest.

the demo is anchored to *today*: live duels, invites and recent results are placed relative to the current trading session, so the demo never goes stale. leaderboards, records, streaks and rivalries are all computed from those settled duels. nothing is hardcoded. the reference duels below keep fixed dates because they use scripted simulated prices.

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

- **create a duel**: *start a beef* → who (a friend, an open challenge, or a group of up to 6) → the two stocks → your side → stake (your stake and the prize pool shown separately) → deadline → review → send & share. every step validates, and a double tap can't create two duels.
- **answer invites**: `/duel/d_inv` (accept) and `/duel/d_inv2` (decline) are waiting on the home screen.
- **demo time controls** on any live duel: *simulate acceptance* → *jump to price lock* → *jump to deadline & settle*. the server fetches simulated closes and decides the winner. you can skip the wait, but you can't choose the prices.
- **reference outcomes**: [`/duel/d_rise`](http://localhost:3000/duel/d_rise) (both rise: nvda +5% beats aapl +3%), [`/duel/d_fall`](http://localhost:3000/duel/d_fall) (both fall: meta −2% beats tsla −5%), [`/duel/d_draw`](http://localhost:3000/duel/d_draw) (identical +3% returns), [`/duel/d_halt`](http://localhost:3000/duel/d_halt) (paused: simulated trading halt), [`/duel/d_group`](http://localhost:3000/duel/d_group) (4-way group beef).
- **invite links work across devices**: the challenge terms travel in the url fragment, so a friend can open the link on another phone and accept.
- **trophy & prediction cards**: share as images (native share sheet on mobile, download on desktop).

## environment variables

copy `.env.example` → `.env.local`.

| variable | required | notes |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | prod | canonical url, used for share links and metadata |
| `NEXT_PUBLIC_BACKEND` | for live mode | set to `supabase` to switch from demo mode to the database |
| `NEXT_PUBLIC_SUPABASE_URL` | for live mode | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | for backend | public anon key (rls applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | for backend | **server only**. used by the settlement service and cron. never prefix with `NEXT_PUBLIC_` |
| `MARKET_DATA_PROVIDER` | no | `mock` (default) · `polygon` · `finnhub` · `alphavantage` |
| `POLYGON_API_KEY` / `FINNHUB_API_KEY` / `ALPHAVANTAGE_API_KEY` | with provider | server only. missing key → falls back to `mock` with a warning |
| `CRON_SECRET` | prod | bearer token for `/api/cron/settle` (vercel sends it automatically) |
| `NEXT_PUBLIC_CHAIN` | no | `base-sepolia` (default) or `base` |
| `NEXT_PUBLIC_ESCROW_ADDRESS` | no | reference escrow, not deployed |
| `NEXT_PUBLIC_REAL_MONEY_ENABLED` | no | keep `false`. even `true` does nothing without a deployed escrow, and the db schema rejects non-simulated duels |

## supabase setup (live mode)

the app stays in demo mode until you set `NEXT_PUBLIC_BACKEND=supabase`. adding supabase keys alone never switches modes, so the public demo can't break by accident.

**with vercel (easiest)**
1. vercel → your project → **storage** → create database → **supabase**, connected to the project. vercel adds `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
2. supabase dashboard → **sql editor**: run `supabase/migrations/20261125000000_beef_schema.sql`, then `supabase/migrations/20261126000000_social_triggers.sql`, then optionally `supabase/seed.sql` (regenerate it first with `npm run db:seed-sql` so its dates are current).
3. supabase → **authentication → url configuration**: set the site url to your app url and add `<url>/onboarding` and `<url>/auth/update-password` as redirect urls. while testing you can turn off *confirm email* under authentication → sign in providers → email.
4. vercel → settings → environment variables: add `NEXT_PUBLIC_BACKEND=supabase` (and `CRON_SECRET`), then redeploy.

**locally**
```bash
npx supabase start          # needs docker; applies migrations + seed from ./supabase
# copy API_URL / ANON_KEY / SERVICE_ROLE_KEY from `npx supabase status` into .env.local
NEXT_PUBLIC_BACKEND=supabase npm run build && npm start
npm run e2e:supabase        # two real accounts: invite, accept, settle, notify, realtime
```

**how live mode works**
- the client store loads from postgres (rls decides what each person can see), writes every action straight to the database, and reloads when realtime reports a change in any shared table.
- accepting, declining and cancelling go through the `accept_duel` / `decline_duel` / `cancel_duel` rpcs. invites, acceptances, declines, follows, comments and reactions create notifications through database triggers, so people get them on any device.
- lock and settle requests send only the duel id. the server loads the terms from the database, checks that the caller is a participant, fetches prices itself and writes snapshots, the settlement and the audit log with the service role. the vercel cron settles everything else.
- seeded demo people exist only as profiles (they can't sign in), so challenges sent to them stay pending. real users can challenge each other.

**what's in the schema** (`supabase/migrations/20261125000000_beef_schema.sql`): profiles, stock_assets, duels, duel_participants, duel_comments, duel_reactions, posts, post_comments, post_reactions, predictions, follows, rivalries, achievements, user_achievements, communities, community_members, notifications, daily_beefs, daily_picks, duel_price_snapshots, duel_settlements, settlement_audit_logs. foreign keys, indexes and rls on every table, plus:

- duel terms are frozen once a duel leaves `pending`; completed duels can't be modified (trigger).
- snapshots, settlements and audit logs are append-only; one settlement per duel (primary key).
- clients have **no write policy** on prices, settlements or audit logs. only the service role writes them.
- `accept_duel`, `decline_duel`, `cancel_duel` rpcs perform invite checks atomically.
- `simulated_funds` must be `true` (check constraint).

the schema, seed, rls policies, triggers and rpcs were verified against postgres 16 with stubbed `auth`/`storage` schemas.

### known limitations

| area | status |
|---|---|
| auth (email sign up/in/out, reset, update password), avatar upload | ✅ supabase in live mode, local in demo mode |
| lock / settle / cron | ✅ server-side; postgres-backed idempotency + audit when configured, in-memory in demo mode |
| social data (posts, duels, follows, comments, reactions, communities, notifications, picks) | ✅ stored in postgres in live mode, with realtime updates. tested end to end with two accounts against a local supabase stack |
| demo settlement requests | in demo mode the browser sends duel terms to `/api/duels/settle` (prices are always fetched by the server). live mode sends only the duel id |
| live-mode data loading | the client loads the latest few hundred rows of each table and reloads on any change. fine for a demo or hackathon, but it would need pagination for real traffic |
| demo time controls in live mode | duel participants can still "jump" to the lock / deadline because prices are simulated. remove them before using real market data |
| market data | only the simulated provider has been exercised. the polygon / finnhub / alpha vantage adapters are written but untested without api keys |
| `supabase/seed.sql` | generated from the time-relative seed, so its dates are fixed at generation time. rerun `npm run db:seed-sql` before seeding |
| rate limiting | in-memory per server instance |
| escrow contract | compiled and tested on a local evm, **not deployed** (needs a funded base sepolia deployer). not audited. test usdc only; real money is disabled in code and in the schema |
| embedded wallets | built and tested with the sdk's mock mode and unit tests. not yet exercised against a real cdp project (needs portal setup and keys) |

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
- missing, halted, invalid, mistimed or future-dated closes, and failed or timed-out provider requests ⇒ `needs_verification`; **no winner is declared** and nothing is recorded until data is reliable. the next run retries.

the pure engine is `src/lib/settlement/engine.ts` (`pct-return-v1`). the service (`service.ts`) runs the 11 steps (deadline check → fetch → validate source → verify timestamps → adjust splits → compute → compare → decide → record-if-absent → status → notify), is idempotent (insert-if-absent; concurrent calls store exactly one result) and writes an audit log. the browser can only *ask* to settle: it never sends prices, and in supabase mode the server loads the duel from the database and checks that the caller is a participant.

tests: `npm test` (79 tests). settlement: 27. wallets: 44 (calls, calldata decoding, every sponsorship rule, linking, intents, paymaster allow/refuse paths, receipt checks). escrow contract: 8, on a local evm with chain id 84532 (create/accept, exact approvals, bad creates, oracle-only payouts, replay, draws, group splits, refunds, and the server's oracle signature accepted onchain). wallet db: 3 more against real postgres when `WALLET_DB_TEST_*` env vars are set. the settlement suite covers the brief's examples, both rise / both fall / one up one down / flat / identical, dollar gain vs percent, group ties, dst and holidays, missing data, provider outages, trading halts, split adjustment, the shared comparison window, idempotency and concurrent settlement.

end-to-end: `npm run e2e` (playwright, against a running server; set `BASE_URL` for a deployment) drives 45 checks on a phone viewport: the full create → accept → lock → settle loop, double-tap protection, accept/decline, group beefs, rematch prefill, comments, reactions, follows, trophy cards, notifications, every leaderboard period × category, wallet activity, profiles, communities, sign out / sign up / onboarding, and cross-device invite links. it also crawls every route for console errors and horizontal overflow, and checks the service worker and offline fallback.

## wallets & sponsored gas (base sepolia only)

beef wallets are **coinbase developer platform (cdp) embedded wallets** with **smart accounts**. people sign in with an email code or google; no extension, no seed phrase. keys stay in cdp's secure enclave and are unlocked only by the user's sign-in, so wallets are user-controlled and beef can't move funds. everything onchain is **base sepolia (84532)** with **test usdc**. there is no mainnet chain object in the app, and the database refuses other chain ids.

packages (pinned): `@coinbase/cdp-hooks@0.0.130`, `@coinbase/cdp-core@0.0.130` (browser), `@coinbase/cdp-sdk@1.61.0` (server, token verification only). wagmi and the old browser-extension connect were removed. dev: `solc`, `ganache`, `@openzeppelin/contracts` for compiling and testing the escrow.

**how it fits together**
1. **sign in** (`/wallet`): `useSignInWithEmail` / `useVerifyEmailOTP` / `useSignInWithOAuth("google")`, with `ethereum.createOnLogin: "smart"`. signing in again with the same method restores the same wallet on any device. users can link email or google as extra recovery methods (`useLinkEmail`, `useLinkGoogle`).
2. **identity link**: the browser sends its cdp access token to `POST /api/wallet/link`. the server verifies it with `cdp.endUser.validateAccessToken`, takes the wallet addresses from cdp (never from the browser) and stores one row in `wallet_links`. the supabase user id, cdp user id and smart account address are each unique, so there are no duplicates. a returning user gets their existing link back.
3. **transactions**: for a duel action, `POST /api/wallet/intent` builds the exact calls on the server (create: `approve(escrow, exact stake)` + `createDuel`; accept: `approve` + `deposit`; refund; payout: `settle` with a server-signed result) and records an intent. the browser sends exactly those calls with `useSendUserOperation({ network: "base-sepolia", paymasterUrl: "/api/paymaster", paymasterContext: { intentId }, idempotencyKey: intentId })` after an explicit confirmation of the amount and spender.
4. **sponsorship** (`/api/paymaster`, erc-7677 proxy): cdp calls it server-to-server. the proxy forwards to the secret `CDP_PAYMASTER_URL` only if:
   - the chain id is 84532 and the entrypoint is known
   - the sender is a linked beef smart account
   - the operation matches an unexpired intent for that wallet, hash for hash
   - every call passes the policy:
     - only test usdc and the beef escrow
     - usdc only `approve(escrow, ≤ $25)`, and only when the same batch then calls the escrow (no dangling allowances)
     - escrow only `createDuel` / `deposit` / `refund` / `settle`
     - no eth value
   - per-user and global daily limits aren't exceeded

   every decision is logged in `sponsorship_logs`. a refusal returns an error, so an operation is never silently sent unsponsored.
5. **confirmation**: `POST /api/wallet/confirm` fetches the receipt from base sepolia and checks that:
   - the transaction succeeded
   - it contains a `UserOperationEvent` for this op hash and sender, with `success = true` and a non-zero paymaster
   - the escrow emitted the expected event for this duel

   only then is the intent marked confirmed (idempotent).

**cdp portal configuration** (portal.cdp.coinbase.com)
1. create or select a project and copy the **project id** → `NEXT_PUBLIC_CDP_PROJECT_ID`.
2. **embedded wallets → configuration**: add allowed origins `http://localhost:3000` and `https://beef-ecru.vercel.app` (and any custom domain). enable **email** and **google** sign-in.
3. **api keys**: create a secret api key → `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` (server only). no wallet secret is needed; the server never signs for users.
4. **paymaster**: select **base sepolia**, copy the endpoint → `CDP_PAYMASTER_URL` (server only). in the paymaster policy, allowlist the escrow contract and the usdc contract, restrict functions to `approve`, `createDuel`, `deposit`, `refund`, `settle`, and set per-user and global limits. this mirrors beef's own proxy policy, so both layers enforce it.
5. deploy the escrow: `npm run contracts:build && DEPLOYER_PRIVATE_KEY=… SETTLEMENT_ORACLE_ADDRESS=… npm run contracts:deploy`. the deployer needs a little base sepolia eth. then set `NEXT_PUBLIC_ESCROW_ADDRESS` and `SETTLEMENT_ORACLE_PRIVATE_KEY`.
6. supabase: run `supabase/migrations/20261127000000_wallets.sql`.
7. test usdc for users: the circle faucet (faucet.circle.com, base sepolia). sponsored gas doesn't mean free usdc, and the ui says so.

**local development**: set `NEXT_PUBLIC_CDP_MOCK=true` to use the sdk's mock mode: no project or network needed for the sign-in ui. the mock user has no smart account, so the app shows its "finish wallet setup" step, whose `createEvmSmartAccount` call the sdk doesn't mock. onchain staking needs live mode (`NEXT_PUBLIC_BACKEND=supabase`), so every participant has a verified wallet.

**security properties**
- no private keys or secrets in the browser: only the public project id. the api key, paymaster url and oracle key are server env only.
- base sepolia is enforced everywhere: client network constant, server `assertBaseSepolia`, paymaster chain check, schema `check (chain_id = 84532)`, and a deploy script that refuses other chains.
- no spend permissions (`enableSpendPermissions: false`); every financial action needs the user's explicit confirmation; approvals are for the exact stake and consumed in the same operation.
- duplicate protection: intents are deduplicated per user, duel and action; confirmations are idempotent; `idempotencyKey` is passed to cdp; escrow deposits are one per participant.
- rate limits on every wallet endpoint, plus audit logs for every sponsorship decision.

**`contracts/BeefEscrow.sol`** (unaudited, base sepolia test use only):
- creator-only `createDuel` and per-participant `deposit`
- an oracle-signed `settle` bound to the chain id and contract address (no replay), executable once
- draws refund everyone; tied winners split the pot
- `refund` after a 2-day funding window
- max stake $25, max 6 participants

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
3. `vercel.json` runs `/api/cron/settle` once a day after the us close (hobby plan limit). on pro, set it to `*/15 * * * *`, or call it from an external scheduler with the bearer token.
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
