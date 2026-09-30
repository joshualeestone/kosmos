// Browser-check-surface: plus-asks plus-ask-rows plus-asks-title askcard ask-rows
'use strict';
/**
 * The "wants to connect" sheet (#4637, Josh 09-29: "radically redesign... doesn't fit the branding"; Mona Lisa's flow
 * outline on #4754, Josh's go 09-30 17:34).
 *
 * What this pins, and why each line can fail:
 *  - another of the person's computers joining (#4773's joining_computer) reads "Your computer "windowsbox" wants to
 *    join", with "Allow it if you just signed it in, and it shows this code."; a phone beside it (the CONTROL) keeps its
 *    own name and the device-in-your-hand line;
 *  - each sheet carries the Kosmos+ brand, the code once as one large line read out a character at a time, then
 *    Allow and a quiet Not me (no Deny, no letter boxes);
 *  - Allow on the computer turns its sheet into "windowsbox is connected." with where to remove it;
 *  - on another page the notice says the same words ("Your computer "windowsbox" wants to join.") with Review;
 *  - 1400 and 390 wide, no sideways scroll, no page errors.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   HEADED=0 node docs/browser-checks/render-connect-sheet-4637.js
 */
require('./lib-sandbox-home.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-connect-sheet-4637: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}
const now = () => Math.floor(Date.now() / 1000);
const REMOTE = { configured: true, on: true, ok: true, enrolled: true, email: 'you@example.com', status: { state: 'up', address: 'hers.kosmosplus.com' } };

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const width of [1400, 390]) {
      const tag = `[${width}]`;
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      const json = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      let pending = [
        { device_id: 'd-pc', name: 'windowsbox', code: 'X3-P2', first_seen: now() - 30, joining_computer: 'windowsbox' },
        { device_id: 'd-ph', name: 'iPhone', code: 'K7-4M', first_seen: now() - 90, joining_computer: null },
      ];
      await page.route('**/api/remote', (route, req) => route.fulfill(json(req.method() === 'GET' ? REMOTE : { ok: true })));
      await page.route('**/api/remote/pending', (route) => route.fulfill(json({ devices: pending, email: 'you@example.com' })));
      await page.route('**/api/remote/devices/allow', (route) => { pending = pending.filter((d) => d.device_id !== 'd-pc'); return route.fulfill(json({ ok: true })); });
      await page.route('**/api/remote/devices', (route) => route.fulfill(json({ on: true, allowed: [], pending })));
      await page.goto(BASE, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }

      /* On another page: the compact notice, in the same words. */
      await page.evaluate(() => { if (typeof pollAsk === 'function') return pollAsk(); });
      await page.waitForTimeout(500);
      const note = await page.evaluate(() => {
        const c = document.getElementById('askcard');
        return { shown: !!(c && !c.hidden && c.getBoundingClientRect().height > 0), text: (c && c.innerText || '').replace(/\s+/g, ' ').trim(), review: !!(c && c.querySelector('[data-ask="open"]')) };
      });
      chk(note.shown && /2 devices want to connect to your Kosmos\./.test(note.text) && note.review && /kosmos\+/i.test(note.text), `${tag} on another page: a Kosmos+ notice with Review`, JSON.stringify(note));

      /* On Kosmos Plus: the sheets. */
      await page.evaluate(() => showTab('settings'));
      await page.click('#s-nav button[data-go="plus"]');
      await page.waitForSelector('#plus-flow', { state: 'visible', timeout: 5000 });
      await page.evaluate(() => { if (typeof pollAsk === 'function') return pollAsk(); });
      await page.waitForSelector('#plus-ask-rows .askreq', { timeout: 5000 }).catch(() => {});
      const sheets = await page.evaluate(() => [...document.querySelectorAll('#plus-ask-rows .askreq')].map((r) => {
        const code = r.querySelector('.askcodebig');
        const acts = [...r.querySelectorAll('.acts button')].map((b) => b.textContent.trim());
        return { brand: (r.querySelector('.askbrand') || {}).textContent || '', head: (r.querySelector('.askwho b') || {}).textContent || '',
          say: (r.querySelector('.asksay') || {}).textContent || '', code: code ? code.textContent : '', label: code ? code.getAttribute('aria-label') : '',
          size: code ? parseFloat(getComputedStyle(code).fontSize) : 0, boxes: r.querySelectorAll('.devcode-cell').length,
          aboveActs: !!(code && code.nextElementSibling && code.nextElementSibling.classList.contains('acts')), acts,
          inside: !code || code.getBoundingClientRect().right <= r.getBoundingClientRect().right + 0.5 };
      }));
      const pc = sheets.find((x) => /windowsbox/.test(x.head)) || {};
      const ph = sheets.find((x) => /iPhone/.test(x.head)) || {};
      chk(pc.head === 'Your computer "windowsbox" wants to join' && pc.say === 'Allow it if you just signed it in, and it shows this code.',
        `${tag} a computer joining reads as one of your own computers`, JSON.stringify(pc));
      chk(ph.head === 'iPhone wants to connect to your Kosmos' && /Allow only if this code is showing on the device in your hand\./.test(ph.say) && !/signed it in/.test(ph.say),
        `${tag} CONTROL: a phone keeps its own name and the device-in-your-hand line`, JSON.stringify(ph));
      chk(sheets.length === 2 && sheets.every((x) => /kosmos\+/i.test(x.brand) && x.boxes === 0 && x.size >= 28 && x.aboveActs && x.inside && JSON.stringify(x.acts) === JSON.stringify(['Allow', 'Not me'])),
        `${tag} each sheet: the Kosmos+ brand, the code once and large (no boxes), directly above Allow and Not me`, JSON.stringify(sheets));
      chk(pc.code === 'X3-P2' && pc.label === 'X 3, P 2', `${tag} the code is read out a character at a time`, JSON.stringify([pc.code, pc.label]));
      chk(await page.evaluate(() => document.getElementById('plus-asks-title').textContent) === 'Waiting for you', `${tag} the section says Waiting for you, not the old wording`);

      /* Allow the computer: its sheet says it is connected. */
      await page.click('#plus-ask-rows [data-ask="allow"][data-id="d-pc"]');
      await page.waitForFunction(() => /windowsbox is connected\./.test(document.getElementById('plus-ask-rows').innerText), null, { timeout: 5000 }).catch(() => {});
      const done = await page.evaluate(() => (document.getElementById('plus-ask-rows').innerText || '').replace(/\s+/g, ' '));
      chk(/windowsbox is connected\. Your computers now trust each other\. You can remove it any time under Devices\./.test(done),
        `${tag} after Allow: "windowsbox is connected." and where to remove it`, done);
      chk(/iPhone wants to connect to your Kosmos/.test(done), `${tag} the other request is still waiting`, done);

      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      chk(wide <= 0, `${tag} no sideways scroll`, String(wide));
      chk(errs.length === 0, `${tag} no page errors`, JSON.stringify(errs));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
    for (const d of SANDBOXES) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(fail.length ? `\nFAIL: ${fail.length}` : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
