// Browser-check-surface: plus-devlist plus-devmsg
// Browser-check-functions: removedWords paintDevices
'use strict';
/**
 * #4824: after Remove on the Devices list, the person is told what the Remove reached, from the connector's
 * answer (kosmos#4803), and the line is still there after the list repaints (it used to be cleared by it).
 * Three answers, each through a real click on Remove then the confirm's Remove:
 *   told      -> signed_out true:  "Removed. Its current sign-in on your other computers ends too; it stays ..."
 *   not told  -> signed_out false: "Removed here. Kosmos+ could not confirm it ..."
 *   old       -> neither field (a connector from before kosmos#4803): "Removed here. It still opens your
 *                other computers until you remove it there too ...", said as how it works, not as a failure
 * The line must still be there after one of the page's own 5 s polls has repainted the list (counted, not timed).
 * CONTROL: the next Remove click clears it, so a line that never clears cannot pass.
 *
 *   HEADED=0 node docs/browser-checks/render-device-remove-4824.js [shotsDir]
 */
require('./lib-sandbox-home.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-devremove-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-devremove-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-devremove-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-devremove-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-devremove-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-device-remove-4824: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const SHOTS = process.argv[2] || null;
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}
const now = () => Math.floor(Date.now() / 1000);
const REMOTE = { configured: true, on: true, ok: true, enrolled: true, email: 'you@example.com', status: { state: 'up', address: 'josh0925-150pm.kosmosplus.com' } };
const ANSWERS = {
  told: { ok: true, removed: true, device_id: 'd-mac', local_cutoff: true, signed_out: true },
  'not-told': { ok: true, removed: true, device_id: 'd-mac', local_cutoff: true, signed_out: false },
  old: { ok: true, removed: true, device_id: 'd-mac' },
};

/* Arms a counter of the devices-list reads (GET /api/remote/devices) that START after the page's Remove answer has
   come back, and resolves once `n` of them have FINISHED (response read), or after `ms`. Started only after the
   answer, a poll that fired before the click cannot count; finished, the read has reached the page. */
function listReadsAfterRemove(page, n, ms) {
  return new Promise((resolve) => {
    let armed = false;
    const started = new Set();
    let done = 0;
    const finish = () => { page.off('response', onRes); page.off('request', onReq); page.off('requestfinished', onFin); clearTimeout(t); resolve(done); };
    const isList = (req) => req.method() === 'GET' && /\/api\/remote\/devices(\?|$)/.test(req.url());
    const onRes = (res) => { if (/\/api\/remote\/devices\/remove$/.test(res.url())) armed = true; };
    const onReq = (req) => { if (armed && isList(req)) started.add(req); };
    const onFin = (req) => { if (started.has(req)) { done += 1; if (done >= n) finish(); } };
    const t = setTimeout(finish, ms);
    page.on('response', onRes);
    page.on('request', onReq);
    page.on('requestfinished', onFin);
  });
}

