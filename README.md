# beef

**put your money where your mouth is.**

beef is a mobile-first social stock competition app. friends challenge each other over which stock will perform better, post predictions, build rivalries and climb a leaderboard. it's an installable pwa (iphone + android), built with next.js, supabase and coinbase developer platform embedded wallets on **base sepolia**.

> **stakes are real base sepolia test usdc, held by an escrow contract. test usdc has no monetary value.** stock prices come from chainlink (data feeds on base mainnet by default, read-only). there's no mainnet anywhere in the app, and real money stays off.

there is **no demo mode** and no seeded people. every user, post, follow and duel comes from a real registered account, and every balance and transaction is read from base sepolia. without supabase configured, the app shows a setup screen instead of fake content.

---

## quick start

```bash
npm install
npx supabase start               # needs docker; applies migrations + reference data from ./supabase
# copy API_URL / ANON_KEY / SERVICE_ROLE_KEY from `npx supabase status` into .env.local (see below)
npm run build && npm start       # http://localhost:3000
```

| command | what it does |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build (type-checks) |
| `npm start` | serve the production build |
| `npm test` | settlement, wallet policy, paymaster, intent, identity-binding and escrow tests (vitest; the escrow runs on a local evm with chain id 84532) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:seed-sql` | regenerate `supabase/seed.sql` (reference data only: the stock list and achievement definitions) |
| `npm run contracts:build` / `contracts:deploy` | compile / deploy `BeefEscrow` to base sepolia |
| `BASE_URL=… node e2e/supabase.js` | two-user browser test against a running app + supabase |

> don't run `next dev` and `next start` from the same folder at the same time. they share `.next/`.

## onboarding

1. **welcome** (`/welcome`, and the home page for guests): what beef is, *get started*, *i already have an account*.
2. **account** (`/auth/sign-up`, `/auth/sign-in`): email + password or google (supabase auth), 18+ confirmation, password reset (`/auth/reset` → `/auth/update-password`). sessions persist across reloads; sign out is in profile → settings.
3. **profile**: a username the person types (nothing is generated) with a live availability check (`username_available` rpc, reserved names blocked), display name, optional photo (resized and uploaded to the `avatars` bucket) and bio. all editable later at `/profile/edit`.
4. **wallet**: creates or restores the person's cdp embedded wallet (one per beef account) and links it server-side. can be skipped and done later at `/wallet`.
5. **fund**: shows the wallet address with copy, a link to the circle faucet, a refresh button and a waiting state that polls base sepolia. beef never requests faucet funds itself and never claims tokens arrived until they show up onchain.
6. **done**: the real onchain balance and what to do next.

signed-in people without a profile, or who haven't finished onboarding, are sent back to the step they left. `?ref=<username>` invite links are remembered and stored as `profiles.referred_by`.

## environment variables

copy `.env.example` → `.env.local`.

| variable | required | notes |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | prod | canonical url, used for share links and metadata |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | without it (and the anon key) the app shows a setup screen |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | public anon key (rls applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **server only**. settlement, cron, wallet links and escrow-state updates. never prefix with `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_CDP_PROJECT_ID` | for wallets | public cdp project id. blank = wallets off (the app says so) |
| `NEXT_PUBLIC_CDP_AUTH` | for wallets | `supabase` (the beef login is the wallet login, via cdp custom auth) or `cdp` (cdp email code / google with the same email as the beef account). see below |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | for wallets | **server only**. verifies cdp end-user access tokens |
| `CDP_PAYMASTER_URL` | for gas | **server only**. base sepolia paymaster endpoint; the browser only sees `/api/paymaster` |
| `NEXT_PUBLIC_ESCROW_ADDRESS` | for stakes | deployed `BeefEscrow`. blank = stakes can't be locked (the app says so) |
| `NEXT_PUBLIC_STAKE_MIN_USDC` / `NEXT_PUBLIC_STAKE_MAX_USDC` | no | stake limits per participant (default 1 / 1000 test usdc). must match the escrow's immutable `minStake` / `maxStake` and `duels_stake_check`; `/api/wallet/status` → `stakeLimits.match` |
| `SETTLEMENT_ORACLE_PRIVATE_KEY` | for stakes | **server only**. signs joins and results; its address is the escrow's oracle |
| `BASE_SEPOLIA_RPC_URL` | no | server rpc (default `https://sepolia.base.org`) |
| `SPONSOR_PER_USER_DAILY` / `SPONSOR_GLOBAL_DAILY` | no | sponsorship limits (default 10 / 500 operations a day) |
| `CHAINLINK_DS_API_KEY` / `CHAINLINK_DS_USER_SECRET` | for prices | **server only**. chainlink data streams credentials. without them, no prices, locks or settlements |
| `CHAINLINK_DS_NETWORK` | no | `testnet` (default, verifiable on base sepolia) or `mainnet` |
| `CRON_SECRET` | prod | bearer token for `/api/cron/settle` (vercel sends it automatically) |
| `NEXT_PUBLIC_CDP_MOCK` | no | `true` = the cdp sdk's mock mode for local ui work (no real wallet) |

