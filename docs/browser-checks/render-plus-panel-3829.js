// Browser-check-surface: plus-flow plus-pill plus-chip plus-account plus-switch askcard ask-rows plus-devlist
'use strict';
/**
 * #3829 (Josh, 2026-09-25 16:54: the connected Kosmos+ panel and the device approval are "terribly
 * worded and designed"; his 17:19 shots: "the phone is showing the code" for a Windows browser, and a
 * list row named just "device"; Mona Lisa's sketch on the card). Four states, each asserted and shot:
 *   off         -> the pill says Off, Turn on is the one primary action, no address chip;
 *   connected   -> a green Connected pill, the address in ONE chip with Copy and Open, one plain line,
 *                  Turn off quiet, and View my account pointing at the web account;
 *   one request -> a compact card: the device, when, the code LARGE, one device-neutral sentence,
 *                  Allow / Deny; no Not now, no Not me; the request is NOT repeated in the devices list;
 *   two requests-> one stale (older than an hour, faded) and one unnamed ("Unknown device").
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
      await page.route('**/api/remote/pending', (route) => route.fulfill(json({ devices: st.pending, email: 'you@example.com' })));
      await page.route('**/api/remote/devices**', (route) => route.fulfill(json({ on: st.remote.on, allowed: [{ device_id: 'd-mac', name: 'Mac browser', allowed_at: now() - 86400, last_seen: now() - 600 }, { device_id: 'd-noname', allowed_at: now() - 7200 }], pending: st.pending })));
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
          chip: vis('plus-chip'), chipAddr: document.getElementById('plus-chip-addr').textContent.trim(),
          open: document.getElementById('plus-open').getAttribute('href'), account: document.getElementById('plus-account').getAttribute('href'),
          status: document.getElementById('plus-status').textContent.trim(), sw: sw.textContent.trim(), swClass: sw.className,
          cardShown: vis('askcard'), cardText: card ? card.innerText.replace(/\s+/g, ' ') : '',
          reqs: document.querySelectorAll('#ask-rows .askreq').length, stale: document.querySelectorAll('#ask-rows .askreq.stale').length,
          codes: [...document.querySelectorAll('#ask-rows .askcode')].map((e) => ({ t: e.textContent, px: parseFloat(getComputedStyle(e).fontSize) })),
          listPending: document.querySelectorAll('#plus-devlist .devrow.pending').length, listNames: [...document.querySelectorAll('#plus-devlist .devname')].map((e) => e.textContent.trim()),
          leftBar: card ? getComputedStyle(card).borderLeftWidth === getComputedStyle(card).borderTopWidth : true,
        };
      });
      const t = `[${key}]`;
      if (key === 'off') {
        chk(v.pill === 'Off' && v.pillState === 'off', `${t} the pill says Off`, JSON.stringify(v));
        chk(v.sw === 'Turn on' && /uprime/.test(v.swClass), `${t} Turn on is the one primary action`, v.sw + ' ' + v.swClass);
        chk(!v.chip, `${t} no address chip while off`);
      } else {
        chk(v.pill === 'Connected' && v.pillState === 'up', `${t} a green Connected pill`, v.pill);
        chk(v.chip && v.chipAddr === ADDR && v.open === 'https://' + ADDR + '/', `${t} the address in one chip with Open to it`, JSON.stringify({ chip: v.chip, a: v.chipAddr, open: v.open }));
        chk(v.status === 'Open this address in any browser, or sign in on the Kosmos+ mobile apps.', `${t} one plain line under the chip`, v.status);
        chk(v.sw === 'Turn off' && v.swClass === 'plus-quiet', `${t} Turn off is quiet, not a headline button`, v.sw + ' ' + v.swClass);
        chk(v.account === 'https://login.kosmosplus.com/', `${t} View my account opens the web account`, v.account);
      }
      if (key === 'off' || key === 'connected') chk(!v.cardShown, `${t} CONTROL: no request, no card`);
      if (key === 'one') {
        chk(v.cardShown && v.reqs === 1, `${t} one request is one card`, String(v.reqs));
        chk(/Windows browser/.test(v.cardText) && !/phone/i.test(v.cardText), `${t} a Windows browser is never called a phone`, v.cardText);
        chk(/Allow only if this code is showing on the device in your hand\./.test(v.cardText) && /\bAllow\b/.test(v.cardText) && /\bDeny\b/.test(v.cardText) && !/Not now|Not me/.test(v.cardText), `${t} one sentence, Allow / Deny, no Not now or Not me`, v.cardText);
        chk(v.codes.length === 1 && v.codes[0].t === 'VR-D6' && v.codes[0].px >= 24, `${t} the code is shown large`, JSON.stringify(v.codes));
        chk(v.listPending === 0, `${t} the request is not repeated in the devices list`, String(v.listPending));
        chk(v.leftBar, `${t} no solid left bar on the card (#3692)`);
      }
      if (key === 'two') {
        chk(v.reqs === 2 && v.stale === 1, `${t} two cards, the one older than an hour faded`, JSON.stringify({ reqs: v.reqs, stale: v.stale }));
        chk(/Unknown device/.test(v.cardText) && !/\bdevice\b[^s]*\bis asking/.test(v.cardText), `${t} an unnamed request reads "Unknown device"`, v.cardText);
      }
      chk(!v.listNames.some((n) => n === 'device') && v.listNames.includes('Unknown device'), `${t} an unnamed devices-list row reads "Unknown device", never just "device"`, JSON.stringify(v.listNames));
      if (SHOTS) { await page.setViewportSize({ width: 1400, height: 1300 }); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200); await page.screenshot({ path: path.join(SHOTS, `3829-${key}.png`) }); }
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
