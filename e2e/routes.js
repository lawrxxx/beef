// end-to-end check. usage: BASE_URL=http://localhost:3000 node e2e/routes.js [shots-dir]
// needs playwright with chromium available (npm i -D playwright && npx playwright install chromium).
const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${page.url()} ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${page.url()} ${e.message}`));
  const routes = ['/', '/discover', '/duel', '/duel/new', '/duel/d_rise', '/duel/d_fall', '/duel/d_draw', '/duel/d_halt', '/duel/d_live1', '/duel/d_inv', '/duel/d_group', '/duel/d_acc', '/duel/d_inv2', '/duel/d_open', '/leaderboard', '/profile', '/u/alexrivers', '/rivalry/alexrivers', '/communities', '/communities/ai-stocks', '/communities/new', '/notifications', '/post/p1', '/beef-of-the-day', '/wallet', '/rules', '/stock/NVDA', '/auth/sign-in', '/auth/sign-up', '/auth/reset', '/offline', '/nope'];
  for (const r of routes) {
    const res = await page.goto((process.env.BASE_URL || 'http://localhost:3000') + r, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const name = r === '/' ? 'home' : r.replace(/\//g, '_').slice(1);
    await page.screenshot({ path: `${(process.argv[2] || require('os').tmpdir())}/shots/${name}.png`, fullPage: false });
    console.log(`${res.status()} ${r}${overflow > 0 ? `  OVERFLOW ${overflow}px` : ''}`);
  }
  console.log('\nERRORS:\n' + (errors.join('\n') || 'none'));
  await browser.close();
})();