## supabase setup

1. create a supabase project (or vercel → storage → supabase). put the url, anon key and service role key in the env.
2. apply the migrations in order (sql editor, or `npx supabase db push`):
   `20261125000000_beef_schema.sql`, `20261126000000_social_triggers.sql`, `20261127000000_wallets.sql`, `20261128000000_real_users.sql`, `20261129000000_custom_stakes.sql` (or paste `supabase/setup.sql`, which bundles them all). then run `supabase/seed.sql` (stocks and achievements only, no people).
3. **authentication → url configuration**: site url = your app url; redirect urls `<url>/onboarding` and `<url>/auth/update-password`.
4. **authentication → providers → google** (optional): add a google oauth client id and secret, with supabase's callback url as the authorised redirect uri in google cloud. until it's enabled, the google button explains that it's switched off.
5. storage: the schema creates a public `avatars` bucket where each user can only write their own file.

**how the data works**
- the client loads from postgres (rls decides what each person can see), writes social actions directly, and reloads when realtime reports a change.
- profiles are created only by the person during onboarding (the old auto-profile trigger is gone, so no generated usernames).
- money state is **never** written by the browser. `duels.escrow_state` (`unfunded → funded → active → settled/refunded`), `funded_at`, `escrow_tx` and `duel_participants.join_tx` change only through the service-role rpcs `set_escrow_state` and `accept_duel_for`, called after the server verifies the transaction receipt on base sepolia. users can't call `accept_duel` any more; joining a duel *is* the onchain deposit.
- duels are created `unfunded` (stake 1–1000 test usdc in whole cents, `funding = 'base_sepolia_usdc'`), and nobody can join until the creator's stake is in the escrow.
- terms are frozen once a duel leaves `pending`; snapshots, settlements and audit logs are append-only and service-role only.

### known limitations

| area | status |
|---|---|
| auth, profiles, social, notifications, realtime | ✅ tested end to end with two real accounts against a local supabase (34 checks, `e2e/supabase.js`) |
| escrow contract | ✅ tested on a local evm with chain id 84532 (create with open slots, oracle-authorised joins, stranger rejection, payout once, draw, group split, refund window). **not yet deployed** to base sepolia (needs a funded deployer). unaudited |
| cdp wallets + sponsored gas | ✅ unit-tested (policy, paymaster proxy, intents, receipt verification, identity binding). not yet exercised against a live cdp project from this environment |
| stock prices | chainlink data streams only. retrieval, decoding, session switching and settlement are unit-tested on synthetic v11 fixtures. **not yet run against chainlink's live api**: needs data streams credentials |
| data loading | the client loads the latest few hundred rows of each table; it needs pagination for real traffic |
| rate limiting | in-memory per server instance |

## stock prices: chainlink

beef gets stock prices only from chainlink, from one of two sources picked by `CHAINLINK_PRICE_SOURCE`:

