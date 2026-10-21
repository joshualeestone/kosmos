// Browser-check-surface: plus-asks plus-paused plus-asks-title askcard
// (#2518) the tokens this check asserts: what the Plus screen shows while Kosmos+ is paused for maintenance.
/* kosmos#6666: while Kosmos+ is paused the tunnel withholds new requests and says so (pending answers paused: true,
 * kosmos#6656; code checks in progress still show). The page must say why no new request shows, in the Plus section
 * only, rather than show nothing.
 *
 * 🔑 WHAT ONLY A BROWSER CAN SAY: that the section really opens on the paused line alone (no "Waiting for you" over an
 * empty list), and that on another view the compact top card stays away, since there is nothing to act on.
 * CONTROLS: the same page with paused false shows no section, and paused with a request still listed shows the
 * request too.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-plus-paused-6666.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluspaused-6666-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluspaused-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluspaused-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluspaused-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluspaused-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-plus-paused-6666: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); }
const now = () => Math.floor(Date.now() / 1000);
const REMOTE = { configured: true, on: true, ok: true, enrolled: true, email: 'you@example.com', status: { state: 'up', address: 'you1021.kosmosplus.com' } };
const PHONE = { device_id: 'd-phone', name: 'iPhone · Safari', code: 'W6-M4', first_seen: now() - 60 };

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const W of [1400, 390]) {
      const page = await browser.newPage({ viewport: { width: W, height: W > 800 ? 950 : 844 } });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      const json = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      await page.route('**/api/remote', (route, req) => route.fulfill(json(req.method() === 'GET' ? REMOTE : { ok: true })));
      // The served answer is the check's to change; serve() then polls, so the page's own poll serves the same answer.
      const cur = { body: { devices: [], paused: true } };
      await page.route('**/api/remote/pending', (route) => route.fulfill(json(Object.assign({ email: 'you@example.com', self_device_id: 'd-self' }, cur.body))));
      await page.route('**/api/remote/devices**', (route) => route.fulfill(json({ on: true, allowed: [] })));
      const serve = async (body) => { cur.body = body; await page.evaluate(async () => { await pollAsk(); paintAsk(); }); await page.waitForTimeout(100); };
      const read = () => page.evaluate(() => {
        const vis = (id) => { const e = document.getElementById(id); return !!(e && !e.hidden && e.getBoundingClientRect().height > 0); };
        const p = document.getElementById('plus-paused');
        return { asks: vis('plus-asks'), paused: vis('plus-paused'), title: vis('plus-asks-title'), top: vis('askcard'),
          rows: document.querySelectorAll('#plus-ask-rows .askreq').length, text: p ? p.innerText.replace(/\s+/g, ' ').trim() : '' };
      });
      await page.goto(BASE, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
      await page.evaluate(() => showTab('settings'));
      await page.evaluate(() => { const b = document.querySelector('#s-nav button[data-go="plus"]'); if (b) b.click(); });
      await page.waitForSelector('#plus-flow', { state: 'visible', timeout: 5000 });

      await serve({ devices: [], paused: true });
      const on = await read();
      chk(on.asks && on.paused, '[' + W + '] paused with nothing listed: the Plus section opens on the paused line', JSON.stringify(on));
      chk(/^Kosmos\+ is paused for maintenance\./.test(on.text), '[' + W + '] the line says Kosmos+ is paused for maintenance', on.text);
      chk(!on.title && on.rows === 0, '[' + W + '] and no "Waiting for you" over an empty list', JSON.stringify(on));

      await serve({ devices: [], paused: false });
      const off = await read();
      chk(!off.asks && !off.paused, '[' + W + '] CONTROL: not paused and nothing listed, no section at all', JSON.stringify(off));

      await serve({ devices: [PHONE], paused: true });
      const both = await read();
      chk(both.asks && both.paused && both.rows === 1 && both.title, '[' + W + '] CONTROL: paused with a request still listed shows both, and "Waiting for you" over it', JSON.stringify(both));

      // Pressing Allow on that row while paused: the board answers 400 with the paused words (server.js maps a refused
      // deviceAllow to its `because`), and the card must say them, never "connected".
      const PAUSED_WORDS = 'Kosmos+ is paused for maintenance, so no new device can be allowed right now. This request may need to ask again once Kosmos+ is back.';
      await page.route('**/api/remote/devices/allow', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: PAUSED_WORDS }) }));
      await page.click('#plus-ask-rows [data-ask="allow"][data-id="d-phone"]');
      await page.waitForTimeout(300);
      const pressed = await page.evaluate(() => ({ state: ASK.done['d-phone'] && ASK.done['d-phone'].state,
        text: document.getElementById('plus-ask-rows').innerText.replace(/\s+/g, ' ').trim() }));
      chk(pressed.state === 'error' && pressed.text.includes('no new device can be allowed right now') && !/connected/i.test(pressed.text),
        '[' + W + '] Allow pressed while paused: the card says the paused words, not connected', JSON.stringify(pressed));
      await page.unroute('**/api/remote/devices/allow');
      await page.evaluate(() => { ASK.done = {}; paintAsk(); });

      // On another view the top card stays away while only the pause is showing: nothing there to act on.
      await serve({ devices: [], paused: true });
      await page.evaluate(() => { showTab('agents'); paintAsk(); });
      await page.waitForTimeout(150);
      const away = await read();
      chk(!away.top, '[' + W + '] elsewhere, a pause alone brings no top card', JSON.stringify(away));
      // Still paused: the pause must not hide a real request's notice.
      await serve({ devices: [PHONE], paused: true });
      await page.evaluate(() => paintAsk());
      const awayCtl = await read();
      chk(awayCtl.top, '[' + W + '] CONTROL: elsewhere, a real request still brings the top card, paused or not', JSON.stringify(awayCtl));

      chk(errs.length === 0, '[' + W + '] no page errors', errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall plus-paused checks passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
