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

  /* #5018 (Josh): the account it runs under, the names he gave the agents, a close X that holds until the notice says
     something new, and a notice that floats over the page instead of pushing the navigation down. */
  {
    let adv = [{ agents: ['roo-lane', 'pixel-moss'], names: ['Roo', 'Pixel'], provider: 'Claude',
      email: 'owner@example.com', daysLeft: 5, severity: 'notice', expired: false }];
    const pg = await b.newPage({ viewport: { width: 1400, height: 800 } });
    const errs = [];
    let served = 0;   // advisory-carrying /api/status replies, so an absence is read only after one was served
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.route('**/api/status', async (route) => {
      let res, data;
      try { res = await route.fetch(); data = await res.json(); } catch { await route.abort().catch(() => {}); return; }
      data.loginAdvisories = adv;
      served += 1;
      await route.fulfill({ response: res, body: JSON.stringify(data), headers: { ...res.headers(), 'content-type': 'application/json' } });
    });
    await pg.goto(URL, { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    const shown = () => pg.waitForFunction(() => document.querySelector('#login-adv-slot .login-adv'), null, { timeout: 12000 }).then(() => true, () => false);
    chk(await shown(), '5018: the notice renders');
    const txt = await pg.$eval('#login-adv-slot', (el) => el.innerText).catch(() => '');
    chk(/On Claude, owner@example\.com: Roo, Pixel\./.test(txt), '5018: names the provider, the account and the given names', JSON.stringify(txt));
    chk(!/roo-lane|pixel-moss/.test(txt), '5018: no system names', JSON.stringify(txt));
    await pg.screenshot({ path: path.join(OUT, 'login-expiry-5018-overlay.png') });
    // Overlay: the header is the same height with the notice as without it, and the notice sits below the header.
    const geo = await pg.evaluate(() => {
      const h = document.querySelector('.apphead header').getBoundingClientRect();
      const n = document.querySelector('#login-adv-slot .login-adv').getBoundingClientRect();
      const tabs = document.querySelector('.apphead .tabs'); const t = tabs ? tabs.getBoundingClientRect().top : null;
      return { headH: h.height, headBottom: h.bottom, noteTop: n.top, tabsTop: t };
    });
    await pg.evaluate(() => { document.getElementById('login-adv-slot').style.display = 'none'; });
    const bare = await pg.evaluate(() => {
      const tabs = document.querySelector('.apphead .tabs');
      return { headH: document.querySelector('.apphead header').getBoundingClientRect().height, tabsTop: tabs ? tabs.getBoundingClientRect().top : null };
    });
    await pg.evaluate(() => { document.getElementById('login-adv-slot').style.display = ''; });
    chk(Math.abs(geo.headH - bare.headH) < 0.5, '5018: the header does not grow while the notice shows', JSON.stringify({ geo, bare }));
    chk(geo.tabsTop === bare.tabsTop, '5018: the navigation does not move', JSON.stringify({ geo, bare }));
    chk(geo.noteTop >= geo.headBottom, '5018: the notice floats below the header, over the page', JSON.stringify(geo));
    // On top, not just placed: the point at the notice's centre is the notice, in the tab view and in consolidated
    // (whose header is position: static, so the stack competes with the page's own sticky layers). Consolidated is
    // the board's real layout, read from GET /api/style (stubbed in this page only, as mobile-shots does), not a
    // page-side toggle, so its panes are really there under the notice.
    const onTop = () => pg.evaluate(() => {
      const n = document.querySelector('#login-adv-slot .login-adv');
      const r = n.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      // CONTROL: with the stack hidden, the same point is real page content, so "on top" can fail.
      const stack = document.getElementById('topnotes');
      stack.style.visibility = 'hidden';
      const under = document.elementFromPoint(x, y);
      stack.style.visibility = '';
      const name = (el) => (el ? (el.id || String(el.className || '') || el.tagName) : null);
      return { onTop: !!hit && n.contains(hit), hit: name(hit), layout: document.documentElement.getAttribute('data-layout'),
        underIsContent: !!under && under !== document.body && under !== document.documentElement, under: name(under) };
    });
    // Over New agent never: the left column's primary action stays clickable (the reason the stack is centred).
    const clearOfNew = await pg.evaluate(() => {
      const a = document.querySelector('#login-adv-slot .login-adv').getBoundingClientRect();
      const b = document.getElementById('new-agent'); if (!b || !b.getClientRects().length) return null;
      const c = b.getBoundingClientRect();
      return !(a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom);
    });
    chk(clearOfNew === true, '5018: the notice does not cover New agent', String(clearOfNew));
    for (const cons of [false, true]) {
      if (cons) {
        await pg.route('**/api/style', async (r) => {
          if (r.request().method() !== 'GET') return r.continue();
          let resp; try { resp = await r.fetch(); } catch { return r.continue(); }
          const j = await resp.json().catch(() => null);
          return j ? r.fulfill({ response: resp, json: { ...j, layout: 'consolidated' } }) : r.fulfill({ response: resp });
        });
        await pg.reload({ waitUntil: 'load' });
        if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
        await pg.waitForFunction(() => document.documentElement.getAttribute('data-layout') === 'consolidated', null, { timeout: 8000 }).catch(() => {});
        await shown();
      }
      const top = await onTop().catch((e) => ({ error: e.message }));
      const where = cons ? 'consolidated' : 'tab view';
      if (cons) chk(top.layout === 'consolidated', '5018: CONTROL: the consolidated layout is really on', JSON.stringify(top));
      chk(top.underIsContent, '5018: CONTROL: page content sits under the notice (' + where + ')', JSON.stringify(top));
      chk(top.onTop, '5018: the notice is on top of the page (' + where + ')', JSON.stringify(top));
    }
    if (true) {   // back to the tab view for the X arms below
      await pg.unroute('**/api/style').catch(() => {});
      await pg.reload({ waitUntil: 'networkidle' });
      if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
      await shown();
    }
    // The X hides it, and it stays hidden across a reload while nothing changes.
    await pg.click('#login-adv-slot .login-adv .ux').catch((e) => errs.push('click: ' + e.message));
    chk(!(await pg.$('#login-adv-slot .login-adv')), '5018: the X hides the notice');
    const before = served;
    await pg.reload({ waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    // Two advisory replies after the reload: the first has certainly been painted by the time the second is asked for.
    for (let i = 0; i < 60 && served < before + 2; i++) await pg.waitForTimeout(250);
    chk(served >= before + 2, '5018: the reloaded page read the advisory (so the next line is not a vacuous absence)', 'served ' + (served - before));
    chk(!(await pg.$('#login-adv-slot .login-adv')), '5018: still hidden after a reload, nothing changed');
    // A change (fewer days left) brings it back.
    adv = [{ ...adv[0], daysLeft: 4 }];
    await pg.reload({ waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    chk(await shown(), '5018: a change (5 days to 4) shows the notice again');
    chk(errs.length === 0, '5018: no console errors', errs.join(' | '));
    await pg.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await pg.close();
  }

  /* #3532 DARK-MODE escalation guard. The (0,3,0) dark `.utoast { --utone }` override would, without
     the theme restatement, paint notice+warn the same salmon as urgent -- collapsing the escalation
     in dark, invisibly to a classList/text assertion. Render notice and urgent in FORCED dark and
     assert their tones DIFFER (the .udot background resolves --utone). Equal tones = the bug is back. */
  async function darkTone(sev, adv) {
    const pg = await b.newPage({ viewport: { width: 1400, height: 800 }, colorScheme: 'dark' });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.route('**/api/status', async (route) => {
      let res, data;
      try { res = await route.fetch(); data = await res.json(); } catch { await route.abort().catch(() => {}); return; }
      data.loginAdvisories = adv;
      await route.fulfill({ response: res, body: JSON.stringify(data), headers: { ...res.headers(), 'content-type': 'application/json' } });
    });
    await pg.goto(URL, { waitUntil: 'networkidle' });
    await pg.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    await pg.waitForFunction((s) => {
      const el = document.querySelector('#login-adv-slot .login-adv');
      return el && el.classList.contains(s);
    }, sev, { timeout: 12000 }).catch(() => {});
    const tone = await pg.$eval('#login-adv-slot .login-adv .udot', (el) => getComputedStyle(el).backgroundColor).catch(() => '');
    if (sev === 'notice') { const box = await pg.$('#login-adv-slot'); if (box) await box.screenshot({ path: path.join(OUT, 'login-expiry-dark-notice.png') }); }
    chk(errs.length === 0, 'dark ' + sev + ': no console errors', errs.join(' | '));
    await pg.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await pg.close();
    return tone;
  }
  const noticeDark = await darkTone('notice', [{ agents: ['renettilley'], daysLeft: 4, severity: 'notice', expired: false }]);
  const urgentDark = await darkTone('urgent', [{ agents: ['leo'], daysLeft: 0, severity: 'urgent', expired: false }]);
  chk(!!noticeDark && !!urgentDark && noticeDark !== urgentDark,
    'dark mode: notice tone differs from urgent (escalation survives dark, not all salmon)',
    'notice=' + noticeDark + ' urgent=' + urgentDark);

  await b.close();
  console.log(fail.length ? '\nFAILED: ' + fail.join(', ') : '\nall good');
  process.exit(fail.length ? 1 : 0);
})();
