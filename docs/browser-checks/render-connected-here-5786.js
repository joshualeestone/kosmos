// Browser-check-surface: plus-ask-rows plus-asks-title askBrowserWord here-undo here-ok on_this_computer
'use strict';
/**
 * kosmos#5786 (b) (Josh, 2026-10-10 14:02: "this should automatically just allow since i am on this computer"): the
 * browser this computer opened, signed in to the account, is allowed without a sheet, and the Plus section says so.
 *
 * What this pins, and why each line can fail:
 *  - with the engine's connected_here set and nothing waiting, #plus-ask-rows reads "Safari on this computer is
 *    connected." (the browser word out of "Mac · Safari"), with Undo and Got it, and no "Waiting for you" heading;
 *  - a first Undo that fails (500) shows the server's reason and keeps Undo; the next posts that device id
 *    to /api/remote/devices/remove and the line says what the Remove reached (the Devices list's words);
 *  - Got it puts the line away; with connected_here null (the CONTROL) the line never shows;
 *  - in the Devices list a device with on_this_computer says "on this computer", and one without (the CONTROL) does not;
 *  - 1400 and 390 wide, no sideways scroll, no page errors.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   HEADED=0 node docs/browser-checks/render-connected-here-5786.js
 */
require('./lib-sandbox-home.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-here-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-here-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-here-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-here-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-here-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-connected-here-5786: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }
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
      let here = null;   // the CONTROL first: nothing was connected this way
      const removed = [];
      await page.route('**/api/remote', (route, req) => route.fulfill(json(req.method() === 'GET' ? REMOTE : { ok: true })));
      await page.route('**/api/remote/pending', (route) => route.fulfill(json({ devices: [], email: 'you@example.com', connected_here: here })));
      let removeFailsOnce = true;   // the first Undo fails: the notice must say so and keep its Undo
      await page.route('**/api/remote/devices/remove', (route, req) => {
        const id = JSON.parse(req.postData() || '{}').device_id;
        if (removeFailsOnce) { removeFailsOnce = false; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'the tunnel did not answer' }) }); }
        removed.push(id); if (here && here.device_id === id) here = null;
        return route.fulfill(json({ ok: true }));
      });
      await page.route('**/api/remote/devices', (route) => route.fulfill(json({ on: true, pending: [], allowed: [
        { device_id: 'd-saf', name: 'Mac \u00b7 Safari', allowed_at: now() - 60, last_seen: 0, on_this_computer: true },
        { device_id: 'd-ph', name: 'iPhone \u00b7 Safari', allowed_at: now() - 3600, last_seen: 0, on_this_computer: false },
      ] })));
      await page.goto(BASE, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
      await page.evaluate(() => showTab('settings'));
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
      await page.click('#s-nav button[data-go="plus"]');
      await page.waitForSelector('#plus-flow', { state: 'visible', timeout: 5000 });
      const rows = async () => { await page.evaluate(() => pollAsk()); await page.waitForTimeout(300);
        return page.evaluate(() => { const p = document.getElementById('plus-asks'); const r = document.getElementById('plus-ask-rows');
          return { shown: !!(p && !p.hidden), text: (r && r.innerText || '').replace(/\s+/g, ' ').trim(),
            title: !!(document.getElementById('plus-asks-title') && !document.getElementById('plus-asks-title').hidden),
            acts: r ? [...r.querySelectorAll('button')].map((b) => b.textContent.trim()) : [] }; }); };

      let r = await rows();
      chk(!/on this computer/.test(r.text), `${tag} CONTROL: with nothing connected this way, no line`, JSON.stringify(r));
      here = { device_id: 'd-saf', name: 'Mac \u00b7 Safari', at: now() - 5 };
      r = await rows();
      chk(r.shown && r.text.startsWith('Safari on this computer is connected.') && r.acts.join(',') === 'Undo,Got it' && !r.title,
        `${tag} "Safari on this computer is connected." with Undo and Got it, under no Waiting heading`, JSON.stringify(r));
      // A failed Undo: the sentence shows inside the notice, and Undo is still there to try again.
      await page.click('#plus-ask-rows [data-ask="here-undo"]');
      await page.waitForFunction(() => /tunnel did not answer/i.test(document.getElementById('plus-ask-rows').innerText), null, { timeout: 5000 }).catch(() => {});
      r = await rows();
      chk(/tunnel did not answer/i.test(r.text) && r.acts.includes('Undo') && removed.length === 0,
        `${tag} a failed Undo says so and keeps Undo`, JSON.stringify({ removed, r }));
      await page.click('#plus-ask-rows [data-ask="here-undo"]');
      await page.waitForFunction(() => /^Removed/.test(document.getElementById('plus-ask-rows').innerText.trim()), null, { timeout: 5000 }).catch(() => {});
      r = await rows();
      chk(removed.join(',') === 'd-saf' && /^Removed/.test(r.text), `${tag} Undo removes it and says what it reached (the Devices list's words)`, JSON.stringify({ removed, r }));
      await page.click('#plus-ask-rows [data-ask="here-ok"]');
      r = await rows();
      chk(!r.shown || r.text === '', `${tag} Got it puts the line away`, JSON.stringify(r));
      /* A fresh one, put away with Got it before any Undo. */
      here = { device_id: 'd-saf2', name: 'Mac \u00b7 Chrome', at: now() - 5 };
      r = await rows();
      chk(r.text.startsWith('Chrome on this computer is connected.'), `${tag} the browser word follows the device name`, r.text);
      await page.click('#plus-ask-rows [data-ask="here-ok"]');
      r = await rows();
      chk(!/on this computer/.test(r.text) && removed.length === 1, `${tag} Got it disconnects nothing`, JSON.stringify({ removed, r }));

      await page.evaluate(() => paintDevices());
      await page.waitForTimeout(400);
      const metas = await page.evaluate(() => [...document.querySelectorAll('#plus-devices .devrow')].map((d) => ({
        name: (d.querySelector('.devname') || {}).textContent || '', meta: (d.querySelector('.devmeta') || {}).textContent || '' })));
      const saf = metas.find((m) => /Mac/.test(m.name)), ph = metas.find((m) => /iPhone/.test(m.name));
      chk(saf && /^on this computer \u00b7 let in/.test(saf.meta) && ph && !/on this computer/.test(ph.meta),
        `${tag} the Devices list says "on this computer" only for the one allowed that way`, JSON.stringify(metas));
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
