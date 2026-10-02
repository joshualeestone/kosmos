// Browser-check-surface: d-sec-memory d-sec-term d-fresh
'use strict';
/**
 * #4961 (Josh, 2026-10-01): on AI Settings the Fresh start card sat flush against "This agent's
 * terminal" below it, with no gap. The 24px between two visible sections came from
 * `.dsec:not([hidden]) + .dsec:not([hidden])`, and `+` only matches the very next sibling. Memory
 * and Terminal are both in the AI Settings group, but Profile, Instructions and Skills (hidden)
 * sit between them in the DOM, so Terminal never got its margin.
 *
 * Boots a sandboxed board with one agent and, on chromium and webkit, opens each grouped pill
 * (AI Settings, Profile), at 1280px and at a 390px phone width (where Memory and Fresh start stack),
 * and measures the vertical gap between every pair of consecutive VISIBLE sections: each must be the
 * same 24px (within 1px). Control: the pair count per pill is the group size minus one, so a pill
 * that showed fewer sections cannot pass by measuring nothing. Guard: the first visible section has
 * no top margin (the rule must not push a lone first section down); it reads the same on the old
 * rule, so it guards against an over-broad selector rather than proving this fix.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-dsec-gap-4961.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gap-' + tag)); ROOTS.push(d); return d; };
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

const readGaps = (page) => page.evaluate(() => {
  const vis = [...document.querySelectorAll('#panel-detail .dsec')].filter((s) => !s.hidden && s.getClientRects().length);
  const pairs = [];
  for (let i = 1; i < vis.length; i++) {
    pairs.push({ from: vis[i - 1].dataset.sec, to: vis[i].dataset.sec,
      gap: Math.round(vis[i].getBoundingClientRect().top - vis[i - 1].getBoundingClientRect().bottom) });
  }
  return { secs: vis.map((s) => s.dataset.sec), firstMargin: vis.length ? getComputedStyle(vis[0]).marginTop : '', pairs };
});

(async () => {
  fleet.install([fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  await fetch(URL + '/api/first-run/complete', { method: 'POST' });
  let ran = 0;
  try {
    for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({ headless: process.env.HEADED === '0' });
      try {
       for (const [vw, vh] of [[1280, 900], [390, 844]]) {
        const page = await browser.newPage({ viewport: { width: vw, height: vh } });
        const errs = [];
        page.on('pageerror', (e) => errs.push(e.message));
        await page.goto(URL);
        await page.waitForSelector('.acard .namego', { timeout: 20000 });
        await page.locator('.acard .namego').first().click();
        await page.waitForSelector('#d-sec-talk', { timeout: 20000 });
        for (const [go, size] of [['model', 4], ['profile', 3]]) {
          await page.locator(`#panel-detail [data-go="${go}"]`).first().click();
          await page.waitForTimeout(300);
          const r = await readGaps(page);
          const tag = `${engineName} ${vw}px ${go}`;
          chk(r.pairs.length === size - 1, `${tag}: control: ${size} sections showing, ${size - 1} gaps measured`, JSON.stringify(r.secs));
          chk(r.firstMargin === '0px', `${tag}: guard: the first section is not pushed down`, r.firstMargin);
          for (const p of r.pairs) {
            chk(Math.abs(p.gap - 24) <= 1, `${tag}: ${p.from} -> ${p.to}: the same 24px between the cards`, String(p.gap) + 'px');
          }
          ran += 1;
        }
        chk(errs.length === 0, `${engineName} ${vw}px: no page errors`, errs.join(' | '));
        await page.close();
       }
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  chk(ran === 8, 'precondition: both engines, both widths and both pills ran', String(ran));
  console.log(fail.length ? `${fail.length} check(s) FAILED` : 'all checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
