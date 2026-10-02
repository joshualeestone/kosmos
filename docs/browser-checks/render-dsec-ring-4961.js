// Browser-check-surface: d-sec-talk d-sec-profile d-sec-model
'use strict';
/**
 * #4961 (Josh, 2026-10-01): on the agent page in the Mac app, a black stroke drew round the whole
 * Direct Message section after clicking its pill. Cause: a nav click moves focus into the section
 * (detailGo, so a keyboard user's next Tab lands inside), and WebKit, the engine the Mac app runs,
 * matches :focus-visible on that programmatic focus after a click. `.dsec:focus-visible` then drew
 * a 2px ink outline round the 16px-radius section. Chromium does not match it on a click, so a
 * click-only Chromium check never saw it.
 *
 * Playwright's WebKit does not reproduce the click case (Safari does not focus a button on click,
 * so the focus that follows reads as keyboard-ish; Playwright's build does focus it). Activating a
 * pill from the KEYBOARD makes the section match :focus-visible on every engine, so that arm is the
 * one that reds on the old rule everywhere; the click arm covers the same promise for mouse users.
 *
 * Boots a sandboxed board with one agent, opens its page, then on chromium and webkit, light and
 * dark, activates each nav pill (AI Settings, Profile, Direct Message) by click and by keyboard
 * (focus the pill, Enter) and reads, for the element that took focus:
 *   - focus still moved into the pill's section (the keyboard behaviour #350 / #2916 rely on);
 *   - that section draws no outline (outline-style none, or zero width).
 * Control: the instrument reads the outline of a section after a forced :focus-visible style is
 * injected, and must see it, so "none" is not the instrument's default.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-dsec-ring-4961.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ring-' + tag)); ROOTS.push(d); return d; };
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

const readFocus = (page) => page.evaluate(() => {
  const el = document.activeElement;
  const cs = el ? getComputedStyle(el) : null;
  return {
    sec: el && el.dataset ? (el.dataset.sec || '') : '',
    id: el ? el.id : '',
    style: cs ? cs.outlineStyle : '',
    width: cs ? cs.outlineWidth : '',
  };
});
const drawsNoRing = (f) => f.style === 'none' || parseFloat(f.width) === 0;

(async () => {
  fleet.install([fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  await fetch(URL + '/api/first-run/complete', { method: 'POST' });
  let ran = 0;
  try {
    for (const theme of ['light', 'dark']) {
      for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
        const browser = await engine.launch({ headless: process.env.HEADED === '0' });
        try {
          const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
          const errs = [];
          page.on('pageerror', (e) => errs.push(e.message));
          await page.goto(URL);
          await page.waitForSelector('.acard .namego', { timeout: 20000 });
          await page.locator('.acard .namego').first().click();
          await page.waitForSelector('#d-sec-talk', { timeout: 20000 });
          const tag = `[${theme}] ${engineName}`;
          for (const how of ['click', 'keyboard']) {
            for (const [go, sec] of [['model', 'model'], ['profile', 'profile'], ['talk', 'talk']]) {
              const pill = page.locator(`#panel-detail [data-go="${go}"]`).first();
              if (how === 'click') await pill.click();
              else { await pill.focus(); await page.keyboard.press('Enter'); }
              await page.waitForTimeout(150);
              const f = await readFocus(page);
              chk(f.sec === sec, `${tag}: ${how} ${go}: focus moved into the ${sec} section`, JSON.stringify(f));
              chk(drawsNoRing(f), `${tag}: ${how} ${go}: the section draws no outline round itself`, JSON.stringify(f));
              ran += 1;
            }
          }
          /* Control: force a visible outline on the focused section; the instrument must read it. */
          await page.addStyleTag({ content: '#panel-detail .dsec:focus { outline: 2px solid red !important; }' });
          const c = await readFocus(page);
          chk(c.sec === 'talk' && !drawsNoRing(c), `${tag}: control: a forced outline on the focused section reads as an outline`, JSON.stringify(c));
          chk(errs.length === 0, `${tag}: no page errors`, errs.join(' | '));
        } finally {
          await browser.close();
        }
      }
    }
  } finally {
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  chk(ran === 24, 'precondition: every engine, theme and pill arm ran', String(ran));
  console.log(fail.length ? `${fail.length} check(s) FAILED` : 'all checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
