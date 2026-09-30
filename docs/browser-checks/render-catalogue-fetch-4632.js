/**
 * #4632: the ready-made roles are downloaded when the role picker opens, not shipped.
 *
 * What is pinned, on a real page against a real board:
 *   1. Opening the picker asks the board with ?catalogue=1 (the only request that downloads).
 *   2. The board then holds the catalogue: /api/roles reports it loaded, with a serial.
 *   3. Its roles reach the picker the person sees: a catalogue role (Chief Marketing Officer) is
 *      on the menu, beside the built-in ones.
 *   4. A plain /api/roles (the page's role titles at load) never downloads: the page's first
 *      request carries no ?catalogue=1.
 *
 * The harness (tools/browser-checks.sh) serves the genuine published catalogue.json and its
 * signature from a local port and points every board at it (KOSMOS_CATALOGUE_BASE), so this needs
 * no network and the board verifies the real signature with its real key.
 *
 * Headless is fine here: everything below is requests, JSON and visible text.
 *
 * Run: see the README in this directory.
 */
'use strict';

const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4399';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  const rolesRequests = [];
  page.on('request', (r) => { if (/\/api\/roles(\?|$)/.test(r.url())) rolesRequests.push(r.url()); });

  await page.goto(BASE + '/?tab=create', { waitUntil: 'load' });
  await page.waitForSelector('#pick-pm:not([hidden])', { timeout: 15000 });
  // The picker's list, which the menu fills from /api/roles?catalogue=1.
  await page.evaluate(() => { const b = document.getElementById('pick-list'); if (b) b.click(); });
  await page.waitForTimeout(800);

  const asked = rolesRequests.filter((u) => /[?&]catalogue=1(&|$)/.test(u));
  check('opening the picker asks the board with ?catalogue=1', asked.length >= 1, `${asked.length} of ${rolesRequests.length} /api/roles requests`);
  // The page also reads /api/roles at load for role titles; that read must not be the one that
  // downloads, or every page load would.
  check('the page\'s load-time /api/roles read carries no ?catalogue=1', rolesRequests.length > asked.length,
    rolesRequests.map((u) => u.replace(BASE, '')).join(' '));

  const status = await page.evaluate(async (base) => (await (await fetch(base + '/api/roles')).json()).catalogue || null, BASE);
  check('the board now holds the catalogue, verified', status && status.loaded === true && Number.isInteger(status.serial),
    JSON.stringify(status));

  const menu = await page.evaluate(async (base) => (await (await fetch(base + '/api/roles')).json()).roles.map((r) => r.label), BASE);
  check('a catalogue role is on the menu beside the built-in ones', menu.includes('Chief Marketing Officer') && menu.includes('Project Manager'),
    `${menu.length} roles`);

  const shown = await page.evaluate(() => (document.body.innerText || ''));
  check('the picker the person sees lists it', /Chief Marketing Officer/.test(shown));
  check('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED` : `all ${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
