'use strict';

/**
 * kosmos#7504: Settings > This computer on Windows, "Start Kosmos when I sign in to Windows". Turning the switch on
 * also registers the crash-recovery watchdog (#7498), and the route says when that failed. The switch shows on either
 * way, so the line under the rows is the only place the failure is said.
 *
 * Drives the real page (served as Windows by its kosmos-platform meta) against a stubbed /api/machine and
 * POST /api/machine/start-at-sign-in (no board), in Chromium and WebKit, at desktop and phone width, inside the real
 * Settings panel. The switch is pressed through the DOM, not a pointer hit-test (one timed out on file:// in CI, as
 * web.win32-start-at-sign-in.test.js records). The claims, each able to fail:
 *  - watchdog failed: the line shows, says recovery is not set up, and carries the engine's reason as text (a reason
 *    with markup in it is not drawn as markup); the switch repaints on from the engine;
 *  - watchdog registered, present, or no watchdog field: no line (the controls);
 *  - at 390 px nothing scrolls sideways.
 *
 * Browser-check-surface: set-machine-msg data-start-at-sign-in startAtSignInNoRecovery
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-signin-recovery-7504.js
 *
 * HEADED by default; HEADED=0 on a machine with no console session.
 */

const nodePath = require('node:path');
let pw;
try { pw = require('playwright'); }
catch { console.log('render-signin-recovery-7504: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const LEAD = 'Kosmos will start when you sign in, but it is not yet set to start again if it closes:';
const BECAUSE = 'we could not register the job that restarts the board if it stops (ERROR: <b>Access</b> is denied.)';
const ROW = (on) => ({ key: 'autostart', state: 'ok', title: 'Kosmos starts itself when you sign in',
  detail: 'Kosmos starts when you sign in to Windows, and your agents come back on their own after a restart.', startAtSignIn: on });
const CASES = {
  failed: { watchdog: { ok: false, because: BECAUSE } },
  registered: { watchdog: { ok: true, action: 'registered' } },
  present: { watchdog: { ok: true, action: 'present' } },
  none: {},
};

const fails = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fails.push(label); };

(async () => {
  for (const engine of ['chromium', 'webkit']) {
    let browser;
    try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
    catch (err) { say(false, '[' + engine + '] could not start a browser', err && err.message ? err.message.split('\n')[0] : String(err)); continue; }
    for (const [w, h] of [[1100, 900], [390, 844]]) {
      const tag = '[' + engine + ' ' + w + ']';
      const page = await browser.newPage({ viewport: { width: w, height: h }, locale: 'en-US' });
      const errs = []; page.on('pageerror', (e) => { if (!/due to access control checks/.test(e.message)) errs.push(e.message); });
      await page.goto('file://' + PAGE);
      const r = await page.evaluate(async ({ cases, rowOff, rowOn }) => {
        if (typeof refreshMachineRows !== 'function' || typeof startAtSignInClick !== 'function') return { error: 'the machine row functions are missing' };
        let meta = document.querySelector('meta[name="kosmos-platform"]');
        if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name', 'kosmos-platform'); document.head.appendChild(meta); }
        meta.setAttribute('content', 'win32');
        const realFetch = window.fetch;
        let on = false;
        let answer = {};
        window.fetch = (u, opts) => {
          const url = String(u);
          if (url.indexOf('/api/machine/start-at-sign-in') !== -1) {
            on = JSON.parse((opts && opts.body) || '{}').on === true;
            return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, on, ...answer }) });
          }
          if (url.indexOf('/api/machine') !== -1) return Promise.resolve({ ok: true, status: 200, json: async () => ({ checks: [on ? rowOn : rowOff] }) });
          return realFetch(u, opts);
        };
        const mach = document.getElementById('set-machine');
        for (let el = mach; el && el !== document.body; el = el.parentElement) {
          if (el.hidden) el.hidden = false;
          if (getComputedStyle(el).display === 'none') el.style.display = 'block';
        }
        const panel = mach.closest('.panel');
        if (panel) for (const other of document.querySelectorAll('.panel')) if (other !== panel && !other.contains(panel)) other.style.display = 'none';
        const msg = document.getElementById('set-machine-msg');
        const out = {};
        for (const [k, c] of Object.entries(cases)) {
          on = false; answer = c; msg.hidden = true; msg.textContent = '';
          await refreshMachineRows();
          const sw = document.querySelector('[data-start-at-sign-in]');
          if (!sw) { out[k] = { error: 'no switch drawn' }; continue; }
          sw.click();
          for (let i = 0; i < 100 && (document.querySelector('[data-start-at-sign-in]') || {}).getAttribute?.('aria-checked') !== 'true'; i += 1) {
            await new Promise((res) => setTimeout(res, 20));
          }
          await new Promise((res) => setTimeout(res, 50));
          const now = document.querySelector('[data-start-at-sign-in]');
          out[k] = {
            checked: now ? now.getAttribute('aria-checked') : null,
            shown: !msg.hidden && msg.getBoundingClientRect().height > 0,
            text: msg.textContent,
            markup: !!msg.querySelector('b'),
            sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
          };
        }
        return out;
      }, { cases: CASES, rowOff: ROW(false), rowOn: ROW(true) });
      if (r.error) { say(false, tag + ' ' + r.error); await page.close(); continue; }
      const f = r.failed;
      say(f.checked === 'true', tag + ' watchdog failed: the switch repaints on from the engine', f.checked);
      say(f.shown, tag + ' watchdog failed: the line is shown');
      say(f.text === LEAD + ' ' + BECAUSE.replace(/[.\s]+$/, '') + '.', tag + ' watchdog failed: it says recovery is not set up, with the engine\'s reason', JSON.stringify(f.text));
      say(!f.markup, tag + ' watchdog failed: a reason with markup in it is shown as text');
      for (const k of ['registered', 'present', 'none']) {
        say(r[k].checked === 'true' && !r[k].shown && r[k].text === '', tag + ' CONTROL ' + k + ': switched on, no line', JSON.stringify(r[k]));
      }
      say(!Object.values(r).some((x) => x.sideways), tag + ' nothing scrolls sideways');
      say(errs.length === 0, tag + ' no page errors', errs.join(' | '));
      await page.close();
    }
    await browser.close();
  }
  if (fails.length) { console.log('render-signin-recovery-7504: ' + fails.length + ' failed'); process.exit(1); }
  console.log('render-signin-recovery-7504: all passed');
})();
