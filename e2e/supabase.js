// two-user end-to-end check for supabase mode (needs a running app built with NEXT_PUBLIC_BACKEND=supabase
// against a supabase with email confirmations off, e.g. `npx supabase start`). usage: BASE_URL=http://localhost:3000 node e2e/supabase.js
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
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${dev}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(`${dev}: ${m.text().slice(0, 160)}`); });
    return p;
  };
  const see = async (p, re, t = 10000) => p.getByText(re).first().waitFor({ timeout: t }).then(() => true).catch(() => false);
  const signUp = async (p, name) => {
    await p.goto(B + '/auth/sign-up', { waitUntil: 'networkidle' });
    await p.getByLabel('email').fill(`${name}.${run}@example.com`);
    await p.getByLabel('password').fill('supersecret1');
    await p.getByRole('checkbox').check();
    await p.getByRole('button', { name: 'create account' }).click();
    await p.waitForURL(/onboarding/, { timeout: 15000 });
    await p.getByLabel('username').fill(`${name}${run}`);
    await p.getByLabel('display name').fill(name);
    await p.getByRole('button', { name: 'continue' }).click();
    await p.getByRole('button', { name: 'continue' }).click();
    await p.getByRole('button', { name: 'NVDA' }).click();
    await p.getByRole('button', { name: 'continue' }).click();
    await p.getByRole('button', { name: 'continue' }).click();
    await p.getByLabel('where do you live?').selectOption('united kingdom');
    await p.getByRole('checkbox').check();
    await p.getByRole('button', { name: "let's beef" }).click();
    await p.waitForURL(B + '/');
  };

  // guest sees database content
  const g = await mk('iPhone 13');
  await g.goto(B + '/', { waitUntil: 'networkidle' });
  ok(await see(g, 'welcome to beef'), 'guest home renders');
  ok(await see(g, /i think nvda will outperform msft/), 'guest reads seeded posts from postgres');
  await g.goto(B + '/duel/' + '00000000-0000-0000-0000-000000000000', { waitUntil: 'networkidle' });
  ok(await see(g, 'duel not found'), 'unknown duel handled');

  const a = await mk('iPhone 13'), b = await mk('Pixel 7');
  await signUp(a, 'alice'); ok(await see(a, 'hey, alice'), 'alice signed up + onboarded');
  await signUp(b, 'bob'); ok(await see(b, 'hey, bob'), 'bob signed up + onboarded');

  // post + realtime
  await a.getByRole('button', { name: /make it a prediction/ }).click();
  await a.getByLabel('post text').fill(`tsla cooks meta ${run}`);
  await a.getByRole('button', { name: 'post', exact: true }).click();
  ok(await see(a, 'prediction posted'), 'alice posted');
  ok(await see(b, `tsla cooks meta ${run}`, 15000), 'bob sees alice\'s post live (realtime)');

  // follow -> notification
  await a.goto(B + `/u/bob${run}`, { waitUntil: 'networkidle' });
  await a.getByRole('button', { name: /^follow$/ }).first().click();
  await b.goto(B + '/notifications', { waitUntil: 'networkidle' });
  ok(await see(b, 'started following you', 15000), 'bob notified of the follow (db trigger)');

  // duel: alice challenges bob
  await a.goto(B + `/duel/new?vs=`, { waitUntil: 'networkidle' });
  await a.getByLabel('search people').fill(`bob${run}`);
  await a.getByRole('button', { name: new RegExp(`bob${run}`) }).click();
  await a.getByRole('button', { name: 'continue' }).click();
  await a.getByRole('option', { name: /NVDA/ }).click();
  await a.getByRole('option', { name: /^AMD/ }).click();
  await a.getByRole('button', { name: 'continue' }).click();
  await a.getByRole('button', { name: /^NVDA/ }).click();
  await a.getByRole('button', { name: 'continue' }).click();
  await a.getByRole('button', { name: '$5', exact: true }).click();
  for (let i = 0; i < 2; i++) await a.getByRole('button', { name: 'continue' }).click();
  await a.getByRole('checkbox').check();
  await a.getByRole('button', { name: /send challenge/ }).click();
  ok(await see(a, 'challenge sent'), 'duel saved to postgres');
  ok(await a.getByText('simulate acceptance').count() === 0, 'no demo-only buttons in live mode');
  const link = await a.locator('p.font-mono').innerText();
  ok(/\/duel\/[0-9a-f-]{36}$/.test(link), 'invite link points at the database duel');

  await b.goto(B + '/notifications', { waitUntil: 'networkidle' });
  ok(await see(b, /challenged you: nvda vs amd/, 15000), 'bob gets the invite notification (db trigger)');
  await b.goto(link, { waitUntil: 'networkidle' });
  ok(await see(b, /wants to beef/), 'bob sees the challenge');
  await b.getByRole('checkbox').check();
  await b.getByRole('button', { name: /accept ·/ }).click();
  ok(await see(b, 'locks at the close'), 'accept_duel rpc -> accepted');
  await a.goto(B + '/notifications', { waitUntil: 'networkidle' });
  ok(await see(a, 'accepted your challenge', 15000), 'alice notified of acceptance');

  // server-side lock + settle from the database
  await b.getByRole('button', { name: 'jump to price lock' }).click();
  ok(await see(b, 'time left', 15000), 'server locked prices from db duel');
  await b.getByRole('button', { name: /jump to deadline/ }).click();
  ok(await see(b, 'how the winner was decided', 15000), 'server settled from db duel');
  const expl = await b.locator('text=/returned .* (wins by|draw)/').first().innerText().catch(() => '');
  console.log('     ', expl);
  ok(await see(b, 'settlement audit log'), 'audit log loaded from db');
  await a.goto(link, { waitUntil: 'networkidle' });
  ok(await see(a, 'how the winner was decided', 15000), 'alice sees the same settled result');

  // comment on the duel -> alice notified
  await b.getByRole('textbox', { name: 'comment' }).fill(`gg ${run}`);
  await b.getByRole('button', { name: 'send' }).click();
  ok(await see(a, `gg ${run}`, 15000), 'duel comment appears for alice live');

  // decline flow
  await a.goto(B + `/duel/new?vs=`, { waitUntil: 'networkidle' });
  await a.getByLabel('search people').fill(`bob${run}`);
  await a.getByRole('button', { name: new RegExp(`bob${run}`) }).click();
  await a.getByRole('button', { name: 'continue' }).click();
  await a.getByRole('option', { name: /^KO/ }).click(); await a.getByRole('option', { name: /^JPM/ }).click();
  await a.getByRole('button', { name: 'continue' }).click(); await a.getByRole('button', { name: /^KO/ }).click();
  for (let i = 0; i < 3; i++) await a.getByRole('button', { name: 'continue' }).click();
  await a.getByRole('checkbox').check(); await a.getByRole('button', { name: /send challenge/ }).click();
  await see(a, 'challenge sent');
  const link2 = await a.locator('p.font-mono').innerText();
  await b.goto(link2, { waitUntil: 'networkidle' });
  await b.getByRole('button', { name: 'decline' }).click();
  ok(await see(b, 'declined · nothing was staked', 15000), 'decline_duel rpc');
  await a.goto(B + '/notifications', { waitUntil: 'networkidle' });
  ok(await see(a, 'declined your challenge', 15000), 'alice notified of decline');

  // leaderboard + persistence across sign out / in
  await a.goto(B + '/leaderboard', { waitUntil: 'networkidle' });
  ok(await a.locator('main').getByText(/^alice/).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false), 'alice ranked from real db results');
  await a.goto(B + '/profile', { waitUntil: 'networkidle' });
  await a.getByRole('button', { name: 'settings' }).click();
  await a.getByRole('button', { name: /sign out/ }).click();
  await a.waitForURL(B + '/');
  ok(await see(a, 'welcome to beef'), 'signed out');
  await a.goto(B + '/auth/sign-in', { waitUntil: 'networkidle' });
  ok(await a.getByText('continue with the demo account').count() === 0, 'no demo account button in live mode');
  await a.getByLabel('email').fill(`alice.${run}@example.com`);
  await a.getByLabel('password').fill('supersecret1');
  await a.getByRole('button', { name: 'sign in' }).click();
  ok(await see(a, 'hey, alice', 15000), 'signed back in');
  await a.goto(B + '/duel', { waitUntil: 'networkidle' });
  ok(await a.locator('a[href^="/duel/"]').count() >= 2, 'alice\'s duels persisted');

  // community join persists
  await b.goto(B + '/communities/ai-stocks', { waitUntil: 'networkidle' });
  await b.getByRole('button', { name: 'join' }).click();
  await b.reload({ waitUntil: 'networkidle' });
  ok(await see(b, 'joined ✓'), 'community membership persisted');

  console.log(`\npage errors: ${errors.length ? errors.join(' | ') : 'none'}\nfailures: ${failures}`);
  await browser.close();
})().catch((e) => { console.error('CRASH', e.message.split('\n').slice(0, 4).join(' ')); process.exit(1); });