### data feeds (default, free)
chainlink data feeds for **coinbase tokenized stocks on base mainnet (8453)**, per [base's docs](https://docs.base.org/build-on-base/integrate-defi/list-tokenized-stocks). beef only **reads** them (`latestRoundData` / `getRoundData`). there's no api key, it costs nothing, and beef never sends a mainnet transaction. escrow and stakes stay on base sepolia.

| ticker | chainlink feed (base mainnet) | token |
|---|---|---|
| NVDA | `0x04689a41629776563E6822F76f2e57D148d28513` | NVDAc |
| AAPL | `0x787f13dEa48Db0897CbCDD985de77809D837F988` | AAPLc |
| TSLA | `0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4` | TSLAc |
| MSFT | `0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c` | MSFTc |
| AMZN | `0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295` | AMZNc |
| GOOGL | `0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2` | GOOGLc |
| META | `0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D` | METAc |

- **where the addresses come from:** coinbase's public `GET /v1/tokenized-stocks/nav-feeds` and `/v1/tokenized-stocks`, retrieved 2026-11-26. at runtime each feed must answer `description() = "Coinbase <TICKER>"` and `decimals() = 8`, or it isn't used.
- **what the feeds are:**
  - total-return values (price × a multiplier that absorbs dividends and splits)
  - update on a 0.5% move or a 24-hour heartbeat during market hours
  - frozen off-hours and during corporate actions
- **methodology `chainlink_data_feeds_total_return_v1`** (`src/lib/chainlink/feeds.ts`):
  - start and end price = the latest feed round updated at or before the official close (4pm et, 1pm on early closes) of the lock and deadline sessions, the same timestamps for both stocks
  - it pauses if no round exists, the value isn't positive, or the round is more than 25 hours old (frozen, halted or stale)
  - splits aren't adjusted again; a move of 40% or more pauses settlement for a manual check
  - **precision:** a "close" can differ from the exchange close by up to about 0.5%, because of the feeds' deviation threshold
- **evidence:** each snapshot stores the feed address, round id, value, update time and a round hash, marked `onchain` (read directly from chainlink's contract; there's no signed report to verify).

### data streams (optional, paid)

the data streams source uses **chainlink data streams, 24/5 us equities** (rwa advanced v11 schema), via the official sdk `@chainlink/data-streams-sdk@2.0.0`. the simulated provider and the polygon / finnhub / alpha vantage adapters are gone. supported tickers: NVDA, AAPL, TSLA, MSFT, AMZN, GOOGL, META. without data streams credentials the app shows "price unavailable" and nothing locks or settles. nothing is estimated.

**what was checked in chainlink's docs (2026-11-26)**
- each stock has three v11 streams (regular, extended, overnight). the regular stream's `marketStatus` (0 unknown · 1 pre · 2 regular · 3 post · 4 overnight · 5 closed) decides which one to read.
- base sepolia (84532) has a data streams **verifier proxy, `0x8Ac491b7c118a0cdcF048e0f707247fD8C9575f9`**, from chainlink's supported-networks table. onchain it answers `typeAndVersion() = "VerifierProxy 2.0.0"`, `s_accessController = 0x0` (anyone may call) and `s_feeManager = 0x72790f9eB82db492a7DDb6d2af22A270Dcc3Db64`. chainlink's docs say every report type, v11 included, shares these verifier addresses.
- stream ids come from chainlink's rwa stream directory (`src/lib/chainlink/directory.ts`, testnet and mainnet "-production" entries). they're a **cross-check only**.

**discovery** (`POST /api/chainlink/discover`, bearer `CRON_SECRET`): calls the sdk's `listFeeds()` (`GET /api/v1/feeds`) and keeps a ticker only if its regular, extended and overnight streams are all accessible, are v11, are named for that ticker and session, and match chainlink's directory exactly. results go to `price_streams`, and a ticker missing any stream is unavailable. `GET /api/chainlink/status` shows what's configured.

**live prices** (`/api/market/quotes`, display only): the latest regular-hours report, then the extended or overnight stream when `marketStatus` says so, showing the `mid`. a quote shows as **live** only if the mid updated within 5 minutes. otherwise it's **stale**. **closed** shows the last regular-hours mid, labelled as closed. **unknown** shows no price. zero or crossed quotes are rejected. the duel page shows price, return, session, last update and the chainlink source.

**settlement methodology `chainlink_regular_hours_mid_v1`** (`src/lib/chainlink/prices.ts`, `src/lib/settlement/service.ts`)
- start = the lock session (first close after everyone joined); end = the deadline session (weekends and holidays roll back, early closes use 1pm).
- for each stock: `getReportByTimestamp(regularStream, close − 1s)`, decoded with the sdk's `decodeReport`. both stocks use the same two timestamps.
- a report counts only if:
  - it's observed at that timestamp
  - `marketStatus = 2`
  - the mid is positive
  - the quote isn't crossed or wider than 2%
  - the mid updated within 120 s (a halt or outage shows up here)
  - **chainlink's verifier proxy accepts its signatures**
- starting snapshots are locked at activation and are append-only.
- splits come from the `corporate_actions` table and are applied exactly (start × den / num). a move of 40% or more with no recorded action pauses settlement as a possible unrecorded split.
- return = (end − start) / start × 100 in bigint (`pct-return-v2`), compared at 0.0001 points, so equal returns draw.
- any failed check → `needs_verification` with reasons and no winner. one settlement per duel (insert-if-absent), with every step in the audit log.

**verification, stated exactly**: beef calls chainlink's `VerifierProxy.verify(fullReport, "")` on base sepolia as a **read-only `eth_call`**. chainlink's contract checks the DON signatures and returns the verified report, and beef checks it matches the decoded one, but **no verification transaction is recorded**. first `getVerifier(configDigest)` confirms the report's DON config is registered. results are stored with each report as `chainlink_verifier_proxy_eth_call`. the verifier has a fee manager set; per chainlink's docs billing is subscription-based with empty fee metadata, but that's unconfirmed until a real signed report is run. a revert means not verified and pauses settlement. there's no setting that skips verification.

**escrow binding**: the payout's `settlementHash` is `settlementAttestation()` (`src/lib/chainlink/attestation.ts`): one keccak over duel id, participant wallets, tickers, stream ids, exact start and end prices, observation timestamps, signed report hashes, comparison window, winners or draw, calculation version and methodology. beef's settlement signer signs it with chain id, escrow, duel, terms hash and winners, and `BeefEscrow.settle` checks that signature, pays once and rejects replays. **this signature is beef's, not chainlink's.** chainlink's guarantee is the verified reports, which anyone can re-check from `price_reports.full_report`. no contract change was needed. the escrow doesn't call the verifier itself, which would be a later step once fees and gas are confirmed with real reports.

**storage** (`supabase/migrations/20261130000000_chainlink.sql`)
- `price_streams`: verified config.
- `price_reports`: every signed report a lock or settlement used, with metadata and the verification result. append-only, service-role only.
- `corporate_actions`
- snapshot columns: price_e18, stream_id, observations_ts, market_status, report_hash, verification
- `duels.settle_tx`

## wallets & sponsored gas (base sepolia only)

beef wallets are **coinbase developer platform (cdp) embedded wallets** with **smart accounts**. people sign in with an email code or google; no extension, no seed phrase. keys stay in cdp's secure enclave and are unlocked only by the user's sign-in, so wallets are user-controlled and beef can't move funds. everything onchain is **base sepolia (84532)** with **test usdc**. there is no mainnet chain object in the app, and the database refuses other chain ids.

packages (pinned): `@coinbase/cdp-hooks@0.0.130`, `@coinbase/cdp-core@0.0.130` (browser), `@coinbase/cdp-sdk@1.61.0` (server, token verification only). wagmi and the old browser-extension connect were removed. dev: `solc`, `ganache`, `@openzeppelin/contracts` for compiling and testing the escrow.

**how it fits together**
1. **sign in**: with `NEXT_PUBLIC_CDP_AUTH=supabase`, the provider's `customAuth.getJwt` hands cdp the person's supabase access token, so the beef login *is* the wallet login (`useAuthenticateWithJWT`); with `cdp`, people use `useSignInWithEmail` / `useVerifyEmailOTP` / `useSignInWithOAuth("google")` with the same email as their beef account. `ethereum.createOnLogin: "smart"` creates a smart account; signing in again restores the same wallet on any device.
2. **identity link**: the browser sends its cdp access token to `POST /api/wallet/link`. the server verifies it with `cdp.endUser.validateAccessToken`, takes the wallet addresses from cdp (never from the browser), checks the cdp identity belongs to the signed-in beef user (custom-auth `sub` = supabase user id, otherwise a cdp email = the beef account email) and stores one row in `wallet_links`. the supabase user id, cdp user id and smart account address are each unique, so there are no duplicates. a returning user gets their existing link back.
3. **transactions**: for a duel action, `POST /api/wallet/intent` builds the exact calls on the server (create: `approve(escrow, exact stake)` + `createDuel` with the opponents' seats left open; accept: `approve` + `join` with a server-signed join authorisation for that exact person and duel; refund; payout: `settle` with a server-signed result) and records an intent. the browser sends exactly those calls with `useSendUserOperation({ network: "base-sepolia", paymasterUrl: "/api/paymaster", paymasterContext: { intentId }, idempotencyKey: intentId })` after an explicit confirmation of the amount and spender.
4. **sponsorship**: by default the browser sends with `useCdpPaymaster: true`, and the cdp portal's paymaster policy (contract allowlist: usdc `approve`, escrow `createDuel` / `join` / `refund` / `settle`; per-user and global limits) decides what's sponsored. cdp rejected a custom `paymasterUrl` pointing at the app itself, so beef's own erc-7677 proxy (`/api/paymaster`) is kept as an opt-in (`NEXT_PUBLIC_PAYMASTER=proxy`). in proxy mode cdp calls it server-to-server. the proxy forwards to the secret `CDP_PAYMASTER_URL` only if:
   - the chain id is 84532 and the entrypoint is known
   - the sender is a linked beef smart account
   - the operation matches an unexpired intent for that wallet, hash for hash
   - every call passes the policy:
     - only test usdc and the beef escrow
     - usdc only `approve(escrow, min stake ≤ amount ≤ max stake)`, and only when the same batch then calls the escrow (no dangling allowances)
     - escrow only `createDuel` / `join` / `refund` / `settle`
     - no eth value
   - per-user and global daily limits aren't exceeded

   every decision is logged in `sponsorship_logs`. a refusal returns an error, so an operation is never silently sent unsponsored.
5. **confirmation**: `POST /api/wallet/confirm` fetches the receipt from base sepolia and checks that:
   - the transaction succeeded
   - it contains a `UserOperationEvent` for this op hash and sender, with `success = true` and a non-zero paymaster
   - the escrow emitted the expected event for this duel

   only then is the intent marked confirmed (idempotent), and only then does the database's `escrow_state` change.

**cdp portal configuration** (portal.cdp.coinbase.com)
1. create or select a project and copy the **project id** → `NEXT_PUBLIC_CDP_PROJECT_ID`.
   - for `NEXT_PUBLIC_CDP_AUTH=supabase`, configure **custom authentication** with your supabase project's jwks url (`https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`) and issuer (`https://<project-ref>.supabase.co/auth/v1`), user identifier claim `sub`. cdp requires rs256 or es256, so the supabase project must use asymmetric jwt signing keys (supabase → project settings → jwt keys), not the legacy shared secret. a local supabase isn't reachable by cdp, so use `cdp` mode locally.
2. **embedded wallets → configuration**: add allowed origins `http://localhost:3000` and `https://beef-ecru.vercel.app` (and any custom domain). enable **email** and **google** sign-in.
3. **api keys**: create a secret api key → `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` (server only). no wallet secret is needed; the server never signs for users.
4. **paymaster**: select **base sepolia**, copy the endpoint → `CDP_PAYMASTER_URL` (server only). in the paymaster policy, allowlist the escrow contract and the usdc contract, restrict functions to `approve`, `createDuel`, `join`, `refund`, `settle`, and set per-user and global limits. this mirrors beef's own proxy policy, so both layers enforce it.
5. deploy the escrow: `npm run contracts:build && DEPLOYER_PRIVATE_KEY=… SETTLEMENT_ORACLE_ADDRESS=… npm run contracts:deploy`. the deployer needs a little base sepolia eth. then set `NEXT_PUBLIC_ESCROW_ADDRESS` and `SETTLEMENT_ORACLE_PRIVATE_KEY`.
7. test usdc for users: the circle faucet (faucet.circle.com, base sepolia). sponsored gas doesn't mean free usdc, and the ui says so.

**local development**: `NEXT_PUBLIC_CDP_MOCK=true` uses the sdk's mock mode for the sign-in ui only. the mock user has no smart account and nothing real can be sent; balances and transactions are only ever read from base sepolia.

**security properties**
- no private keys or secrets in the browser: only the public project id. the api key, paymaster url and oracle key are server env only.
- base sepolia is enforced everywhere: client network constant, server `assertBaseSepolia`, paymaster chain check, schema `check (chain_id = 84532)`, and a deploy script that refuses other chains.
- no spend permissions (`enableSpendPermissions: false`); every financial action needs the user's explicit confirmation; approvals are for the exact stake and consumed in the same operation.
- duplicate protection: intents are deduplicated per user, duel and action; confirmations are idempotent; `idempotencyKey` is passed to cdp; escrow deposits are one per participant.
- rate limits on every wallet endpoint, plus audit logs for every sponsorship decision.

**`contracts/BeefEscrow.sol`** (unaudited, base sepolia test use only):
- `createDuel` by the creator (unknown opponents are open `address(0)` seats), and `join(duelId, oracleSig)`: the oracle signs `keccak256("beef.join", chainid, escrow, duelId, who)`, so only the invited person (or a beef user taking a public challenge) can take a seat
- an oracle-signed `settle` bound to the chain id and contract address (no replay), executable once
- draws refund everyone; tied winners split the pot
- `refund` after a 2-day funding window
- stake limits set at deploy (`minStake` / `maxStake`, immutable; beef deploys 1–1000 test usdc), max 6 participants
- every participant deposits exactly the duel's stake (`transferFrom(…, stake)`), so the pot is stake × participants

**stakes.** the stake step offers 1, 5, 10, 20, 25 or a custom amount (up to 2 decimals). under the options it shows the creator's real base sepolia usdc balance (circle's usdc contract, read through viem), with refresh, a faucet link and copy-address when it's short; continue stays disabled until the wallet is connected and holds enough. all amounts are bigint base units (`src/lib/stake.ts`, viem `parseUnits` / `formatUnits`), never float math. the same limits are enforced in the ui, the store, the intent api, the paymaster policy, the database check and the contract, and the confirm step checks the escrow's `Created` event carries exactly the stake shown.

**escrow versions.** new duels open on `NEXT_PUBLIC_ESCROW_ADDRESS`. earlier escrows stay in `PREVIOUS_ESCROWS` (`src/lib/chain/config.ts`) so duels already funded there can still settle or refund; the app finds a duel's escrow by reading each known escrow onchain.
  - `0xAe3a647029a7A3Fedf10F12dC7bbd098a5bf9F88`: first deployment, fixed 25 usdc cap (still holds the first test duel)
  - `0x760cfec066c424deef2bcb54ac2ce287d9ba0eff`: configurable limits, 1–1000 test usdc

## light & dark mode

- **choices:** light, dark or system, in profile → settings → appearance. There's also a toggle in the mobile header, the desktop sidebar, and the welcome, sign-in and onboarding screens.
- **colours:** every colour is a css variable (`src/app/globals.css`) that tailwind reads (`rgb(var(--x) / alpha)`), so components carry no per-theme classes.
  - light is the original palette, unchanged
  - dark is charcoal (`#121214` background, `#1C1C1F` cards) with the same orange
  - green, red and grey keep their meanings in both themes, and returns always show a +/− sign, so they don't rely on colour alone
- **no flash:** a small script in `<head>` (`src/lib/theme-script.ts`) applies the saved choice before first paint, so there's no flash and no hydration mismatch.
- **persistence:** the choice is saved in `localStorage` (works signed out). When signed in, it's also saved in the supabase user's metadata, so a new device picks it up.
- **browser chrome:** `theme-color` meta tags follow the device, or the explicit choice. the manifest's colours are static (light) by spec.
- **ios pwa:** the status bar style stays `default`.

## pwa

- `src/app/manifest.ts`: standalone display, theme/background colours, 192/512 + maskable icons, shortcuts.
- `public/sw.js`: precaches the shell + `/offline`, cache-first for hashed static assets, network-first for pages. **never caches `/api/*`** or per-user pages.
- ios: `apple-mobile-web-app-capable`, status bar style, apple touch icon, `viewport-fit=cover` with safe-area padding.
- install prompt appears after ~20s, uses `beforeinstallprompt` on android/chrome, shows a share → add to home screen guide on ios, hides in standalone mode and backs off for a week after a dismissal. also available in profile → settings.

**install on iphone**: open the site in safari → share → *add to home screen*.
**install on android**: open in chrome → *install app* (or the in-app prompt).

## deploy to vercel

1. push the repo to github and import it in vercel (framework: next.js, defaults are fine).
2. add env vars from the table above (at minimum supabase, `NEXT_PUBLIC_APP_URL` and `CRON_SECRET`; add the cdp, paymaster, escrow and oracle vars for wallets and stakes).
3. `vercel.json` runs `/api/cron/settle` once a day after the us close (hobby plan limit). on pro, set it to `*/15 * * * *`, or call it from an external scheduler with the bearer token.
4. add your custom domain in vercel → domains, then update `NEXT_PUBLIC_APP_URL` and the supabase redirect urls.

the rate limiter in `src/lib/server/rate-limit.ts` is in-memory per instance; swap in redis/upstash for multi-instance production.

## project layout

```
src/
  app/                    routes (welcome, onboarding, home, discover, duel, leaderboard, profile, wallet, auth…)
    api/                  market data, duels/lock + settle, cron/settle, wallet/{link,intent,confirm,status,activity}, paymaster
  components/             shell, cards, social, welcome, onboarding, share cards, install prompt
    wallet/               cdp provider, wallet hook, wallet panel, onboarding wallet steps, duel funding
  lib/
    market/               supported tickers + market calendar (holidays, early closes, dst)
    chainlink/            data streams config, directory cross-check, discovery, v11 decoding, market status, prices, verifier, attestation
    settlement/           pure engine, settlement service, tests
    chain/                base sepolia constants (chain id, rpc, explorer, usdc, faucet)
    wallet/               call builders, sponsorship policy, escrow abi, tests
    server/               cdp verification, wallet service + repo, paymaster proxy, oracle signer
    supabase/             browser/server/admin clients, settlement repository
    backend/              maps database rows to app types
    store/                client store backed by supabase + realtime
supabase/                 migrations + reference seed (stocks, achievements)
contracts/                BeefEscrow.sol + compiled output
e2e/                      two-user browser test
```

## responsible design

18+ confirmation at sign-up and onboarding, country capture for future eligibility checks, explicit terms checkbox before creating or accepting any duel, configurable stake limits (1–1000 test usdc by default), a beef score that ignores stake size, a chainlink source label and live/stale/closed status on every price, testnet labels on balances, a full risk disclosure at `/rules#risk`, and rate limits on duel, comment, post and settlement actions.
