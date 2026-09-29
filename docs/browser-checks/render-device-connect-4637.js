// Browser-check-surface: askcard ask-rows kp-modal kp-sheet kp-sheet-body plus-asks plus-ask-rows plus-devlist
/**
 * #4637 (Mona Lisa's design; Josh 15:12, "not a developer screen"): "another device wants to connect".
 *  1. The notice on any view: navy Kosmos+ card, who wants to connect (from the name the device sends), when, a gold
 *     Review. Several: "N devices want to connect".
 *  2. Review opens the approval sheet right there (not Settings): the code once as large text (no letter boxes), a gold
 *     Allow that is the only gold control, a quiet "Not me", the fine print. A bottom sheet at 390px. After Allow:
 *     "<who> is connected", Done, "See your devices". After Not me: "<who> was kept out". Several requests: Done moves
 *     to the next one, and the sheet closes when none is left.
 *  3. Your devices: each row has its icon and a red-outlined Remove.
 * Light and dark board. Words per name shape, pinned from the table on the card.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-device-connect-4637.js [shots-dir]
 */
'use strict';
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-devconnect-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-devconnect-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-devconnect-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-devconnect-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-devconnect-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-device-connect-4637: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const SHOTS = process.argv[2] || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const fail = [];
let passed = 0;
const chk = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (!ok && extra ? '  ' + String(extra).slice(0, 300) : '')); if (ok) passed += 1; else fail.push(label); };
const now = () => Math.floor(Date.now() / 1000);
const REMOTE = { configured: true, on: true, ok: true, enrolled: true, email: 'you@example.com', status: { state: 'up', address: 'josh09292026.kosmosplus.com' } };

