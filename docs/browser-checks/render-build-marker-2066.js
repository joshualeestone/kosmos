// Browser-check-surface: buildmark
'use strict';

/**
 * kosmos#3641 (Josh, 2026-09-24 16:06): the corner version marker (#2066 / #2658) is gone from every
 * view, and the version still reads in Settings > Updates. This check used to assert the marker's
 * text and styling per channel; a removal with no guard gets undone, so it now asserts the absence on
 * a real board after the status poll (the tick that used to paint the marker), with the Settings
 * version line as the control that the page loaded and painted its version (in a source checkout the
 * poll paints it; a built artifact paints its baked version before any poll).
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-build-marker-2066.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bm-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-build-marker-2066: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-build-marker-2066: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
    process.exit(1);
  }
  try {
    for (const layout of ['tabs', 'consolidated']) {
      await fetch(URL + '/api/style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout }) });
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(URL, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
      // Control first: the status poll landed and painted the version into Settings > Updates.
      const polled = await page.waitForFunction(() => /\d+\.\d+/.test(document.getElementById('build')?.textContent || ''), null, { timeout: 8000 }).then(() => true, () => false);
      const version = await page.evaluate(() => document.getElementById('build')?.textContent || '');
      chk(polled, 'M3 ' + layout + ': control, the version reads in Settings > Updates', 'build=' + JSON.stringify(version));
      const board = await page.evaluate(() => ({
        marker: !!document.getElementById('buildmark'),
        words: /beta build/i.test(document.body.innerText),
        cornerText: (() => { const el = document.elementFromPoint(window.innerWidth - 40, window.innerHeight - 10); return el && el !== document.body && el !== document.documentElement ? (el.innerText || '').trim().slice(0, 40) : ''; })(),
      }));
      chk(!board.marker, 'M1 ' + layout + ': there is no corner marker element on the board');
      chk(!board.words, 'M2 ' + layout + ': no "beta build" words anywhere on the board');
      chk(!/v?\d+\.\d+\.\d+/.test(board.cornerText), 'M4 ' + layout + ': the bottom-right corner carries no version', JSON.stringify(board.cornerText));
      // The visible one: the consolidated layout keeps a hidden grid card beside its rail row.
      const opened = await page.locator('[data-agent="beatrix"]:visible').first().click().then(() => page.waitForSelector('#panel-detail:not([hidden])', { timeout: 5000 })).then(() => true, () => false);
      chk(opened, 'M5 ' + layout + ': precondition, an agent\'s page opened');
      const detail = await page.evaluate(() => ({ marker: !!document.getElementById('buildmark'), words: /beta build/i.test(document.body.innerText) }));
      chk(opened && !detail.marker && !detail.words, 'M5 ' + layout + ': none on an agent\'s page either', JSON.stringify(detail));
      chk(errs.length === 0, 'M6 ' + layout + ': no page errors', errs.join(' | '));
      await page.close();
    }
  } finally {
    await fetch(URL + '/api/style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: 'tabs' }) }).catch(() => {});
    await browser.close();
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  if (fail.length) {
    for (const p of fail) console.error('  FAIL  ' + p);
    console.log('\n' + fail.length + ' FAILED'); process.exit(1);
  }
  console.log('\nall build-marker (#3641, removed) checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