async function open(browser, BASE, answer) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const json = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  await page.route('**/api/remote', (route, req) => route.fulfill(json(req.method() === 'GET' ? REMOTE : { ok: true })));
  await page.route('**/api/remote/pending', (route) => route.fulfill(json({ devices: [], email: 'you@example.com', self_device_id: 'd-self' })));
  await page.route('**/api/remote/devices**', (route) => route.fulfill(json({ on: true, allowed: [{ device_id: 'd-mac', name: 'Mac browser', allowed_at: now() - 86400, last_seen: now() - 600 }], pending: [], self_device_id: 'd-self' })));
  // Registered last, so it wins over the list route for this one path (Playwright tries the newest route first).
  await page.route('**/api/remote/devices/remove', (route) => route.fulfill(json(answer || { ok: true })));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.evaluate(() => showTab('settings'));
  await page.click('#s-nav button[data-go="plus"]');
  await page.waitForSelector('#plus-devlist [data-dev="remove"]', { state: 'visible', timeout: 5000 });
  return { page, errs };
}

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const [key, answer] of Object.entries(ANSWERS)) {
      const { page, errs } = await open(browser, BASE, answer);
      await page.click('#plus-devlist [data-dev="remove"]');
      const confirm = await page.textContent('#plus-devlist .confirm');
      chk(/It stops right away\. It can ask again by signing in\./.test(confirm || ''), key + ': the confirm says only what Remove always does', JSON.stringify(confirm));
      // Past the repaint the Remove triggers AND past one of the page's own 5 s polls (paintPlus repaints the list):
      // two list reads that started after the Remove answer and have finished, then one tick for the paint.
      const readsP = listReadsAfterRemove(page, 2, 14000);
      await page.click('#plus-devlist [data-dev="removeyes"]');
      const reads = await readsP;
      await page.waitForTimeout(300);
      chk(reads >= 2, key + ': the list was repainted twice after the Remove answer (the click, then a poll)', 'reads=' + reads);
      const said = (await page.textContent('#plus-devmsg') || '').trim();
      const visible = await page.evaluate(() => { const e = document.getElementById('plus-devmsg'); return !!(e && e.getBoundingClientRect().height > 0); });
      if (key === 'told') chk(/^Removed\. Its current sign-in on your other computers ends too; it stays allowed there until you remove it there\.$/.test(said) && visible, key + ': says the other computers are reached, and it is still showing after the repaint', JSON.stringify(said));
      else if (key === 'old') chk(/^Removed here\. If you let it in on your other computers too, it still opens them/.test(said) && !/could not/.test(said) && visible, 'old: said as how an older connector works, still showing after the repaint', JSON.stringify(said));
      else chk(/^Removed here\. Kosmos\+ could not confirm it/.test(said) && visible, key + ': says Kosmos+ could not confirm it, still showing after the repaint', JSON.stringify(said));
      if (key !== 'old') chk(!/could not record/.test(said), key + ': no cutoff line when the connector recorded one', JSON.stringify(said));
      chk(!/[\u2014]/.test(said), key + ': no em dash');
      chk(errs.length === 0, key + ': no page errors', errs.join(' | '));
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'device-remove-4824-' + key + '.png') }); }
      await page.close();
    }
    // CONTROL: the next Remove click clears the line, so the arms above are not passing on a line nothing clears.
    {
      const { page } = await open(browser, BASE, ANSWERS.told);
      await page.click('#plus-devlist [data-dev="remove"]');
      await page.click('#plus-devlist [data-dev="removeyes"]');
      await page.waitForTimeout(800);
      const before = (await page.textContent('#plus-devmsg') || '').trim();
      await page.click('#plus-devlist [data-dev="remove"]');
      await page.waitForTimeout(800);
      const after = (await page.textContent('#plus-devmsg') || '').trim();
      chk(before.length > 0 && after === '', 'control: the next Remove clears what the last one said', JSON.stringify({ before, after }));
      await page.close();
    }
    // CONTROL: the measurement can see a repaint that clears the line. With what the Remove said forgotten (as the
    // old page did on every repaint), the same wait for a poll must find the line empty.
    {
      const { page } = await open(browser, BASE, ANSWERS.told);
      await page.click('#plus-devlist [data-dev="remove"]');
      const readsP = listReadsAfterRemove(page, 2, 14000);
      await page.click('#plus-devlist [data-dev="removeyes"]');
      await page.waitForFunction(() => document.getElementById('plus-devmsg').textContent.trim().length > 0, null, { timeout: 5000 });
      await page.evaluate(() => { ASK.said = ''; });
      await readsP;
      await page.waitForTimeout(300);
      const said = (await page.textContent('#plus-devmsg') || '').trim();
      chk(said === '', 'control: a poll after the line is forgotten does clear it, so the arms above can see a clearing repaint', JSON.stringify(said));
      await page.close();
    }
    // One Remove at a time: while the connector is still telling Kosmos+ (up to 10 s), the row says Removing and
    // another Remove does nothing.
    {
      const page = (await open(browser, BASE, ANSWERS.told)).page;
      await page.unroute('**/api/remote/devices/remove');
      let posts = 0;
      await page.route('**/api/remote/devices/remove', async (route) => {
        posts += 1;
        await new Promise((r) => setTimeout(r, 2500));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ANSWERS.told) });
      });
      await page.click('#plus-devlist [data-dev="remove"]');
      await page.click('#plus-devlist [data-dev="removeyes"]');
      await page.waitForTimeout(400);
      const btn = await page.evaluate(() => { const b = document.querySelector('#plus-devlist [data-dev="remove"]'); return b ? { text: b.textContent, disabled: b.disabled } : null; });
      chk(!!btn && btn.text === 'Removing' && btn.disabled === true, 'busy: the row says Removing and its button is disabled while the Remove is out', JSON.stringify(btn));
      await page.evaluate(() => { const b = document.querySelector('#plus-devlist [data-dev="remove"]'); if (b) { b.disabled = false; b.click(); } });
      await page.waitForTimeout(3000);
      chk(posts === 1, 'busy: a second Remove while one is out sends nothing', 'posts=' + posts);
      chk(/^Removed\. Its current sign-in/.test((await page.textContent('#plus-devmsg') || '').trim()), 'busy: the answer of the first Remove is the one shown');
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fail.length ? 'render-device-remove-4824: ' + fail.length + ' FAILED' : 'render-device-remove-4824: all passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
