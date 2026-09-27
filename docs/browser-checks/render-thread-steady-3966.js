// Browser-check-surface: d-dmthread mwhen
'use strict';
/**
 * #3966 (Josh, 2026-09-26): "I'm getting a flash every 5 seconds" on an agent's page.
 *
 * The thread was rewritten whenever its markup changed, and a relative time ("51 minutes ago" ->
 * "52 minutes ago") on any row changed it, so a busy thread was rebuilt, images and all, on most
 * polls. Boots a sandboxed board, serves the agent a sixteen-message thread spread over the last
 * hour (so some row crosses a minute mark every few seconds), opens the agent page and watches
 * thirty seconds of polls. On chromium and webkit:
 *   - precondition: at least one row's time words actually changed during the watch (otherwise
 *     nothing here could have caused a rewrite, and a pass would mean nothing);
 *   - the changed words are on screen, updated in place;
 *   - not one thread node was replaced (every node tagged before the watch is still there, and
 *     no untagged node appeared), so nothing was rebuilt and no image reloaded.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-thread-steady-3966.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-steady-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium, webkit } = require('playwright');
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
  await fetch(URL + '/api/first-run/complete', { method: 'POST' });
  try {
    for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({ headless: process.env.HEADED === '0' });
      try {
        /* serviceWorkers 'block': the app's service worker would otherwise answer the thread fetch
           itself in webkit, and the seeded thread below would never reach the page. */
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(e.message));
        /* Sixteen rows, one every ~3.7 minutes across the last hour, at uneven seconds, so some row's
           "N minutes ago" ticks over every few seconds. */
        const T0 = Date.now() - 58 * 60 * 1000;
        const messages = [];
        for (let k = 0; k < 16; k++) {
          messages.push({ id: 'm' + k, from: k % 2 ? 'you' : 'beatrix-discord', text: 'message ' + k,
            at: new Date(T0 + k * 217000 + k * 3700).toISOString() });
        }
        await page.route('**/api/agent/*/thread', async (route) => {
          const r = await route.fetch();
          let j = {};
          try { j = await r.json(); } catch { j = {}; }
          j.messages = messages;
          await route.fulfill({ response: r, json: j });
        });
        await page.goto(URL);
        await page.waitForSelector('.acard .namego', { timeout: 20000 });
        await page.locator('.acard .namego').first().click();
        await page.waitForSelector('#d-dmthread .msg', { timeout: 20000 });
        await page.waitForTimeout(6000); // let the first polls settle

        const before = await page.evaluate(() => {
          const th = document.getElementById('d-dmthread');
          let n = 0;
          for (const e of th.querySelectorAll('*')) { e.__steady = true; n += 1; }
          return { nodes: n, words: [...th.querySelectorAll('.mwhen')].map((e) => e.textContent) };
        });
        await page.waitForTimeout(30000);
        const after = await page.evaluate(() => {
          const th = document.getElementById('d-dmthread');
          const all = [...th.querySelectorAll('*')];
          return {
            nodes: all.length,
            fresh: all.filter((e) => !e.__steady).length,
            words: [...th.querySelectorAll('.mwhen')].map((e) => e.textContent),
          };
        });
        const changed = before.words.filter((w, i) => after.words[i] !== undefined && after.words[i] !== w).length;
        chk(before.words.length === 16, `${engineName}: precondition: all sixteen rows carry a live time`, String(before.words.length));
        chk(changed >= 1, `${engineName}: precondition: some row's time words changed during the watch`, `${changed} changed`);
        chk(after.fresh === 0 && after.nodes === before.nodes,
          `${engineName}: the thread was not rebuilt (no node replaced, times updated in place)`, `fresh=${after.fresh} nodes ${before.nodes}->${after.nodes}`);
        chk(errs.length === 0, `${engineName}: no page errors`, errs.join(' | '));
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(fail.length ? `${fail.length} check(s) FAILED` : 'all checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
