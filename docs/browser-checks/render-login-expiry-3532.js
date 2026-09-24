'use strict';

/**
 * #3532: the login-expiry advisory pill on the board.
 *
 * Warns, per account, before a Claude login expires so agents do not silently die
 * (Josh, #admin 2026-09-23 21:47: "Or peoples agents will just die"). The engine
 * derives per-account advisories from each agent's live refresh-token expiry and puts
 * them on the /api/status poll as `data.loginAdvisories`; paintLoginAdvisories renders
 * them into #login-adv-slot. This drives the REAL poll + paint by stubbing only
 * `data.loginAdvisories` at the network edge, everything else passed through:
 *
 *   warn      2 agents, 2 days  -> "2 agents' login expires in 2 days", .login-adv.warn
 *   urgent    1 agent,  0 days  -> "An agent's login expires today", .login-adv.urgent
 *   expired   1 agent, expired  -> "An agent's login has expired", .login-adv.urgent
 *   none      []                -> the slot is EMPTY (the control: the pill shows ONLY
 *                                  when there is an advisory, so the three above prove
 *                                  a real render and not a permanent banner)
 *
 * The poll, the paint and the slot are the page's own; only the advisory array is faked.
 *
 *   AGENT_WORKFORCE_DATA=/tmp/le PORT=17372 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17372 node docs/browser-checks/render-login-expiry-3532.js /tmp/leshots
 *
 * HEADED by default. HEADED=0 on a machine with no console session.
 */

const { chromium } = require('playwright');
const path = require('node:path');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17372';
const OUT = process.argv[2] || '/tmp/leshots';
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const CASES = [
  { key: 'notice', adv: [{ agents: ['renettilley'], daysLeft: 4, severity: 'notice', expired: false }],
    text: /An agent’s login expires in 4 days/, cls: 'notice', who: /renettilley/ },
  { key: 'warn', adv: [{ agents: ['angel', 'donnie'], daysLeft: 2, severity: 'warn', expired: false }],
    text: /2 agents’ login expires in 2 days/, cls: 'warn', who: /angel, donnie/ },
  { key: 'urgent', adv: [{ agents: ['leo'], daysLeft: 0, severity: 'urgent', expired: false }],
    text: /An agent’s login expires today/, cls: 'urgent', who: /leo/ },
  { key: 'expired', adv: [{ agents: ['mona'], daysLeft: -1, severity: 'urgent', expired: true }],
    text: /An agent’s login has expired/, cls: 'urgent', who: /mona/ },
  { key: 'none', adv: [], text: null, cls: null, who: null },
];

(async () => {
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  for (const c of CASES) {
    const pg = await b.newPage({ viewport: { width: 1400, height: 800 } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.route('**/api/status', async (route) => {
      // Every await guarded: a navigation disposes an in-flight route context, and an
      // unguarded rejection kills node AFTER the PASS lines print (render-updates-stale's
      // measured flake). A route callback losing its page is normal here, so swallow it.
      let res, data;
      try { res = await route.fetch(); data = await res.json(); } catch { await route.abort().catch(() => {}); return; }
      data.loginAdvisories = c.adv;
      await route.fulfill({ response: res, body: JSON.stringify(data), headers: { ...res.headers(), 'content-type': 'application/json' } });
    });
    await pg.goto(URL, { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }

    if (c.adv.length) {
      // Wait for the poll to paint the pill (it renders off data.loginAdvisories).
      await pg.waitForFunction(() => {
        const el = document.getElementById('login-adv-slot');
        return el && el.querySelector('.login-adv');
      }, null, { timeout: 12000 }).catch(() => {});
      const pill = await pg.$('#login-adv-slot .login-adv');
      chk(!!pill, c.key + ': the advisory pill renders', String(!!pill));
      if (pill) {
        const txt = await pg.$eval('#login-adv-slot', (el) => el.innerText);
        chk(c.text.test(txt), c.key + ': headline reads right', JSON.stringify(txt));
        chk(c.who.test(txt), c.key + ': the affected agents are named', JSON.stringify(txt));
        const hasCls = await pg.$eval('#login-adv-slot .login-adv', (el, cls) => el.classList.contains(cls), c.cls);
        chk(hasCls, c.key + ': severity class is .' + c.cls, 'classList');
      }
      const box = await pg.$('#login-adv-slot');
      if (box) await box.screenshot({ path: path.join(OUT, 'login-expiry-' + c.key + '.png') });
    } else {
      // CONTROL: empty advisories -> the slot must be empty. Give the poll a beat, then
      // assert nothing painted (proves the pill is data-driven, not a permanent banner).
      await pg.waitForTimeout(1500);
      const inner = await pg.$eval('#login-adv-slot', (el) => el.innerHTML.trim()).catch(() => 'NO-SLOT');
      chk(inner === '', 'none (CONTROL): empty advisories leave the slot empty', JSON.stringify(inner));
    }
    chk(errs.length === 0, c.key + ': no console errors', errs.join(' | '));
    await pg.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await pg.close();
  }
  await b.close();
  console.log(fail.length ? '\nFAILED: ' + fail.join(', ') : '\nall good');
  process.exit(fail.length ? 1 : 0);
})();
