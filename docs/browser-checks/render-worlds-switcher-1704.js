'use strict';
/**
 * #1704 slice-3: the multiple-Kosmos switcher (list + create), on a screen.
 *
 * The switcher lists worlds from GET /api/worlds and creates them via POST
 * /api/worlds (Angel's slice 2a). None of it is visible to a source test: the
 * name is read from a live fetch, the menu is built from the response, and the
 * create round-trips a real POST and refetch. This self-boots its own sandbox
 * board (so the POST writes to a throwaway registry, never a real one) and drives
 * the real page.
 *
 * Arms, each written to red on the pre-#1704 page (no switcher markup, so the
 * elements are absent and the waits time out):
 *  1. The switcher shows the active world's name beside the K mark.
 *  2. The menu lists the worlds, with exactly one marked active.
 *  3. The create modal validates: Create is disabled on an empty name, enabled
 *     once a name is typed.
 *  4. Creating a Kosmos closes the modal and the new world appears in the list
 *     (the real POST /api/worlds + refetch).
 *  5. The switcher is hidden in the consolidated view (a tab-view header element
 *     until the persistent-header work lands).
 *
 * Switching between worlds is slice 2b; this checks list + create only.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-worlds-switcher-1704.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-worlds-'));
const mkroot = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'aw-worlds-' + t));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const srv = require('../../server.js');
const fleet = require('../../test-support/fleet');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${URL}/?tab=agents`, { waitUntil: 'networkidle' });
    if (!(await page.$('#firstrun[hidden]'))) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }

    // ── Arm 1: the switcher shows the active world's name. ───────────────────
    await page.waitForSelector('#worldsw:not([hidden])', { timeout: 8000 });
    const name = await page.locator('#worldsw-name').textContent();
    chk(await page.locator('#worldsw').first().isVisible() && !!(name && name.trim()),
      'the switcher shows the active Kosmos name beside the K mark', JSON.stringify(name));

    // ── Arm 2: the menu lists the worlds, exactly one marked active. ─────────
    await page.click('#worldsw-btn');
    await page.waitForSelector('#worldsw-menu:not([hidden])', { timeout: 4000 });
    const rows = await page.locator('#worldsw-list .worldsw-row').count();
    const marked = await page.locator('#worldsw-list .worldsw-row[aria-current="true"]').count();
    chk(rows >= 1, 'the menu lists at least one Kosmos', String(rows));
    chk(marked === 1, 'exactly one Kosmos is marked active', String(marked));

    // ── Arm 3: the create modal validates. ──────────────────────────────────
    await page.click('#worldsw-new');
    await page.waitForSelector('#world-add-modal:not([hidden])', { timeout: 4000 });
    chk(await page.locator('#world-add-go').isDisabled(), 'Create is disabled with an empty name');
    // The modal declares aria-modal, so it opens focused on the name field.
    chk(await page.evaluate(() => document.getElementById('world-add-modal').contains(document.activeElement)),
      'the create modal opens with focus inside it');
    // Test the focus trap at its BOUNDARY, where it earns its keep: focus the LAST
    // enabled control (Cancel, since Create is disabled on the empty name), then
    // Tab must WRAP back to the name field. Without the #world-add-modal focus-trap
    // entry, Tab here escapes the modal to a header control -- so this arm reds if
    // the trap entry is removed (a single Tab from the name field would not, since
    // name -> Cancel is inside the modal with or without the trap).
    await page.focus('#world-add-cancel');
    await page.keyboard.press('Tab');
    chk(await page.evaluate(() => document.activeElement && document.activeElement.id === 'world-add-name'),
      'Tab off the last control wraps back into the modal (the focus trap)',
      await page.evaluate(() => (document.activeElement && document.activeElement.id) || '<none>'));
    await page.fill('#world-add-name', 'Client work');
    chk(!(await page.locator('#world-add-go').isDisabled()), 'Create enables once a name is typed');

    // ── Arm 4: creating a Kosmos closes the modal + the new world appears. ───
    await page.click('#world-add-go');
    const closed = await page.waitForFunction(() => document.getElementById('world-add-modal').hidden, null, { timeout: 6000 })
      .then(() => true).catch(() => false);
    chk(closed, 'creating a Kosmos closes the create modal');
    await page.click('#worldsw-btn');
    await page.waitForSelector('#worldsw-menu:not([hidden])', { timeout: 4000 });
    // Wait on the new ROW itself, not just the modal close: worldAddClose() hides the
    // modal synchronously BEFORE the refetch+render completes, so waiting on the row
    // is what makes this race-free.
    const appeared = await page.waitForFunction(
      () => Array.from(document.querySelectorAll('#worldsw-list .worldsw-rowname')).some((n) => n.textContent === 'Client work'),
      null, { timeout: 6000 }).then(() => true).catch(() => false);
    const names = await page.locator('#worldsw-list .worldsw-rowname').allTextContents();
    chk(appeared && names.includes('Client work'), 'the new Kosmos appears in the switcher list (the real POST + refetch)', JSON.stringify(names));

    // ── Arm 5: the switcher is hidden in the consolidated view. ──────────────
    await page.click('.headright .laypick [data-layout-switch="consolidated"]');
    await page.waitForFunction(() => document.body.classList.contains('consolidated'), null, { timeout: 8000 });
    await page.waitForTimeout(200);
    chk(!(await page.locator('#worldsw').first().isVisible()), 'the switcher is hidden in the consolidated view');

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    try { await server.close(); } catch { /* already down */ }
  }

  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nALL PASS');
})().catch((e) => { console.error(e); process.exit(1); });
