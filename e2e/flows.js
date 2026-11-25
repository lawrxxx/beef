// end-to-end check. usage: BASE_URL=http://localhost:3000 node e2e/flows.js [shots-dir]
// needs playwright with chromium available (npm i -D playwright && npx playwright install chromium).
const { chromium, devices } = require('playwright');
const B = (process.env.BASE_URL || 'http://localhost:3000');
const SHOTS = (process.argv[2] || require('os').tmpdir()) + '/shots';
let failures = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'} ${msg}`); if (!c) failures++; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
  const toast = async (re) => { try { await page.getByText(re).first().waitFor({ timeout: 8000 }); return true; } catch { return false; } };

  // ---- 1. create duel end-to-end (new order: who -> stocks -> side -> stake -> deadline -> review)
  await page.goto(B + '/duel/new', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /maya/ }).first().click();
  await page.getByRole('button', { name: 'continue' }).click();
  await page.getByRole('option', { name: /NVDA/ }).click();
  await page.getByRole('option', { name: /^AMD/ }).click();
  ok(await page.getByText('NVDA vs AMD').first().isVisible(), 'matchup summary shows both stocks');
  await page.getByRole('button', { name: 'continue' }).click();
  ok(await page.getByRole('button', { name: 'continue' }).isDisabled(), 'cannot continue before picking a side');
  await page.getByRole('button', { name: /^NVDA/ }).click();
  ok(await page.getByText(/maya gets AMD/).isVisible(), 'opponent gets the other stock');
  await page.getByRole('button', { name: 'continue' }).click();
  await page.getByRole('button', { name: '$5', exact: true }).click();
  ok(await page.getByText('your stake').isVisible() && await page.getByText('prize pool').isVisible(), 'stake and prize pool shown separately');
  ok((await page.locator('text=prize pool >> xpath=..').innerText()).includes('$10'), 'prize pool = 2 x $5');
  await page.getByRole('button', { name: 'continue' }).click();
  await page.getByRole('button', { name: 'continue' }).click();
  await page.getByText('review the terms').waitFor();
  ok(await page.getByRole('button', { name: /send challenge/ }).isDisabled(), 'cannot send before agreeing to terms');
  await page.screenshot({ path: SHOTS + '/flow_review.png' });
  await page.getByRole('checkbox').check();
  const send = page.getByRole('button', { name: /send challenge/ });
  await send.dblclick();
  ok(await toast('challenge sent'), 'duel created');
  const sent = await page.evaluate(() => JSON.parse(localStorage.getItem('beef:demo:v4')).duels.filter((d) => d.createdBy === 'u_me' && d.status === 'pending' && d.participants[0].ticker === 'NVDA' && d.participants[1].ticker === 'AMD').length);
  ok(sent === 1, `double tap creates exactly one duel (${sent})`);
  await page.screenshot({ path: SHOTS + '/flow_created.png' });
  const newId = await page.evaluate(() => JSON.parse(localStorage.getItem('beef:demo:v4')).duels.find((d) => d.createdBy === 'u_me' && d.participants[0].ticker === 'NVDA' && d.participants[1].ticker === 'AMD').id);
  await page.goto(B + '/duel/' + newId, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'simulate acceptance' }).click();
  ok(await toast('locks at the close'), 'status accepted after opponent accepts');
  await page.getByRole('button', { name: 'jump to price lock' }).click();
  ok(await toast('starting prices locked'), 'prices locked by server');
  await page.getByText('time left').waitFor();
  const startPrices = await page.locator('table tbody tr').count();
  ok(startPrices === 2, 'price table shows 2 rows');
  await page.getByRole('button', { name: /jump to deadline/ }).click();
  ok(await toast('how the winner was decided'), 'settled by server');
  const expl = await page.locator('text=/returned .* (wins by|draw)/').first().innerText().catch(() => '');
  console.log('     explanation:', expl);
  ok(/percentage points|draw/.test(expl), 'explanation mentions margin');
  await page.getByRole('button', { name: /challenge terms/ }).click();
  ok(await page.getByText('percentage return, official closing prices').isVisible(), 'terms visible');
  ok(await page.getByText('settlement audit log').isVisible(), 'audit log shown');
  ok(await page.getByText(/settled · (winner paid|draw)/).first().isVisible(), 'settlement status row shown');
  ok(await page.getByText('$5 each').first().isVisible() && await page.getByText('prize pool').first().isVisible(), 'detail shows stake and prize pool');
  await page.screenshot({ path: SHOTS + '/flow_settled.png', fullPage: true });
  // idempotency: reload and confirm result unchanged
  const before = await page.locator('table').innerText();
  await page.reload({ waitUntil: 'networkidle' });
  ok((await page.locator('table').innerText()) === before, 'result persisted and unchanged after reload');

  // ---- 2. accept an invitation
  await page.goto(B + '/duel/d_inv', { waitUntil: 'networkidle' });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /accept ·/ }).click();
  ok(await toast("you're in"), 'invite accepted');

  // ---- 2b. decline an invitation
  await page.goto(B + '/duel/d_inv2', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'decline' }).click();
  ok(await toast('declined'), 'invite declined');
  ok(await page.getByText('declined · nothing was staked').isVisible(), 'declined status shown');

  // ---- 2c. pending duel shows current prices before the lock
  await page.goto(B + '/duel/d_open', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  ok(await page.getByText('locks at close').first().isVisible(), 'pending duel shows start prices lock at close');

  // ---- 2d. rematch prefill jumps straight to the stake
  await page.goto(B + '/duel/new?mine=NVDA&theirs=AAPL&vs=u_alex', { waitUntil: 'networkidle' });
  ok(await page.getByText("what's on the line?").isVisible(), 'rematch prefill skips to stake');

  // ---- 2e. group beef
  await page.goto(B + '/duel/new', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^group/ }).click();
  await page.getByRole('button', { name: /alex rivers/ }).click();
  await page.getByRole('button', { name: /priya/ }).click();
  await page.getByRole('button', { name: 'continue' }).click();
  for (const t of [/^TSM/, /^AVGO/, /^AMD/]) await page.getByRole('option', { name: t }).click();
  await page.getByRole('button', { name: 'continue' }).click();
  await page.getByRole('button', { name: /^TSM/ }).click();
  await page.getByRole('button', { name: 'continue' }).click();
  ok((await page.locator('text=prize pool >> xpath=..').innerText()).includes('$30'), 'group prize pool = 3 x $10');
  await page.getByRole('button', { name: 'continue' }).click();
  await page.getByRole('button', { name: 'continue' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /send challenge/ }).click();
  ok(await toast('challenge sent'), 'group beef created');

  // ---- 3. post a prediction
  await page.goto(B + '/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /make it a prediction/ }).click();
  await page.getByLabel('post text').fill('tsla is going to cook meta this week');
  await page.getByLabel('stock you think wins').selectOption('TSLA');
  await page.getByLabel('stock you think loses').selectOption('META');
  await page.getByRole('button', { name: 'post', exact: true }).click();
  ok(await toast('prediction posted'), 'prediction posted');
  ok(await page.getByText('tsla is going to cook meta this week').first().isVisible(), 'prediction in feed');

  // ---- 4. comment + reaction
  await page.goto(B + '/post/p1', { waitUntil: 'networkidle' });
  await page.getByRole('textbox', { name: 'comment' }).fill('msft fades into the close, calling it');
  await page.getByRole('button', { name: 'send' }).click();
  ok(await page.getByText('msft fades into the close, calling it').isVisible(), 'comment added');
  const fire = page.getByRole('button', { name: /^fire/ }).first();
  const pressedBefore = await fire.getAttribute('aria-pressed');
  await fire.click();
  ok((await fire.getAttribute('aria-pressed')) !== pressedBefore, 'reaction toggled');

  // ---- 5. follow
  await page.goto(B + '/u/kaiyolo', { waitUntil: 'networkidle' });
  const fb = page.getByRole('button', { name: /^follow(ing)?$/ }).first();
  const t0 = await fb.innerText(); await fb.click(); await page.waitForTimeout(200);
  ok((await fb.innerText()) !== t0, `follow toggled (${t0} -> ${await fb.innerText()})`);

  // ---- 6. trophy card download
  await page.goto(B + '/duel/d_rise', { waitUntil: 'networkidle' });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.getByRole('button', { name: /share trophy card/ }).click()]);
  ok(!!dl, 'trophy card generated');
  if (dl) await dl.saveAs(SHOTS + '/trophy.png');

  // ---- 7. notifications
  await page.goto(B + '/notifications', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /mark all read/ }).click();
  ok(await page.getByText("you're all caught up").isVisible(), 'notifications marked read');

  // ---- 8. leaderboard periods x categories
  await page.goto(B + '/leaderboard', { waitUntil: 'networkidle' });
  const rows = async () => page.locator('a[href^="/u/"]').count();
  const counts = [];
  for (const p of ['this week', 'this month', 'all-time']) {
    await page.getByRole('tab', { name: p }).click();
    for (const m of ['beef score', 'win rate', 'longest streak', 'most active']) { await page.getByRole('tab', { name: m }).click(); counts.push(`${p}/${m}:${await rows()}`); }
  }
  console.log('     ', counts.join(' '));
  ok(counts.every((c) => !c.endsWith(':0')), 'every leaderboard view has ranked users');

  // ---- 8b. wallet activity + profile
  await page.goto(B + '/wallet', { waitUntil: 'networkidle' });
  ok(await page.getByText(/stake held/).count() > 2 && await page.getByText(/winnings|stake returned/).count() > 0, 'wallet lists stakes and payouts');
  await page.goto(B + '/profile', { waitUntil: 'networkidle' });
  ok(await page.getByText('completed', { exact: true }).isVisible() && await page.getByText('best streak').isVisible(), 'profile shows completed + streak');
  await page.getByRole('tab', { name: 'rivalries' }).click();
  ok(await page.locator('a[href^="/rivalry/"]').count() > 0, 'profile lists rivalries');

  // ---- 9. community join + create
  await page.goto(B + '/communities/meme-stocks', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'join' }).click();
  ok(await toast('welcome to meme stocks'), 'joined community');
  await page.goto(B + '/communities/new', { waitUntil: 'networkidle' });
  await page.getByLabel('name').fill('ev stocks');
  await page.getByRole('button', { name: 'TSLA' }).click();
  await page.getByRole('button', { name: 'create', exact: true }).click();
  await page.waitForURL(/communities\/ev-stocks/);
  ok(true, 'community created');

  // ---- 10. sign out, browse as guest, sign up + onboarding
  await page.goto(B + '/profile', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'settings' }).click();
  await page.getByRole('button', { name: /sign out/ }).click();
  await page.waitForURL(B + '/');
  ok(await page.getByText('welcome to beef').isVisible(), 'guest home after sign out');
  await page.goto(B + '/duel/new', { waitUntil: 'networkidle' });
  ok(await page.getByText('sign in to start a beef').isVisible(), 'guests are asked to sign in for duels');
  await page.goto(B + '/auth/sign-up', { waitUntil: 'networkidle' });
  await page.getByLabel('email').fill('newbie@example.com');
  await page.getByLabel('password').fill('supersecret1');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'create account' }).click();
  await page.waitForURL(/onboarding/);
  await page.getByLabel('username').fill('newbie');
  await page.getByLabel('display name').fill('new person');
  await page.getByRole('button', { name: 'continue' }).click();
  await page.getByRole('button', { name: 'avatar 🦊' }).click();
  await page.getByLabel('bio').fill('here to learn');
  await page.getByRole('button', { name: 'continue' }).click();
  await page.getByRole('button', { name: 'AAPL' }).click();
  await page.getByRole('button', { name: 'continue' }).click();
  await page.getByRole('button', { name: /^follow$/ }).first().click();
  await page.getByRole('button', { name: 'continue' }).click();
  await page.getByLabel('where do you live?').selectOption('united kingdom');
  await page.getByRole('checkbox').check();
  await page.screenshot({ path: SHOTS + '/flow_onboarding.png' });
  await page.getByRole('button', { name: "let's beef" }).click();
  await page.waitForURL(B + '/');
  ok(await page.getByText('hey, new').isVisible(), 'onboarded user lands on home');

  // ---- 11. invite link on another device
  const ctx2 = await browser.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 1 });
  const p2 = await ctx2.newPage();
  await page.goto(B + '/duel/new?mine=GOOGL&theirs=META', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^open/ }).click();
  await page.getByRole('button', { name: 'continue' }).click();
  await page.getByRole('button', { name: 'continue' }).click();
  await page.getByRole('button', { name: /^GOOGL/ }).click();
  await page.getByRole('button', { name: 'continue' }).click();
  await page.getByRole('button', { name: '$10', exact: true }).click();
  await page.getByRole('button', { name: 'continue' }).click();
  await page.getByRole('button', { name: 'continue' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /send challenge/ }).click();
  await page.getByText('challenge sent').first().waitFor();
  const link = await page.locator('p.font-mono').innerText();
  await p2.goto(link, { waitUntil: 'networkidle' });
  await p2.waitForURL(/\/duel\//);
  ok(await p2.getByText(/wants to beef/).isVisible(), 'invite link opens challenge on another device');
  ok(await p2.getByText('(you)').count() === 0, 'creator is not shown as the invitee');
  await p2.getByRole('checkbox').check();
  await p2.getByRole('button', { name: /accept ·/ }).click();
  ok(await p2.getByText(/you're in/).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false), 'invitee accepts on device 2');
  ok(await p2.getByText('(you)').count() === 1, 'device 2 sees itself on exactly one side');
  await p2.screenshot({ path: SHOTS + '/flow_invite_other_device.png' });
  await page.goto(B + '/duel/d_rise', { waitUntil: 'networkidle' });
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /share trophy card/ }).click()]);
  await dl2.saveAs(SHOTS + '/trophy.png');

  console.log(`\npage errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  console.log(`failures: ${failures}`);
  await browser.close();
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
