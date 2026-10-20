// Browser-check-surface: PAGE_LEAVING unhandledrejection beforeunload
/* kosmos#6725: a request a reload cuts off must not become a page error, and a real failure still must.
 *
 * render-shell-noscroll-4872's WebKit "no page errors" arm flaked in CI: its reloads cut off the board's polls, WebKit
 * rejects each one ("Load failed" / "due to access control checks"), and a caller with no catch made that an uncaught
 * error. The board now ignores a TypeError rejection while it is leaving (web/index.html, PAGE_LEAVING). This check
 * makes the cut-off happen on purpose instead of by timing: one request is held open by the check itself, the page is
 * reloaded under it, and no page error may follow.
 *
 *  1  a request held open across a reload, with no catch: no page error (WebKit and Chromium).
 *  2  CONTROL: a real TypeError rejection while the page is NOT leaving is still a page error, so the check can see one.
 *  3  the board's own polls that the reload cancels: WebKit's network message for each is not counted (cutOffByReload),
 *     and only during the reload (the `reloading` flag around page.reload). Arm 3 pins the predicate itself: this
 *     board's address matches; another origin, a lookalike port and any other message do not.
 *  4  the one-second reset on one document: a beforeunload that leads nowhere, then a rejection inside the second (not
 *     reported) and one after it (reported), so a reset that never comes would fail.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const mk = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), 'aw-lr-' + tag));
const SANDBOX = mk('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mk('workers-');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects-');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mk('config-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium, webkit } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

/* kosmos#6725: WebKit reports each request a navigation cancels as "Fetch API cannot load <url> due to access control
   checks." and Playwright passes that on as a page error, though no page code raised it (measured: no
   unhandledrejection fires for these). Ignored only for THIS board's own address and only while a reload the check
   started is in flight; a cross-origin failure, or one at any other moment, still counts. The match is anchored at the
   address (host:port and the slash); the "Fetch API cannot load" prefix and the scheme are optional, because
   Playwright passes the message on with its start cut (seen: "/127.0.0.1:<port>/api/tips due to ..."). */
