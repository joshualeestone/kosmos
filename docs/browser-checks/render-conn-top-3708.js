// Browser-check-surface: conn
'use strict';
/**
 * #3708 (from the 0.6.94 staging QA): the "Kosmos cannot reach a Claude subscription" line (#conn)
 * sits at the top of EVERY view. It used to sit after the panels, just above the Agents board, so it
 * was at the top of Agents but below the content of Settings, Projects and an agent's page.
 *
 * Boots a real board with no Claude account (so the line shows), opens each view, and asserts the
 * line is below the header, above that view's content, and in the same place as on Agents. The
 * line must actually be showing: an arm that never saw it fails rather than passes.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-conn-top-3708.js [shots-dir]
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-conn-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const SHOTS = process.argv[2] || null;
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL + '/', { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    const shown = await page.waitForFunction(() => { const c = document.getElementById('conn'); return c && !c.hidden && c.getBoundingClientRect().height > 0; }, null, { timeout: 15000 }).then(() => true, () => false);
    chk(shown, 'precondition: with no Claude account the line is showing (every arm below needs it)');

    /* Each view, and the element that is its content. */
    const views = [
      ['Agents', () => showTab('agents'), '#boardbar'],
      ['Settings > Updates', () => { showTab('settings'); settingsGo('updates'); }, '#panel-settings'],
      ['Projects', () => showTab('projects'), '#panel-projects'],
      ['an agent\'s page (Talk)', () => openDetail('beatrix'), '#panel-detail'],
      ['New agent', () => showTab('create'), '#panel-create'],
    ];
    let agentsTop = null;
    for (const [name, go, contentSel] of views) {
      await page.evaluate(go);
      await page.waitForTimeout(700);
      const m = await page.evaluate((sel) => {
        const conn = document.getElementById('conn');
        const c = conn.getBoundingClientRect();
        const e = document.querySelector(sel);
        const r = e && e.offsetParent !== null ? e.getBoundingClientRect() : null;
        const h = document.querySelector('.apphead').getBoundingClientRect();
        return { showing: !conn.hidden && c.height > 0, top: Math.round(c.top), bottom: Math.round(c.bottom),
          contentTop: r ? Math.round(r.top) : null, headBottom: Math.round(h.bottom),
          overflow: document.documentElement.scrollHeight - innerHeight };
      }, contentSel);
      if (agentsTop === null) agentsTop = m.top;
      chk(m.showing && m.contentTop !== null && m.bottom <= m.contentTop + 1 && m.top >= m.headBottom,
        name + ': the line sits below the header and above the content', JSON.stringify(m));
      chk(m.showing && m.top === agentsTop, name + ': the line is in the same place as on Agents', JSON.stringify({ top: m.top, agentsTop }));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'conn-top-' + name.replace(/[^a-z]+/gi, '-').toLowerCase() + '.png') });
    }
    /* The Talk layout is a viewport-tall column; the line must shrink the box, not push the page past the window. */
    await page.evaluate(() => openDetail('beatrix'));
    await page.waitForTimeout(500);
    const over = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    chk(over <= 1, 'an agent\'s Talk page still fits the window with the line showing', 'overflow ' + over + 'px');
    chk(errs.length === 0, 'no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    for (const d of ROOTS) fs.rmSync(d, { recursive: true, force: true });
  }
  if (fail.length) { console.log('\nrender-conn-top-3708: ' + fail.length + ' FAILED'); process.exit(1); }
  console.log('render-conn-top-3708: the Claude-unreachable line is at the top of every view.');
  process.exit(0);
})().catch((e) => { console.error('FAIL  render-conn-top-3708 crashed: ' + (e && e.stack || e)); process.exit(1); });
