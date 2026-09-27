// Browser-check-surface: plus-flow plus-pill plus-chip plus-account plus-switch askcard ask-rows plus-devlist
'use strict';
/**
 * #3829 (Josh, 2026-09-25 16:54: the connected Kosmos+ panel and the device approval are "terribly
 * worded and designed"; his 17:19 shots: "the phone is showing the code" for a Windows browser, and a
 * list row named just "device"; Mona Lisa's sketch on the card). Four states, each asserted and shot:
 *   off         -> the pill says Off, Turn on is the one primary action, no address chip;
 *   connected   -> a green Connected pill, the address in ONE chip with Copy and Open, one plain line,
 *                  Pause quiet (it was Turn off; #4079), and View my account pointing at the web account;
 *   one request -> a compact card: the device, when, one device-neutral sentence, then the code LARGE in
 *                  boxes directly above Allow / Deny (#3952); no Not now, no Not me; the request is NOT repeated in the devices list;
 *   two requests-> one stale (older than an hour, faded) and one unnamed ("Unknown device").
 * #3978: with one request, Allow (on Kosmos Plus) and the notice's Review (elsewhere) keep keyboard focus
 * and stay the same nodes through two real 5-second polls; the rows were rebuilt on every poll.
 *
 *   HEADED=0 node docs/browser-checks/render-plus-panel-3829.js [shotsDir]
 */
