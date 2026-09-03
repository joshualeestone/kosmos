/**
 * The board's protected reads, refused with 403, must render AS NOT-SIGNED-IN --
 * leading with the remedy that self-heals on the next Kosmos update -- not as the
 * honest-but-wrong "we cannot read right now" (kosmos#2023). The full-path CLI
 * (~/.local/share/kosmos/bin/kosmos open) is a footnote, never the lead and never
 * a bare name: every user-action remedy was measured to fail on a real machine
 * (a stale app bundle cannot sign in #2028, the bare CLI name is off PATH, and a
 * page cannot mint the token it by definition lacks -- so (b) was dropped).
 *
 * 🛑 THE REGRESSION THIS PINS SHIPPED IN 0.6.25 AND REACHED REAL USERS. #1946's
 * loopback auth landed, so a board opened from a bookmark / a typed 127.0.0.1 (no
 * board token) 403s every protected read. The shell (`GET /`) is exempt and paints
 * fine; only the reads 403. The board drew that as "We cannot read your agents
 * right now", which invites waiting -- and patience cannot supply a token. Ben and
 * Casey (the two outside testers) both hit an empty `?`-filled board within the hour.
 *
 * 🔑 WHY THIS ASSERTS THE RENDERED MESSAGE, NEVER `GET /`'s STATUS. `GET /` is 200
 * while everything is broken -- that is exactly what let 0.6.25 through four gate
 * checks. The dangerous answer this must catch is "the page loaded and could read
 * nothing", so every assertion below reads what the board DREW after a mocked 403,
 * not whether the shell loaded.
 *
 * 🔑 THE ROUTES ARE INTERCEPTED, NOT CALLED. A mocked 403 needs no enforcing board
 * and no real token (Splinter tested the same path token->nonce->page over curl);
 * a sandboxed board serves the shell, the browser's fetch sees the mocked status.
 *
 * Run: see the README. Shape:
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-board-signin-403-2023.js http://127.0.0.1:PORT
 * against a sandboxed board with first-run completed (boot_board + the
 * /api/first-run/complete POST the driver already does).
 */
'use strict';

const playwright = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4399';
const HEADED = process.env.HEADED !== '0';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

/* The server's own 403 body (server.js): the board surfaces it, so the check
   uses the real sentence rather than inventing one. */
const AUTH_403 = { error: 'this board belongs to the account that started it; open it with `kosmos open`' };

const SIGNIN = /not signed in/i;
/* The remedy that actually works (#2023): the board self-heals on the next
   Kosmos update. Every user-action remedy -- a terminal kosmos open, relaunch
   the app, a page button -- was measured to FAIL on a real machine, so the copy
   LEADS with self-heal and this is what the check asserts leads. */
const SELF_HEAL = /fix(?:es)? itself the next time Kosmos updates/i;
/* The terminal line is a footnote, and it MUST be the full path: the bare name
   is not on PATH in a shell without ~/.zprofile (how it failed for Josh). */
const FULL_PATH = /~\/\.local\/share\/kosmos\/bin\/kosmos open/;
const CANNOT_READ_AGENTS = /We cannot read your agents right now/i;

(async () => {
  const browser = await playwright.chromium.launch({ headless: !HEADED });

  async function fresh() {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    return { ctx, page };
  }

  // ---- Scenario 1: agents read 403 -> the board says NOT SIGNED IN, with the remedy.
  {
    const { ctx, page } = await fresh();
    await page.route('**/api/status', (r) => r.fulfill({ status: 403, json: AUTH_403 }));
    await page.route('**/api/projects', (r) => r.fulfill({ status: 403, json: AUTH_403 }));
    await page.goto(BASE + '/?tab=agents', { waitUntil: 'networkidle' });
    await page.waitForTimeout(600); // let the failed poll paint
    const seen = await page.evaluate(() => {
      const grid = document.getElementById('grid');
      const alist = document.getElementById('alist');
      const orgnote = document.getElementById('orgnote');
      // whichever layout is on screen carries the box
      const boardText = ((grid && grid.textContent) || '') + ' ' + ((alist && alist.textContent) || '');
      return { boardText, org: (orgnote && orgnote.textContent) || '' };
    });
    check('agents 403: the board says NOT SIGNED IN', SIGNIN.test(seen.boardText), seen.boardText.slice(0, 120));
    check('agents 403: it LEADS with the self-heal remedy (the only one that works)', SELF_HEAL.test(seen.boardText), seen.boardText.slice(0, 160));
    check('agents 403: the terminal footnote uses the FULL path, never a bare name', FULL_PATH.test(seen.boardText), seen.boardText.slice(0, 200));
    check('agents 403: it does NOT say the generic "cannot read your agents"', !CANNOT_READ_AGENTS.test(seen.boardText), seen.boardText.slice(0, 120));
    check('agents 403: the org note also says not signed in', SIGNIN.test(seen.org), seen.org.slice(0, 120));
    await ctx.close();
  }

  // ---- Scenario 2: projects read 403 -> #pj-list says NOT SIGNED IN.
  {
    const { ctx, page } = await fresh();
    await page.route('**/api/status', (r) => r.fulfill({ status: 403, json: AUTH_403 }));
    await page.route('**/api/projects', (r) => r.fulfill({ status: 403, json: AUTH_403 }));
    await page.goto(BASE + '/?tab=projects', { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const pj = await page.evaluate(() => (document.getElementById('pj-list') || {}).textContent || '');
    check('projects 403: #pj-list says NOT SIGNED IN', SIGNIN.test(pj), pj.slice(0, 120));
    check('projects 403: #pj-list LEADS with the self-heal remedy', SELF_HEAL.test(pj), pj.slice(0, 160));
    check('projects 403: #pj-list footnote uses the FULL path', FULL_PATH.test(pj), pj.slice(0, 200));
    check('projects 403: #pj-list does NOT say the generic "cannot read your projects"', !/We cannot read your projects right now/i.test(pj), pj.slice(0, 120));
    await ctx.close();
  }

  // ---- CONTROL A: a normal 200 board (no mock) shows NEITHER message.
  {
    const { ctx, page } = await fresh();
    await page.goto(BASE + '/?tab=agents', { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const t = await page.evaluate(() => (document.getElementById('grid') || {}).textContent || '');
    check('CONTROL 200: a normal board shows no not-signed-in message', !SIGNIN.test(t) && !SELF_HEAL.test(t), t.slice(0, 100));
    await ctx.close();
  }

  // ---- CONTROL B: a genuine 500 still shows the honest CANNOT-READ copy (narrowed, not replaced).
  {
    const { ctx, page } = await fresh();
    await page.route('**/api/status', (r) => r.fulfill({ status: 500, json: { error: 'we could not read tmux' } }));
    await page.goto(BASE + '/?tab=agents', { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const t = await page.evaluate(() => {
      const grid = document.getElementById('grid');
      const alist = document.getElementById('alist');
      return ((grid && grid.textContent) || '') + ' ' + ((alist && alist.textContent) || '');
    });
    check('CONTROL 500: a genuine failure still says "cannot read" (copy narrowed, not replaced)', CANNOT_READ_AGENTS.test(t), t.slice(0, 120));
    check('CONTROL 500: a genuine failure does NOT say not signed in', !SIGNIN.test(t), t.slice(0, 120));
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('FAILED: ' + failed.map((r) => r.name).join(', '));
    process.exit(1);
  }
})().catch((e) => {
  console.error('render-board-signin-403-2023 threw: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