async function open(browser, { width, scheme, pending }) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const st = { pending: pending.map((d) => ({ ...d })), allowed: [{ device_id: 'd-mac', name: 'Mac · Safari', allowed_at: now() - 86400, last_seen: now() - 600 }] };
  const json = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  await page.route('**/api/remote', (route, req) => route.fulfill(json(req.method() === 'GET' ? REMOTE : { ok: true })));
  await page.route('**/api/remote/pending', (route) => route.fulfill(json({ devices: st.pending, email: 'you@example.com' })));
  await page.route('**/api/remote/devices', (route) => route.fulfill(json({ on: true, allowed: st.allowed, pending: [] })));
  await page.route('**/api/remote/devices/*', (route, req) => {
    const id = req.postDataJSON().device_id;
    const d = st.pending.find((x) => x.device_id === id);
    st.pending = st.pending.filter((x) => x.device_id !== id);
    if (d && /allow$/.test(req.url())) st.allowed.push({ device_id: id, name: d.name, allowed_at: now() });
    route.fulfill(json({ ok: true }));
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
  await page.evaluate(() => { showTab('agents'); pollAsk(); });
  await page.waitForTimeout(500);
  return { page, errs, st };
}

const notice = (page) => page.evaluate(() => {
  const c = document.getElementById('askcard');
  const n = c.querySelector('.kp-notice');
  return { shown: !c.hidden && !!n, head: (c.querySelector('.kp-t b') || {}).textContent || '', sub: (c.querySelector('.kp-t > span') || {}).textContent || '',
    review: !!c.querySelector('.kp-gold[data-ask="open"]'), mark: !!c.querySelector('canvas.kp-mark[data-drawn]'),
    bg: n ? getComputedStyle(n).backgroundImage : '', w: n ? Math.round(n.getBoundingClientRect().width) : 0 };
});
const sheet = (page) => page.evaluate(() => {
  const m = document.getElementById('kp-modal');
  const s = document.getElementById('kp-sheet');
  const r = s.getBoundingClientRect();
  const gold = [...s.querySelectorAll('button')].filter((b) => /gradient/.test(getComputedStyle(b).backgroundImage) && b.getBoundingClientRect().height > 0).map((b) => b.textContent.trim());
  return { open: !m.hidden, head: (document.getElementById('kp-sheet-h') || {}).textContent || '', text: s.innerText.replace(/\s+/g, ' ').trim(),
    code: (s.querySelector('.kp-code') || {}).textContent || '', codePx: s.querySelector('.kp-code') ? parseFloat(getComputedStyle(s.querySelector('.kp-code')).fontSize) : 0,
    boxes: s.querySelectorAll('.devcode-cell').length, gold, focus: document.activeElement && (document.activeElement.getAttribute('data-ask') || ''),
    bottom: Math.round(innerHeight - r.bottom), left: Math.round(r.left), width: Math.round(r.width), vw: innerWidth, grab: getComputedStyle(s.querySelector('.kp-grab')).display };
});
let BASE = '';

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    // ---- words per name shape (Mona's table) ----
    for (const [name, head, sub] of [
      ['PizzaRama (Kosmos app)', 'PizzaRama wants to connect', /^Kosmos app · /],
      ['Windows PC · Edge', 'Your Windows PC wants to connect', /^Edge · /],
      ['iPhone · Safari', 'Your iPhone wants to connect', /^Safari · /],
      ['Browser', 'A browser wants to connect', /^(a moment ago|\d+ minutes? ago|just now)$/],
      [undefined, 'A browser wants to connect', /^(a moment ago|\d+ minutes? ago|just now)$/],
    ]) {
      const { page } = await open(browser, { width: 1400, scheme: 'light', pending: [{ device_id: 'd1', name, code: 'K7-3M', first_seen: now() - 90 }] });
      const n = await notice(page);
      chk(n.shown && n.head === head && sub.test(n.sub), `words: "${name}" reads "${head}"`, JSON.stringify(n));
      await page.close();
    }

    for (const scheme of ['light', 'dark']) {
      const t = `[${scheme}]`;
      const { page, errs } = await open(browser, { width: 1400, scheme, pending: [
        { device_id: 'd-pc', name: 'Windows PC · Edge', code: 'VR-D6', first_seen: now() - 120 },
        { device_id: 'd-ph', name: 'iPhone · Safari', code: 'W6-M4', first_seen: now() - 60, denied_at: now() - 3000 },
      ] });
      // 1. the notice
      const n = await notice(page);
      chk(n.shown && n.head === '2 devices want to connect' && n.review && n.mark && /radial-gradient/.test(n.bg) && n.w <= 640, `${t} the notice: navy Kosmos+ card, "2 devices want to connect", the mark, a gold Review`, JSON.stringify(n));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `4637-notice-${scheme}.png`), clip: { x: 0, y: 0, width: 1400, height: 260 } });
      // 2. Review opens the sheet right here
      await page.click('#askcard [data-ask="open"]');
      await page.waitForTimeout(400);
      let s = await sheet(page);
      chk(s.open && s.head === 'Your Windows PC wants to connect' && s.focus === 'allow', `${t} Review opens the sheet here, on the first request, focus on Allow`, JSON.stringify(s));
      chk(s.code === 'VR-D6' && s.codePx >= 28 && s.boxes === 0, `${t} the code once as large text, no letter boxes`, JSON.stringify({ code: s.code, px: s.codePx, boxes: s.boxes }));
      chk(JSON.stringify(s.gold) === '["Allow"]' && /Not me/.test(s.text) && /Make sure your Windows PC is showing this code/.test(s.text) && /Only allow a device you are signing in on right now\./.test(s.text), `${t} Allow is the only gold control; Not me and the fine print are there`, JSON.stringify(s));
      chk(await page.evaluate(() => document.getElementById('panel-settings').hidden), `${t} Review did not send the person to Settings`);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `4637-sheet-${scheme}.png`) });
      // Allow -> connected
      await page.click('#kp-sheet [data-ask="allow"]');
      await page.waitForTimeout(500);
      s = await sheet(page);
      chk(s.open && s.head === 'Your Windows PC is connected' && /It will open your Kosmos in a moment\./.test(s.text) && /See your devices/.test(s.text), `${t} after Allow: connected, Done, See your devices`, JSON.stringify(s));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `4637-allowed-${scheme}.png`) });
      // Done -> the next request, which asked again after a No
      await page.click('#kp-sheet [data-ask="gotit"]');
      await page.waitForTimeout(400);
      s = await sheet(page);
      chk(s.open && s.head === 'Your iPhone wants to connect' && /Asked again\./.test(s.text), `${t} Done moves on to the next request; it says it asked again after a No`, JSON.stringify(s));
      // Not me -> kept out
      await page.click('#kp-sheet [data-ask="deny"]');
      await page.waitForTimeout(500);
      s = await sheet(page);
      chk(s.head === 'Your iPhone was kept out' && /you@example\.com/.test(s.text) && /password/.test(s.text), `${t} after Not me: kept out, and what to do if it was not them`, JSON.stringify(s));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `4637-keptout-${scheme}.png`) });
      await page.click('#kp-sheet [data-ask="gotit"]');
      await page.waitForTimeout(400);
      s = await sheet(page);
      chk(!s.open, `${t} the sheet closes when no request is left`, JSON.stringify(s));
      // 3. Your devices
      await page.evaluate(() => { showTab('settings'); settingsGo('plus'); });
      await page.waitForTimeout(800);
      const devs = await page.evaluate(() => [...document.querySelectorAll('#plus-devlist .devrow')].map((r) => ({ name: (r.querySelector('.devname') || {}).textContent, icon: !!r.querySelector('.kp-devico svg'), rm: !!r.querySelector('.kp-rm[data-dev="remove"]') })));
      chk(devs.length >= 2 && devs.every((d) => d.icon && d.rm), `${t} Your devices: each row has its icon and a red-outlined Remove`, JSON.stringify(devs));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `4637-devices-${scheme}.png`) });
      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      await page.close();
    }

    // Phone: the notice full width with Review under the text; the sheet a bottom sheet with a grab handle.
    const { page: phone, errs: perrs } = await open(browser, { width: 390, scheme: 'light', pending: [{ device_id: 'd-app', name: 'PizzaRama (Kosmos app)', code: 'K7-3M', first_seen: now() - 30 }] });
    const pn = await phone.evaluate(() => { const b = document.querySelector('#askcard [data-ask="open"]').getBoundingClientRect(); const n = document.querySelector('#askcard .kp-notice').getBoundingClientRect(); return { btnW: Math.round(b.width), noticeW: Math.round(n.width) }; });
    chk(pn.btnW >= pn.noticeW - 40, '[390] the notice\'s Review is full width under the text', JSON.stringify(pn));
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, '4637-notice-phone.png') });
    await phone.click('#askcard [data-ask="open"]');
    await phone.waitForTimeout(400);
    const ps = await sheet(phone);
    chk(ps.open && ps.bottom <= 1 && ps.left <= 1 && ps.width >= ps.vw - 2 && ps.grab === 'block' && ps.head === 'PizzaRama wants to connect', '[390] the sheet is a bottom sheet with a grab handle', JSON.stringify(ps));
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, '4637-sheet-phone.png') });
    await phone.keyboard.press('Escape');
    await phone.waitForTimeout(200);
    chk(!(await sheet(phone)).open, '[390] Escape closes the sheet');
    chk(perrs.length === 0, '[390] no page errors', perrs.join(' | '));
    await phone.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fail.length ? passed + ' passed, ' + fail.length + ' FAILED' : 'render-device-connect-4637: all ' + passed + ' passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
