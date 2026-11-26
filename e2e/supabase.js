// two-user end-to-end check against a real supabase (no seeded people, no demo data).
// needs a running app built with NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY pointing at a supabase
// with email confirmations off, e.g. `npx supabase start` + `npx supabase db reset`.
// usage: BASE_URL=http://localhost:3000 node e2e/supabase.js
const { chromium, devices } = require('playwright');
const B = process.env.BASE_URL || 'http://localhost:3000';
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) failures++; };
const run = Date.now().toString(36).slice(-5);
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (dev) => {
    const ctx = await browser.newContext({ ...devices[dev], deviceScaleFactor: 1 });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${dev}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(`${dev}: ${m.text().slice(0, 160)}`); });
    return p;
  };
  const see = async (p, re, t = 10000) => p.getByText(re).first().waitFor({ timeout: t }).then(() => true).catch(() => false);

  const signUp = async (p, name, { ref } = {}) => {
    if (ref) await p.goto(B + `/?ref=${ref}`, { waitUntil: 'networkidle' });
    await p.goto(B + '/auth/sign-up', { waitUntil: 'networkidle' });
    await p.getByLabel('email').fill(`${name}.${run}@example.com`);
    await p.getByLabel('password').fill('supersecret1');
    await p.getByRole('checkbox').check();
    await p.getByRole('button', { name: 'create account' }).click();
    await p.waitForURL(/onboarding/, { timeout: 15000 });
    ok(await see(p, 'step 2 of 5'), `${name}: onboarding opens at the profile step`);
    ok(await p.getByLabel('username').inputValue() === '', `${name}: no username is generated`);
    await p.getByLabel('username').fill(`${name}${run}`);
    ok(await see(p, /^available$/), `${name}: username availability check says available`);
    await p.getByLabel('display name').fill(name);
    await p.getByLabel(/bio/).fill(`${name} test account`);
    await p.getByRole('button', { name: 'continue' }).click();
    ok(await see(p, 'step 3 of 5', 15000), `${name}: profile saved, wallet step shown`);
    await p.getByRole('button', { name: 'set up my wallet later' }).click();
    await p.getByRole('button', { name: 'start exploring' }).click();
    await p.waitForURL(B + '/', { timeout: 15000 });
  };

  // guest: welcome screen, and nobody fake anywhere
  const g = await mk('iPhone 13');
  await g.goto(B + '/', { waitUntil: 'networkidle' });
  ok(await see(g, 'put your money where your mouth is.'), 'guest sees the welcome screen');
  await g.goto(B + '/leaderboard', { waitUntil: 'networkidle' });
  ok(await g.locator('a[href^="/u/"]').count() === 0, 'empty database: leaderboard has no fabricated people');
  await g.goto(B + '/duel/00000000-0000-0000-0000-000000000000', { waitUntil: 'networkidle' });
  ok(await see(g, 'duel not found'), 'unknown duel handled');

  const a = await mk('iPhone 13'), b = await mk('Pixel 7');
  await signUp(a, 'alice');
  ok(await see(a, 'hey, alice'), 'alice signed up + onboarded');
  ok(await see(a, 'your feed is looking quiet.'), 'empty feed shows the real empty state');

  // bob arrives through alice's invite link and can't take her username
  await b.goto(B + '/auth/sign-up', { waitUntil: 'networkidle' });
  await b.getByLabel('email').fill(`dupe.${run}@example.com`);
  await b.getByLabel('password').fill('supersecret1');
  await b.getByRole('checkbox').check();
  await b.getByRole('button', { name: 'create account' }).click();
  await b.waitForURL(/onboarding/, { timeout: 15000 });
  await b.getByLabel('username').fill(`alice${run}`);
  ok(await see(b, 'that username is taken'), 'duplicate username rejected live');
  ok(await b.getByRole('button', { name: 'continue' }).isDisabled(), 'cannot continue with a taken username');
  await b.getByRole('button', { name: 'sign out' }).click();
  await b.waitForURL(B + '/');
  await signUp(b, 'bob', { ref: `alice${run}` });
  ok(await see(b, 'hey, bob'), 'bob signed up via invite link + onboarded');

  // post + realtime
  await a.reload({ waitUntil: 'networkidle' });
  await a.getByRole('button', { name: /make it a prediction/ }).click();
  await a.getByLabel('post text').fill(`tsla cooks meta ${run}`);
  await a.getByRole('button', { name: 'post', exact: true }).click();
  ok(await see(a, 'prediction posted'), 'alice posted');
  ok(await see(b, `tsla cooks meta ${run}`, 15000), "bob sees alice's post live (realtime)");

  // search + follow -> notification
  await b.goto(B + '/discover', { waitUntil: 'networkidle' });
  const search = b.getByRole('searchbox').or(b.getByPlaceholder(/search/i)).first();
  await search.fill(`alice${run}`);
  ok(await see(b, `@alice${run}`), 'bob finds alice through search');
  await a.goto(B + `/u/bob${run}`, { waitUntil: 'networkidle' });
  await a.getByRole('button', { name: /^follow$/ }).first().click();
  await b.goto(B + '/notifications', { waitUntil: 'networkidle' });
  ok(await see(b, 'started following you', 15000), 'bob notified of the follow (db trigger)');

  // stake step (4 of 6): presets, custom amounts, live prize pool, wallet gating
  await a.goto(B + '/duel/new?vs=', { waitUntil: 'networkidle' });
  await a.getByLabel('search people').fill(`bob${run}`);
  await a.getByRole('button', { name: new RegExp(`bob${run}`) }).click();
  await a.getByRole('button', { name: 'continue' }).click();
  await a.getByRole('option', { name: /NVDA/ }).click();
  await a.getByRole('option', { name: /^AMD/ }).click();
  await a.getByRole('button', { name: 'continue' }).click();
  await a.getByRole('button', { name: /^NVDA/ }).click();
  await a.getByRole('button', { name: 'continue' }).click();
  ok(await see(a, 'step 4 of 6'), 'reached the stake step');
  const cards = async () => (await a.locator('.grid-cols-3.text-center .num').allInnerTexts()).join(' | ');
  for (const [v, pot] of [['1', '2.00'], ['5', '10.00'], ['10', '20.00'], ['20', '40.00'], ['25', '50.00']]) {
    await a.getByRole('button', { name: v, exact: true }).click();
    const c = await cards();
    ok(c === `${Number(v).toFixed(2)} | ${Number(v).toFixed(2)} | ${pot}` && await a.getByRole('button', { name: v, exact: true }).getAttribute('aria-pressed') === 'true', `preset ${v}: cards ${c}`);
  }
  await a.getByRole('button', { name: 'custom', exact: true }).click();
  const input = a.getByLabel('your stake');
  ok(await input.isVisible(), 'custom shows a numeric input');
  ok(await input.getAttribute('inputmode') === 'decimal' && await see(a, 'test usdc', 2000), 'input is decimal and labelled test usdc');
  await input.fill('35.50');
  ok(await cards() === '35.50 | 35.50 | 71.00', `custom 35.50 → ${await cards()}`);
  await input.fill('35.5');
  ok(await cards() === '35.50 | 35.50 | 71.00', 'custom 35.5 normalises to 35.50');
  await input.fill('150');
  ok(await cards() === '150.00 | 150.00 | 300.00', 'custom above 25: 150 → pool 300.00');
  for (const [val, msg] of [['35.555', /at most 2 decimal/], ['0', /more than zero/], ['0.50', /minimum stake is 1.00/], ['1000.01', /maximum stake is 1000.00/]]) {
    await input.fill(val);
    ok(await see(a, msg, 3000) && await cards() === '— | — | —', `rejects ${val}`);
  }
  await input.fill('');
  await input.pressSequentially('-12abc');
  ok(await input.inputValue() === '12', 'letters and minus signs can\'t be typed');
  await input.fill('35.50');
  await a.getByRole('button', { name: '10', exact: true }).click();
  ok(await cards() === '10.00 | 10.00 | 20.00', 'switch custom → preset');
  await a.getByRole('button', { name: 'custom', exact: true }).click();
  ok(await input.inputValue() === '35.50' && await cards() === '35.50 | 35.50 | 71.00', 'switch back keeps the custom amount');
  ok(await see(a, /wallets aren't switched on|connect your beef wallet|available balance/), 'wallet balance area renders under the options');
  ok(await a.getByRole('button', { name: 'continue' }).isDisabled(), 'continue blocked without a connected, funded wallet');
  ok(await a.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no horizontal overflow on mobile');
  await a.getByRole('button', { name: 'back' }).click();
  ok(await see(a, 'step 3 of 6'), 'back to step 3');
  await a.getByRole('button', { name: 'continue' }).click();
  ok(await input.inputValue() === '35.50' && await cards() === '35.50 | 35.50 | 71.00', 'stake kept across back and forward');

  // a 35.50 challenge (written the way the store writes it, since funding needs a real wallet)
  const SB = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY;
  const tok = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email: `alice.${run}@example.com`, password: 'supersecret1' }) })).json();
  const H = { apikey: ANON, authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json', prefer: 'return=minimal' };
  const bobId = (await (await fetch(`${SB}/rest/v1/profiles?select=id&username=eq.bob${run}`, { headers: H })).json())[0].id;
  const duelId = crypto.randomUUID();
  const deadline = new Date(Date.now() + 5 * 864e5).toISOString();
  const ins = await fetch(`${SB}/rest/v1/duels`, { method: 'POST', headers: H, body: JSON.stringify({ id: duelId, created_by: tok.user.id, stake: 35.5, deadline, deadline_label: 'friday', invite_expires_at: new Date(Date.now() + 47 * 3600e3).toISOString(), price_rule: 'official closes', settlement_rule: 'higher return wins' }) });
  await fetch(`${SB}/rest/v1/duel_participants`, { method: 'POST', headers: H, body: JSON.stringify({ duel_id: duelId, user_id: tok.user.id, ticker: 'NVDA', accepted: true, accepted_at: new Date().toISOString() }) });
  await fetch(`${SB}/rest/v1/duel_participants`, { method: 'POST', headers: H, body: JSON.stringify({ duel_id: duelId, user_id: bobId, ticker: 'AMD', accepted: false }) });
  ok(ins.status === 201, `database accepts a 35.50 stake (${ins.status})`);
  const bad = await fetch(`${SB}/rest/v1/duels`, { method: 'POST', headers: H, body: JSON.stringify({ created_by: tok.user.id, stake: 1000.01, deadline, deadline_label: 'x', invite_expires_at: deadline, price_rule: 'x', settlement_rule: 'x' }) });
  ok(bad.status >= 400, `database rejects 1000.01 (${bad.status})`);

  await b.goto(B + '/notifications', { waitUntil: 'networkidle' });
  ok(await see(b, /challenged you: nvda vs amd, 35\.50 test usdc each/, 15000), 'invite notification shows the exact stake');
  await b.goto(B + `/duel/${duelId}`, { waitUntil: 'networkidle' });
  ok(await see(b, /wants to beef/), 'bob sees the challenge');
  ok(await see(b, /for 35\.50 test usdc each \(prize pool 71\.00 test usdc\)/), 'opponent sees the required stake and pool before accepting');
  ok(await see(b, '35.50 test usdc each · '), 'duel header shows 35.50 each');
  ok(await b.getByRole('button', { name: /^accept/ }).count() === 0, 'no off-chain accept: joining needs the escrow');
  await b.goto(B + '/duel', { waitUntil: 'networkidle' });
  ok(await see(b, '71.00 test usdc pot'), 'duel card shows the exact pool');
  await b.goto(B + `/duel/${duelId}`, { waitUntil: 'networkidle' });
  await b.getByRole('button', { name: 'decline' }).click();
  ok(await see(b, /declined/, 15000), 'decline_duel rpc');
  await a.goto(B + '/notifications', { waitUntil: 'networkidle' });
  ok(await see(a, 'declined your challenge', 15000), 'alice notified of decline');

  // wallet page: no fake balance or transactions
  await a.goto(B + '/wallet', { waitUntil: 'networkidle' });
  ok(await a.getByText(/0x[0-9a-f]{64}/).count() === 0, 'wallet page shows no fabricated transaction hashes');
  ok(await a.locator('main').getByText('test usdc has').first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false) && await a.locator('main').getByText(/base sepolia \(chain 84532\) only/).count() === 1, 'wallet page names the network and chain 84532');

  // persistence across sign out / in
  await a.goto(B + '/profile', { waitUntil: 'networkidle' });
  await a.getByRole('button', { name: 'settings' }).click();
  await a.getByRole('button', { name: /sign out/ }).click();
  await a.waitForURL(B + '/');
  ok(await see(a, 'put your money where your mouth is.'), 'signed out');
  await a.goto(B + '/auth/sign-in', { waitUntil: 'networkidle' });
  await a.getByLabel('email').fill(`alice.${run}@example.com`);
  await a.getByLabel('password').fill('supersecret1');
  await a.getByRole('button', { name: 'sign in' }).click();
  ok(await see(a, 'hey, alice', 15000), 'signed back in, straight to home (onboarding remembered)');
  await a.goto(B + '/duel', { waitUntil: 'networkidle' });
  ok(await a.locator('a[href^="/duel/"]').count() >= 1, "alice's duel persisted");

  console.log(`\npage errors: ${errors.length ? errors.join(' | ') : 'none'}\nfailures: ${failures}`);
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message.split('\n').slice(0, 4).join(' ')); process.exit(1); });