require('./lib-sandbox-home.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluspanel-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluspanel-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluspanel-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluspanel-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluspanel-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-plus-panel-3829: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const SHOTS = process.argv[2] || null;
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}
const ADDR = 'josh0925-150pm.kosmosplus.com';
const now = () => Math.floor(Date.now() / 1000);
const STATES = {
  off: { remote: { configured: true, on: false, ok: true, enrolled: true, email: 'you@example.com', status: { state: 'off' } }, pending: [] },
  down: { remote: { configured: true, on: true, ok: true, enrolled: true, email: 'you@example.com', status: { state: 'off', because: 'no relay address is set yet' } }, pending: [] },
  connected: { remote: { configured: true, on: true, ok: true, enrolled: true, email: 'you@example.com', status: { state: 'up', address: ADDR } }, pending: [] },
  one: { remote: { configured: true, on: true, ok: true, enrolled: true, email: 'you@example.com', status: { state: 'up', address: ADDR } },
    pending: [{ device_id: 'd-win', name: 'Windows browser', code: 'VR-D6', first_seen: now() - 120 }] },
  two: { remote: { configured: true, on: true, ok: true, enrolled: true, email: 'you@example.com', status: { state: 'up', address: ADDR } },
    pending: [{ device_id: 'd-old', name: 'iPhone', code: 'W6-M4', first_seen: now() - 3 * 3600 }, { device_id: 'd-anon', code: 'K2-PQ', first_seen: now() - 60 }] },
};

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const key of Object.keys(STATES)) {
      const st = STATES[key];
      const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      const json = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      await page.route('**/api/remote', (route, req) => route.fulfill(json(req.method() === 'GET' ? st.remote : { ok: true })));
      await page.route('**/api/remote/pending', (route) => route.fulfill(json({ devices: st.pending, email: 'you@example.com', self_device_id: 'd-self' })));
      await page.route('**/api/remote/devices**', (route) => route.fulfill(json({ on: st.remote.on, allowed: [{ device_id: 'd-mac', name: 'Mac browser', allowed_at: now() - 86400, last_seen: now() - 600 }, { device_id: 'd-noname', allowed_at: now() - 7200 }, { device_id: 'd-self', allowed_at: now() - 3600 }], pending: st.pending, self_device_id: 'd-self' })));
      await page.goto(BASE, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
      await page.evaluate(() => showTab('settings'));
      await page.click('#s-nav button[data-go="plus"]');
      await page.waitForSelector('#plus-flow', { state: 'visible', timeout: 5000 });
      await page.evaluate(() => { if (typeof pollAsk === 'function') return pollAsk(); });
      await page.waitForTimeout(700);
      const v = await page.evaluate(() => {
        const vis = (id) => { const e = document.getElementById(id); return !!(e && !e.hidden && e.getBoundingClientRect().height > 0); };
        const sw = document.getElementById('plus-switch');
        const card = document.getElementById('askcard');
        return {
          pill: document.getElementById('plus-pill').textContent.trim(), pillState: document.getElementById('plus-pill').getAttribute('data-state'),
          chip: vis('plus-chip'), copy: !!document.getElementById('plus-copy'), chipAddr: document.getElementById('plus-chip-addr').textContent.trim(),
          open: document.getElementById('plus-open').getAttribute('href'), account: document.getElementById('plus-account').getAttribute('href'),
          status: document.getElementById('plus-status').textContent.trim(), sw: sw.textContent.trim(), swClass: sw.className,
          cardShown: vis('plus-asks'), cardText: (document.getElementById('plus-asks').innerText || '').replace(/\s+/g, ' '),
          reqs: document.querySelectorAll('#plus-ask-rows .askreq').length, stale: document.querySelectorAll('#plus-ask-rows .askreq.stale').length, topCardShown: vis('askcard'), inPanel: vis('plus-asks'), panelW: document.getElementById('plus-asks').getBoundingClientRect().width, flowW: document.getElementById('plus-flow').getBoundingClientRect().width, asksAbove: document.getElementById('plus-asks').getBoundingClientRect().bottom <= document.getElementById('plus-flow').getBoundingClientRect().top + 1,
          codes: [...document.querySelectorAll('#plus-ask-rows .askcode')].map((e) => ({ t: e.textContent, label: (e.querySelector('.devcode') || { getAttribute: () => '' }).getAttribute('aria-label'), cells: e.querySelectorAll('.devcode-cell').length, nextIsActs: !!(e.nextElementSibling && e.nextElementSibling.classList.contains('acts')),   /* Mona 09-26: nothing between the code and Allow */ h: Math.min(...[...e.querySelectorAll('.devcode-cell')].map((c) => c.getBoundingClientRect().height)), inside: [...e.querySelectorAll('.devcode-cell')].every((c) => c.getBoundingClientRect().right <= e.closest('.askreq').getBoundingClientRect().right),
            /* #3952 round 2: the code must read against what is actually behind it (a white fill on the navy skin gave
               light on light). Ink of the first box against the first opaque background at or behind it. */
            contrast: (() => {
              const c = e.querySelector('.devcode-cell'); if (!c) return 0;
              const rgb = (v) => (v.match(/[\d.]+/g) || []).map(Number);
              const lum = ([r, g, b]) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
              // Composite every translucent fill from the box outward over the first opaque ground (a background
              // colour, or the Kosmos+ gradient's first stop): a 60% white fill on navy is what made this unreadable.
              let n = c; let bg = null; const layers = [];
              while (n && n.nodeType === 1) {
                const cs = getComputedStyle(n);
                const v = rgb(cs.backgroundColor);
                if (v.length >= 3) {
                  const al = v.length >= 4 ? v[3] : 1;
                  if (al >= 0.95) { bg = v.slice(0, 3); break; }
                  if (al > 0) layers.push([v[0], v[1], v[2], al]);
                }
                const g = (cs.backgroundImage || '').match(/rgba?\(([^)]+)\)/);
                if (g) { const gv = g[1].split(',').map(Number); bg = gv.slice(0, 3); break; }
                n = n.parentElement;
              }
              if (!bg) return { ratio: 0, ink: '', bg: 'none found', at: 'none' };
              for (let i = layers.length - 1; i >= 0; i--) { const [r, g2, b2, al] = layers[i]; bg = [r * al + bg[0] * (1 - al), g2 * al + bg[1] * (1 - al), b2 * al + bg[2] * (1 - al)]; }
              const ink = rgb(getComputedStyle(c).color);
              const a = lum(ink), b = lum(bg);
              return { ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 10) / 10, ink: ink.join(','), bg: bg.map(Math.round).join(','), at: n ? (n.id || n.className || n.tagName) : 'none' };
            })() })),   // #3952: the code in the shared boxes
          listPending: document.querySelectorAll('#plus-devlist [data-ask]').length, listNames: [...document.querySelectorAll('#plus-devlist .devname')].map((e) => e.textContent.trim()),
          leftBar: [...document.querySelectorAll('#plus-ask-rows .askreq')].every((c) => getComputedStyle(c).borderLeftWidth === getComputedStyle(c).borderTopWidth),
        };
      });
      const t = `[${key}]`;
      if (key === 'down') {
        // Review: switched on but not running is NOT "Connecting" (the engine's sentence says why).
        chk(v.pill === 'Not connected' && v.pillState === 'down', `${t} on but not running reads "Not connected", not "Connecting"`, v.pill);
        chk(/No relay address is set yet/i.test(v.status) && !v.chip, `${t} the engine's reason is the line, and no address chip`, v.status);
      } else if (key === 'off') {
        chk(v.pill === 'Off' && v.pillState === 'off', `${t} the pill says Off`, JSON.stringify(v));
        chk(v.sw === 'Turn on' && /uprime/.test(v.swClass), `${t} Turn on is the one primary action`, v.sw + ' ' + v.swClass);
        chk(!v.chip, `${t} no address chip while off`);
      } else {
        chk(v.pill === 'Connected' && v.pillState === 'up', `${t} a green Connected pill`, v.pill);
        chk(v.chip && v.chipAddr === ADDR && v.open === 'https://' + ADDR + '/', `${t} the address in one chip with Open to it`, JSON.stringify({ chip: v.chip, a: v.chipAddr, open: v.open }));
        chk(v.status === 'To use Kosmos on another device, sign in at login.kosmosplus.com.' && !v.copy, `${t} one plain line under the chip (Josh's 17:30 wording), and no Copy`, v.status);
        chk(v.sw === 'Pause' && v.swClass === 'plus-quiet', `${t} Pause (was Turn off, #4079) is quiet, not a headline button`, v.sw + ' ' + v.swClass);
        chk(v.account === 'https://login.kosmosplus.com/', `${t} View my account opens the web account`, v.account);
      }
      if (key === 'off' || key === 'connected' || key === 'down') chk(!v.cardShown, `${t} CONTROL: no request, no card`);
      if (key === 'one') {
        chk(v.cardShown && v.reqs === 1, `${t} one request is one card`, String(v.reqs));
        chk(/Windows browser/.test(v.cardText) && !/phone/i.test(v.cardText), `${t} a Windows browser is never called a phone`, v.cardText);
        chk(/Allow only if this code is showing on the device in your hand\./.test(v.cardText) && /\bAllow\b/.test(v.cardText) && /\bDeny\b/.test(v.cardText) && !/Not now|Not me/.test(v.cardText), `${t} one sentence, Allow / Deny, no Not now or Not me`, v.cardText);
        chk(v.codes.length === 1 && v.codes[0].t === 'VR-D6' && v.codes[0].label === 'V R, D 6' && v.codes[0].cells === 4 && v.codes[0].h >= 30 && v.codes[0].inside && v.codes[0].nextIsActs && v.codes[0].contrast.ratio >= 4.5, `${t} the code is shown large, one box per character, inside its card (#3952)`, JSON.stringify(v.codes));
        chk(v.listPending === 0, `${t} the request is not repeated in the devices list`, String(v.listPending));
        chk(v.leftBar, `${t} no solid left bar on the card (#3692)`);
        // #3829 addendum (Josh 20:00): on Kosmos Plus the requests sit directly ABOVE the panel at its width; no top banner.
        chk(v.inPanel && !v.topCardShown && v.asksAbove && Math.abs(v.panelW - v.flowW) <= 2, `${t} the request sits above the panel at the panel's width, not as a top banner`, JSON.stringify({ inPanel: v.inPanel, top: v.topCardShown, above: v.asksAbove, w: [v.panelW, v.flowW] }));
        // Elsewhere: one compact notice at the top that links to Kosmos Plus.
        await page.evaluate(() => showTab('agents'));
        await page.waitForTimeout(300);
        const other = await page.evaluate(() => ({ shown: !document.getElementById('askcard').hidden, text: document.getElementById('askcard').innerText.replace(/\s+/g, ' ').trim(), cards: document.querySelectorAll('#askcard .askreq').length, link: !!document.querySelector('#askcard [data-ask="open"]') }));
        chk(other.shown && other.cards === 0 && other.link && /asking to use this Kosmos/.test(other.text), `${t} on another view, only a compact notice with a link`, JSON.stringify(other));
        await page.click('#askcard [data-ask="open"]');
        await page.waitForTimeout(400);
        chk(await page.evaluate(() => !document.getElementById('plus-asks').hidden && document.getElementById('askcard').hidden), `${t} the notice's link opens Kosmos Plus with the request above the panel`);
      }
      if (key === 'one') {
        /* #3978: the rows were rebuilt on every 5-second poll, so focus on Allow was lost. Focus it from
           the keyboard, mark the node, sit through two REAL polls (setInterval 5000, not a direct call),
           and it must be the same node, still focused, with its time still filled in. */
        await page.evaluate(() => { const b = document.querySelector('#plus-ask-rows [data-ask="allow"]'); if (b) { b.focus(); b.__k3978 = 1; } });
        await page.waitForTimeout(10600);
        const f = await page.evaluate(() => {
          const b = document.querySelector('#plus-ask-rows [data-ask="allow"]');
          const a = document.activeElement;
          const ago = document.querySelector('#plus-ask-rows .askwho [data-ask-ago]');
          return { same: !!(b && b.__k3978 === 1), focused: !!(a && a.__k3978 === 1), ago: ago ? ago.textContent : null };
        });
        chk(f.same && f.focused, `${t} #3978: two polls later Allow is the same button and still has keyboard focus`, JSON.stringify(f));
        // The request is two minutes old when the script starts; a slow machine can make it three by now.
        chk(/^\d+ minutes? ago$/.test(f.ago || ''), `${t} #3978: the request's time is filled in place`, JSON.stringify(f));
        /* A REAL change still rewrites the row: the request crosses the hour and fades. Focus must come
           back to its Allow (a new node now, found by what it does and for whom). Aged in the stub the
           route serves, then put back, so the screenshot below is the two-minute-old request. */
        const firstSeen = st.pending[0].first_seen;
        st.pending[0].first_seen = now() - 2 * 3600;
        await page.waitForFunction(() => !!document.querySelector('#plus-ask-rows .askreq.stale'), null, { timeout: 12000 }).catch(() => {});
        const h = await page.evaluate(() => {
          const a = document.activeElement;
          return { stale: !!document.querySelector('#plus-ask-rows .askreq.stale'), allow: !!(a && a.dataset && a.dataset.ask === 'allow' && a.dataset.id === 'd-win'), fresh: !!(a && a.__k3978 !== 1) };
        });
        chk(h.stale && h.allow && h.fresh, `${t} #3978: a request that fades past the hour is rewritten, and focus comes back to its Allow`, JSON.stringify(h));
        st.pending[0].first_seen = firstSeen;
        await page.waitForFunction(() => !document.querySelector('#plus-ask-rows .askreq.stale'), null, { timeout: 12000 }).catch(() => {});
        // The compact notice on another view has the same rebuild; its Review button keeps focus too.
        await page.evaluate(() => showTab('agents'));
        await page.waitForTimeout(300);
        await page.evaluate(() => { const b = document.querySelector('#askcard [data-ask="open"]'); if (b) { b.focus(); b.__k3978 = 2; } });
        await page.waitForTimeout(10600);
        const g = await page.evaluate(() => { const a = document.activeElement; const b = document.querySelector('#askcard [data-ask="open"]'); return { same: !!(b && b.__k3978 === 2), focused: !!(a && a.__k3978 === 2) }; });
        chk(g.same && g.focused, `${t} #3978: two polls later the notice's Review is the same button and still has keyboard focus`, JSON.stringify(g));
        await page.evaluate(() => { showTab('settings'); });
        await page.click('#s-nav button[data-go="plus"]');
        await page.waitForSelector('#plus-flow', { state: 'visible', timeout: 5000 });
      }
      if (key === 'two') {
        chk(v.reqs === 2 && v.stale === 1, `${t} two cards, the one older than an hour faded`, JSON.stringify({ reqs: v.reqs, stale: v.stale }));
        chk(/Unknown device/.test(v.cardText) && !/\bdevice\b[^s]*\bis asking/.test(v.cardText), `${t} an unnamed request reads "Unknown device"`, v.cardText);
      }
      chk(!v.listNames.some((n) => n === 'device') && v.listNames.includes('Unknown device'), `${t} an unnamed devices-list row reads "Unknown device", never just "device"`, JSON.stringify(v.listNames));
      chk(v.listNames.includes('This computer (Kosmos app)'), `${t} this Mac's own sign-in row reads "This computer (Kosmos app)" (ICK's finding)`, JSON.stringify(v.listNames));
      if (SHOTS) { await page.setViewportSize({ width: 1400, height: 1300 }); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200); await page.screenshot({ path: path.join(SHOTS, `3829-${key}.png`) }); }
      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      await page.close();
    }
    /* #4079: Disconnect this computer. Three outcomes of the engine's /api/remote/forget, each on a connected
       pane: the account was told (the pane goes back to not connected and says it is done), the account could
       not be told (the same, saying the address may still show on the account), and the engine failed (the
       pane stays connected and says so). The confirm is checked to survive the 5-second repaint and to cancel. */
    const UNTOLD = 'this computer is forgotten here, but your Kosmos+ account could not be updated (the coordinator did not answer); its address may still show on your account page until you remove it there';
    for (const mode of ['told', 'untold', 'fails']) {
      const t = `[disconnect ${mode}]`;
      let enrolled = true; let forgets = 0;
      const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
      const errs = []; page.on('pageerror', (e) => errs.push(e.message));
      const json = (o, status) => ({ status: status || 200, contentType: 'application/json', body: JSON.stringify(o) });
      const base = STATES.connected.remote;
      await page.route('**/api/remote', (route, req) => route.fulfill(json(req.method() === 'GET' ? (enrolled ? base : { configured: true, on: false, ok: true, enrolled: false, status: { state: 'off' } }) : { ok: true })));
      await page.route('**/api/remote/pending', (route) => route.fulfill(json({ devices: [], email: 'you@example.com', self_device_id: 'd-self' })));
      await page.route('**/api/remote/devices**', (route) => route.fulfill(json({ on: true, allowed: [], pending: [], self_device_id: 'd-self' })));
      await page.route('**/api/remote/forget', (route) => {
        forgets += 1;
        if (mode === 'fails') return route.fulfill(json({ error: 'we could not forget this computer: the tunnel program did not start' }, 500));
        enrolled = false;
        return route.fulfill(json(mode === 'told' ? { ok: true, retired: true, address: ADDR, because: null } : { ok: true, retired: false, address: ADDR, because: UNTOLD }));
      });
      await page.goto(BASE, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
      await page.evaluate(() => showTab('settings'));
      await page.click('#s-nav button[data-go="plus"]');
      await page.waitForSelector('#plus-flow', { state: 'visible', timeout: 5000 });
      const vis = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!(e && !e.closest('[hidden]') && e.getBoundingClientRect().height > 0); }, sel);
      chk(await vis('#plus-forget-go'), `${t} a connected computer shows Disconnect this computer`);
      chk(!(await vis('#plus-forget-ask')), `${t} the confirm is closed to begin with`);
      await page.click('#plus-forget-go');
      await page.waitForTimeout(5600);   // one 5-second repaint of the pane
      chk(await vis('#plus-forget-ask') && await vis('#plus-forget-yes') && !(await vis('#plus-forget-go')), `${t} the confirm opens and is still open after the 5-second repaint`);
      const sure = await page.textContent('#plus-forget-sure');
      chk(/leaves your Kosmos Plus account/.test(sure) && /address is freed/.test(sure) && /connect it again later by signing in/.test(sure), `${t} the confirm says what happens and how to come back`, sure);
      const focusOn = await page.evaluate(() => document.activeElement && document.activeElement.id);
      chk(focusOn === 'plus-forget-no', `${t} opening the confirm puts focus on Cancel, not on Disconnect`, String(focusOn));
      await page.click('#plus-forget-no');
      chk(!(await vis('#plus-forget-ask')) && await vis('#plus-forget-go') && forgets === 0, `${t} Cancel closes it and nothing was sent`, 'forgets=' + forgets);
      await page.click('#plus-forget-go');
      await page.click('#plus-forget-yes');
      await page.waitForTimeout(700);
      const after = await page.evaluate(() => ({ state1: !document.getElementById('plus-state1').hidden, flow: !document.getElementById('plus-flow').hidden,
        forgot: (document.getElementById('plus-forgot-msg') || {}).textContent || '', forgotShown: !document.getElementById('plus-forgot-msg').hidden,
        inPane: (document.getElementById('plus-forget-msg') || {}).textContent || '' }));
      chk(forgets === 1, `${t} Disconnect sends one request`, 'forgets=' + forgets);
      if (mode === 'told') chk(after.state1 && !after.flow && after.forgotShown && /^This computer is disconnected from Kosmos Plus\./.test(after.forgot), `${t} the pane goes back to not connected and says it is done`, JSON.stringify(after));
      if (mode === 'untold') chk(after.state1 && !after.flow && after.forgotShown && /could not be updated/.test(after.forgot) && /may still show on your account page/.test(after.forgot) && !/is disconnected from Kosmos Plus\./.test(after.forgot), `${t} it says the account could not be told and the address may still show, never "done"`, JSON.stringify(after));
      if (mode === 'fails') chk(!after.state1 && after.flow && /^Disconnecting did not finish: the tunnel program did not start\. Try again in a moment\.$/.test(after.inPane), `${t} a failed disconnect keeps the connected pane and says it did not finish, in one clean sentence`, JSON.stringify(after));

      if (SHOTS && mode !== 'fails') { await page.screenshot({ path: path.join(SHOTS, `4079-after-${mode}.png`) }); }
      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
  }
  if (fail.length) { console.error('render-plus-panel-3829: ' + fail.length + ' check(s) failed'); process.exit(1); }
  console.log('render-plus-panel-3829: the connected panel and the request cards read and look as designed.');
})().catch((err) => {
  console.error('FAIL  render-plus-panel-3829: the check itself threw: ' + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});