const cutOffByReload = (msg, base) => /due to access control checks\.?$/.test(msg)
  && new RegExp('^(?:Fetch API cannot load )?(?:https?:)?/{0,2}' + base.replace(/^https?:\/\//, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/').test(msg);

const fail = [];
let passed = 0;
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (ok) passed += 1; else fail.push(label);
};

(async () => {
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada' })]);
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  for (const [engine, kind] of [['webkit', webkit], ['chromium', chromium]]) {
    const browser = await kind.launch();
    try {
      // The board's service worker would answer before page.route sees the request.
      const ctx = await browser.newContext({ serviceWorkers: 'block' });
      const page = await ctx.newPage();
      const errs = [];
      // Review 5: wait for a page error by polling with a deadline, never a fixed sleep: one may cross the protocol late.
      const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await page.waitForTimeout(50); } return fn(); };
      let reloading = false;
      let ignored = 0;   // how many cancelled-request messages the filter took, printed so a pass shows whether it fired
      page.on('pageerror', (e) => { if (reloading && cutOffByReload(e.message, BASE)) ignored += 1; else errs.push(e.message); });
      // Held open by the check: answered only after the reload has cut it off (and never awaited by anyone).
      await page.route('**/api/leave-6725', (r) => { setTimeout(() => { r.fulfill({ status: 200, body: 'late' }).catch(() => {}); }, 3000); });
      await page.addInitScript(() => {
        // Review 2: only the HELD request's own rejection counts (PromiseRejectionEvent carries the promise), not a poll's.
        addEventListener('unhandledrejection', (e) => {
          if (e.promise !== window.__held6725) return;
          try { sessionStorage.setItem('ur6725', String(Number(sessionStorage.getItem('ur6725') || 0) + 1)); } catch { /* none */ }
        });
      });
      await page.goto(BASE, { waitUntil: 'load' });
      await page.evaluate(() => { try { sessionStorage.removeItem('ur6725'); } catch { /* none */ } });
      await page.evaluate(() => { window.__held6725 = fetch('/api/leave-6725').then((r) => r.text()); });   // no catch, on purpose
      await page.waitForTimeout(200);
      reloading = true;   // only until the new page commits (review 1)
      await page.reload({ waitUntil: 'commit' });
      await page.waitForTimeout(250);   // review 2: a page error crosses its own channel and may land just after the commit
      reloading = false;
      await page.waitForLoadState('load');
      await page.waitForTimeout(1500);
      const seen = await page.evaluate(() => { try { return Number(sessionStorage.getItem('ur6725') || 0); } catch { return -1; } });
      chk(errs.length === 0, `[${engine}] 1 a request cut off by a reload is not a page error`, 'ignored=' + ignored + ' rejections=' + seen + (errs.length ? ' ' + errs.join(' | ') : ''));
      // Review 1: the arm above passes with no rejection at all, so on WebKit (the engine that rejects) prove there was one.
      if (engine === 'webkit') chk(seen >= 1, '[webkit] 1 PRECONDITION: the held request itself rejected on the leaving page', 'rejections=' + seen);
      // 2. The CONTROL, on the reloaded page well past the leaving window: a real one is still reported.
      errs.length = 0;
      await page.waitForTimeout(1200);
      await page.evaluate(() => { Promise.reject(new TypeError('a real failure 6725')); });
      await until(() => errs.length >= 1, 10000);
      chk(errs.length === 1 && /a real failure 6725/.test(errs[0]), `[${engine}] 2 CONTROL: a real rejection while not leaving is still a page error`, JSON.stringify(errs));
      // 4. The reset, on one live document: a beforeunload that leads nowhere (a download link does this).
      errs.length = 0;
      // All three on the page's own timers (100 ms, the page's reset at 1000 ms, then 1600 ms), so the gaps do not
      // depend on how fast the check talks to the browser. Residual: a main thread stalled for over ~0.9 s can run the
      // reset before the first rejection's own notification task, and then this arm fails (review 5; stated in the plan).
      await page.evaluate(() => {
        dispatchEvent(new Event('beforeunload'));
        setTimeout(() => { Promise.reject(new TypeError('inside the leaving second 6725')); }, 100);
        setTimeout(() => { Promise.reject(new TypeError('after the leaving second 6725')); window.__after6725 = true; }, 1600);
      });
      await page.waitForFunction(() => window.__after6725 === true, null, { timeout: 15000 });
      // Page errors arrive in order, so once the later one is here the earlier one has had its chance.
      await until(() => errs.some((e) => /after the leaving second/.test(e)), 10000);
      const inside = errs.filter((e) => /inside the leaving second/.test(e)).length;
      const after = errs.filter((e) => /after the leaving second/.test(e)).length;
      chk(inside === 0, `[${engine}] 4 inside the second after a beforeunload, a TypeError rejection is not a page error`, JSON.stringify(errs));
      chk(after === 1, `[${engine}] 4 CONTROL: after that second (no navigation came), one is reported again`, JSON.stringify(errs));
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
  const lineOf = (f) => (fs.readFileSync(path.join(__dirname, f), 'utf8').match(/^const cutOffByReload = [\s\S]*?;$/m) || [''])[0];
  chk(lineOf('render-leaving-rejection-6725.js') !== '' && lineOf('render-leaving-rejection-6725.js') === lineOf('render-shell-noscroll-4872.js'),
    '3 render-shell-noscroll-4872 uses the same predicate line (arm 3 pins the predicate in both; its reload window is not pinned here)');
  // 3. The predicate, with its controls: only this board's own address, only WebKit's cancelled-request message.
  const own = 'Fetch API cannot load ' + BASE + '/api/tips due to access control checks.';
  chk(cutOffByReload(own, BASE), '3 the board\'s own cancelled request is recognised', own);
  chk(!cutOffByReload('Fetch API cannot load https://other.example/api/x due to access control checks.', BASE)
    && !cutOffByReload(own.replace(BASE, BASE + '1'), BASE) && !cutOffByReload('TypeError: Load failed', BASE)
    && !cutOffByReload('Fetch API cannot load ' + BASE + '/api/tips due to something else.', BASE)
    // Review 3: anchored at the start of the address, so a host that merely ends in it, or the address later in
    // another origin's URL, is not this board.
    && !cutOffByReload('Fetch API cannot load http://x' + BASE.replace(/^https?:\/\//, '') + '/a due to access control checks.', BASE)
    && !cutOffByReload('Fetch API cannot load https://other.example/r?u=' + BASE + '/ due to access control checks.', BASE),
  '3 CONTROL: another origin, a lookalike port, and any other message are not');
  server.close();
  fleet.restore();
  if (fail.length) { console.log('\n' + passed + ' passed, ' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\n' + passed + ' passed, all passed');
})().catch((e) => { console.error(e); process.exit(2); });
