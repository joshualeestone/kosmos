// Browser-check-surface: st-attn-tile st-attn-noproj-tile data-attn data-noproj
'use strict';
/**
 * #3423 (Josh, 0.6.88 live test): the Agents top chips "Issue" and "No project"
 * become clickable filter toggles, the same pattern as the "Messages" tile, and
 * "No project" is NOT falsely demoted (it stays the #1898 needs-you-no-project
 * drill-down; clicking it jumps to the actual agent).
 *
 * Markers are keyed on the SERVER state to match the tile counts exactly:
 *   data-attn   = a.state === 'needs_you'                          (== c.needsYou, the "Issue" count)
 *   data-noproj = a.state === 'needs_you' && a.stateProject===null (== c.needsYouUnattributed)
 *
 * Asserts (real page + real render + real handlers):
 *   1. a needs_you agent's grid card carries data-attn AND data-noproj; an idle
 *      agent's carries neither.
 *   2. the attn-vs-noproj DISTINCTION: card() on a needs_you agent WITH a project
 *      (stateProject set) emits data-attn but NOT data-noproj (real card clone).
 *   2b. the needs_trust DIVERGENCE: a needs_trust card wears the red visual attn
 *      class but carries NEITHER data-attn nor data-noproj, so the Issue filter
 *      excludes it (data-attn matches c.needsYou, which keys on needs_you only).
 *   3. setBoardFilter is mutually exclusive: exactly one body.filter-* class + one
 *      tile aria-pressed=true at a time; null clears all.
 *   4. the CSS actually hides non-matching grid cards while a filter is on, and the
 *      exit restores them.
 *   5. clicking the Issue tile toggles the filter (aria-pressed + body class).
 *
 *   HEADED=0 node docs/browser-checks/render-chip-filters-3423.js
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-chip-filters-3423.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cf-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cf-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cf-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cf-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cf-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const create = require('../../engine/create');
const srv = require('../../server.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'cf-shots-'));
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([
    fleet.agent('nyx', { state: 'needs_you', displayName: 'Nyx', role: 'Analyst' }),
    fleet.agent('bea', { state: 'idle', displayName: 'Bea', role: 'Bookkeeper' }),
  ]);
  fs.writeFileSync(create.plistPath('nyx'),
    create.plistFor('nyx', '/bin/echo', '/opt/homebrew/bin/tmux', 'claude-sonnet-5'), 'utf8');

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.waitForSelector('#grid .acard[data-agent="nyx"]', { timeout: 8000 });

    // 1. Markers on the real-rendered grid cards.
    const markers = await page.evaluate(() => {
      const nyx = document.querySelector('#grid .acard[data-agent="nyx"]');
      const bea = document.querySelector('#grid .acard[data-agent="bea"]');
      return {
        nyxAttn: nyx ? nyx.hasAttribute('data-attn') : null,
        nyxNoproj: nyx ? nyx.hasAttribute('data-noproj') : null,
        beaAttn: bea ? bea.hasAttribute('data-attn') : null,
        beaNoproj: bea ? bea.hasAttribute('data-noproj') : null,
      };
    });
    chk(markers.nyxAttn === true && markers.nyxNoproj === true,
      'a needs_you (no project) agent card carries BOTH data-attn and data-noproj', JSON.stringify(markers));
    chk(markers.beaAttn === false && markers.beaNoproj === false,
      'an idle agent card carries NEITHER marker', JSON.stringify(markers));

    // 2. The attn-vs-noproj distinction, via the real card() on a clone WITH a project.
    const distinction = await page.evaluate(() => {
      const real = LAST.find((a) => a.sessionName === 'nyx');
      const withProject = card({ ...real, stateProject: 'proj-1' });
      const noProject = card({ ...real, stateProject: null });
      return {
        withProject_attn: /\bdata-attn\b/.test(withProject),
        withProject_noproj: /\bdata-noproj\b/.test(withProject),
        noProject_noproj: /\bdata-noproj\b/.test(noProject),
      };
    });
    chk(distinction.withProject_attn === true && distinction.withProject_noproj === false,
      'a needs_you agent WITH a project gets data-attn but NOT data-noproj', JSON.stringify(distinction));
    chk(distinction.noProject_noproj === true,
      'and a needs_you agent with NO project does get data-noproj', JSON.stringify(distinction));

    // 2b. DELIBERATE DIVERGENCE (#3423): a needs_trust card wears the red .attn
    // visual (class="acard attn ... needstrust") but is NOT marked data-attn,
    // because the Issue count c.needsYou keys on state==='needs_you' only. The
    // filter must match its chip count, so needs_trust is excluded. This pins it:
    // if a future refactor merges the visual attn set into data-attn, it fails.
    const trust = await page.evaluate(() => {
      const html = card({ sessionName: 'trusty', running: false, state: 'needs_trust',
        needsTrust: true, name: 'Trusty', because: 'Waiting at a workspace-trust prompt.' });
      return {
        hasVisualAttn: /\bclass="acard attn\b/.test(html) && /\bneedstrust\b/.test(html),
        hasDataAttn: /\bdata-attn\b/.test(html),
        hasDataNoproj: /\bdata-noproj\b/.test(html),
      };
    });
    chk(trust.hasVisualAttn === true,
      'a needs_trust card still wears the red visual attn/needstrust class', JSON.stringify(trust));
    chk(trust.hasDataAttn === false && trust.hasDataNoproj === false,
      'but a needs_trust card carries NEITHER data-attn nor data-noproj (excluded from the Issue filter to match c.needsYou)', JSON.stringify(trust));

    // 3. setBoardFilter mutual exclusivity + aria-pressed.
    const excl = await page.evaluate(() => {
      const snap = () => ({
        cls: ['filter-msgs', 'filter-attn', 'filter-noproj'].filter((c) => document.body.classList.contains(c)),
        pressed: ['st-dm-tile', 'st-attn-tile', 'st-attn-noproj-tile']
          .filter((id) => { const t = document.getElementById(id); return t && t.getAttribute('aria-pressed') === 'true'; }),
      });
      setBoardFilter('attn'); const a = snap();
      setBoardFilter('noproj'); const b = snap();
      setBoardFilter(null); const c = snap();
      return { a, b, c };
    });
    chk(excl.a.cls.join() === 'filter-attn' && excl.a.pressed.join() === 'st-attn-tile',
      'setBoardFilter(attn): exactly filter-attn + st-attn-tile pressed', JSON.stringify(excl.a));
    chk(excl.b.cls.join() === 'filter-noproj' && excl.b.pressed.join() === 'st-attn-noproj-tile',
      'setBoardFilter(noproj): switches cleanly (mutual exclusivity, no leftover attn)', JSON.stringify(excl.b));
    chk(excl.c.cls.length === 0 && excl.c.pressed.length === 0,
      'setBoardFilter(null): clears every filter class and aria-pressed', JSON.stringify(excl.c));

    // 4. The CSS actually hides non-matching grid cards; exit restores.
    const vis = (sel) => page.evaluate((s) => {
      const el = document.querySelector(s);
      return el ? getComputedStyle(el).display : '(gone)';
    }, sel);
    await page.evaluate(() => setBoardFilter('attn'));
    const nyxOnAttn = await vis('#grid .acard[data-agent="nyx"]');
    const beaOnAttn = await vis('#grid .acard[data-agent="bea"]');
    chk(nyxOnAttn !== 'none' && beaOnAttn === 'none',
      'filter-attn hides the non-attn (idle) grid card, keeps the needs_you one', `nyx=${nyxOnAttn} bea=${beaOnAttn}`);
    await page.evaluate(() => { const e = document.querySelector('.board-msgfilter-exit'); if (e) e.click(); });
    const beaAfterExit = await vis('#grid .acard[data-agent="bea"]');
    chk(beaAfterExit !== 'none', 'the exit affordance restores all cards', `bea=${beaAfterExit}`);

    // 5. Clicking the Issue tile toggles the filter.
    const clickToggle = await page.evaluate(() => {
      const tile = document.getElementById('st-attn-tile');
      tile.click();
      const on = document.body.classList.contains('filter-attn') && tile.getAttribute('aria-pressed') === 'true';
      tile.click();
      const off = !document.body.classList.contains('filter-attn') && tile.getAttribute('aria-pressed') === 'false';
      return { on, off };
    });
    chk(clickToggle.on && clickToggle.off, 'clicking the Issue tile toggles the filter on then off', JSON.stringify(clickToggle));

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.screenshot({ path: path.join(OUT, 'chip-filters.png'), clip: { x: 0, y: 0, width: 900, height: 120 } }).catch(() => {});
  } finally {
    await browser.close();
  }
  console.log(fail.length ? '\nFAILED: ' + fail.join(', ') : '\nall good');
  process.exit(fail.length ? 1 : 0);
})();
