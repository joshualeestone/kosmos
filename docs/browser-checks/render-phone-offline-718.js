// Browser-check-surface: uoffline-slot grid pj-list
'use strict';

/**
 * #718 state 1 (Kano's measured list, issuecomment-5844683600): a phone with no network, looking at the board through
 * Kosmos+, was told "Kosmos is not answering on this computer" and "Something on this computer did not answer". That
 * blames the Mac when the phone is what is offline. Now it says "You are offline", and asks again the moment the
 * phone is back online.
 *
 * Harness: the real board, reached through remote.test (Chromium maps it to loopback and the board is told to accept
 * it, as render-plus-bar-3837 does), at phone width. The phone going offline is Playwright's network emulation, which
 * is what sets navigator.onLine false and fails every fetch.
 *
 * Controls:
 *   A. the Mac's own window (127.0.0.1) offline: loopback needs no network, so it keeps the Mac's "not answering" copy;
 *   B. an online phone whose reads get no answer (aborted): that IS the Mac not answering, so the Mac copy stays.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-phone-offline-718.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-off-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_ALLOWED_HOSTS = 'remote.test';   // read when server.js loads, so set before it

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
let pass = 0;
function chk(ok, label, extra) {
  if (ok) { pass++; console.log('PASS  ' + label + (extra ? '  ' + extra : '')); }
  else { fail.push(label); console.log('FAIL  ' + label + (extra ? '  --  ' + extra : '')); }
}
const OFFLINE = /You are offline/;
const MAC_BLAMED = /not answering on this computer|Something on this computer did not answer/i;
const read = (page) => page.evaluate(() => {
  const t = (id) => ((document.getElementById(id) || {}).textContent || '').replace(/\s+/g, ' ').trim();
  return { note: t('uoffline-slot'), grid: t('grid') + ' ' + t('alist'), pj: t('pj-list'), online: navigator.onLine };
});
// A poll is every five seconds; wait for the next one to have landed, by what it paints.
const waitFor = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 9000 }).then(() => true, () => false);

(async () => {
  fleet.install([fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' })]);
  const server = await srv.start(0);
  const port = server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', args: ['--host-resolver-rules=MAP remote.test 127.0.0.1'] });
  const fresh = async () => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
    const page = await ctx.newPage();
    return { ctx, page };
  };
  const settle = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); } };
  try {
    // ---- Scenario 1: through Kosmos+, the phone loses its network.
    {
      const { ctx, page } = await fresh();
      await page.goto('http://remote.test:' + port + '/?tab=agents', { waitUntil: 'networkidle' });
      await settle(page);
      const before = await read(page);
      chk(before.online && !OFFLINE.test(before.note + before.grid) && !MAC_BLAMED.test(before.note), 'S1 precondition: online through remote.test, the board is not claiming anything is down', JSON.stringify(before).slice(0, 160));
      await ctx.setOffline(true);
      const landed = await waitFor(page, () => /You are offline/.test((document.getElementById('uoffline-slot') || {}).textContent || ''));
      const off = await read(page);
      chk(landed && !off.online, 'S1 offline: the top note says You are offline', off.note.slice(0, 140));
      chk(!MAC_BLAMED.test(off.note), 'S1 offline: the top note does not blame the Mac', off.note.slice(0, 140));
      chk(!/Applications folder/.test(off.note), 'S1 offline: no desktop-only remedy on a phone', off.note.slice(0, 140));
      chk(OFFLINE.test(off.grid) && !MAC_BLAMED.test(off.grid), 'S1 offline: the agents card says You are offline, not that the Mac did not answer', off.grid.slice(0, 160));
      // Projects are read on arrival at the tab (not polled from Agents), so go there, offline.
      await page.evaluate(() => showTab('projects'));
      const pjOff = await waitFor(page, () => /You are offline/.test((document.getElementById('pj-list') || {}).textContent || ''));
      chk(pjOff, 'S1 offline: the projects list says You are offline', (await read(page)).pj.slice(0, 140));
      await page.evaluate(() => showTab('agents'));

      // Back online: asked again at once (the online event), not at the next five-second poll.
      // Go online just after a scheduled poll has gone out, so the next one is about five seconds
      // away and any read inside 700ms can only come from the online listener.
      const polled = await page.waitForRequest((r) => /\/api\/status(\?|$)/.test(r.url()), { timeout: 9000 }).then(() => true, () => false);
      const asked = [];
      page.on('request', (r) => { if (/\/api\/status(\?|$)/.test(r.url())) asked.push(Date.now()); });
      const t0 = Date.now();
      await ctx.setOffline(false);
      await page.waitForTimeout(700);
      const soon = asked.filter((t) => t - t0 < 700).length;
      chk(polled && soon > 0, 'S1 back online: the board asks again at once', 'aligned to a poll: ' + polled + ', status reads within 700ms: ' + soon);
      const cleared = await waitFor(page, () => !/You are offline/.test(((document.getElementById('uoffline-slot') || {}).textContent || '')
        + ((document.getElementById('grid') || {}).textContent || '')));
      chk(cleared, 'S1 back online: You are offline is gone', JSON.stringify(await read(page)).slice(0, 160));
      await ctx.close();
    }

    // ---- CONTROL A: the Mac's own window offline keeps the Mac's copy (loopback needs no network).
    {
      const { ctx, page } = await fresh();
      await page.goto('http://127.0.0.1:' + port + '/?tab=agents', { waitUntil: 'networkidle' });
      await settle(page);
      await ctx.setOffline(true);
      const landed = await waitFor(page, () => ((document.getElementById('uoffline-slot') || {}).textContent || '').length > 0);
      const r = await read(page);
      chk(landed, 'CONTROL A precondition: the offline Mac window drew a note', r.note.slice(0, 120));
      chk(!OFFLINE.test(r.note + r.grid), 'CONTROL A: on the Mac itself (127.0.0.1) the page does not say You are offline', (r.note + ' | ' + r.grid).slice(0, 160));
      await ctx.close();
    }

    // ---- CONTROL B: an online phone whose reads get no answer: that is the Mac not answering.
    {
      const { ctx, page } = await fresh();
      await page.goto('http://remote.test:' + port + '/?tab=agents', { waitUntil: 'networkidle' });
      await settle(page);
      await page.route('**/api/status', (r) => r.abort());
      await page.route('**/api/projects', (r) => r.abort());
      const landed = await waitFor(page, () => /not answering/i.test((document.getElementById('uoffline-slot') || {}).textContent || ''));
      const r = await read(page);
      chk(landed && r.online, 'CONTROL B: online, nothing answered, the note says the Mac is not answering', r.note.slice(0, 120));
      chk(!OFFLINE.test(r.note + r.grid + r.pj), 'CONTROL B: an online phone is not told it is offline', (r.note + ' | ' + r.grid).slice(0, 160));
      // #718 state 2: through Kosmos+ it is the person's Mac, asleep or off, and a phone cannot open an Applications folder.
      chk(/Your Mac is not answering/.test(r.note) && /asleep or turned off/.test(r.note), 'S2: the note names the Mac and why', r.note.slice(0, 160));
      chk(!MAC_BLAMED.test(r.note + r.grid) && !/Applications folder/.test(r.note), 'S2: no "this computer" and no desktop-only remedy on a phone', (r.note + ' | ' + r.grid).slice(0, 200));
      await ctx.close();
    }
  } catch (e) {
    chk(false, 'the check ran to the end', String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally {
    await browser.close().catch(() => {});
    await new Promise((res) => server.close(res));
    for (const d of ROOTS) fs.rmSync(d, { recursive: true, force: true });
  }
  console.log('\n' + pass + '/' + (pass + fail.length) + ' passed');
  if (fail.length) { console.log('FAILED: ' + fail.join('; ')); process.exit(1); }
  process.exit(0);
})();
