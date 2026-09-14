// Browser-check-surface: d-instr-outdated d-instr-update d-instr-updating
'use strict';
/**
 * #3050 (Josh, 6.63 testing): the Instructions-tab staleness note used to end
 * "Reopen this agent to see the current version" -- an instruction with no control
 * to act on, so a person whose file had moved on (e.g. a reassign restart rewrote
 * it) was told what to do and given no way to do it. It now NAMES the action
 * ("This agent needs to be updated") and offers an Update button that reloads the
 * current on-disk version in place, showing the Kosmos K mark for the brief reload.
 *
 * `node --test` cannot see any of this: the note text, the button, the K element
 * and the reload BEHAVIOUR are DOM outcomes of the real page and the real
 * `loadInstructions` handler. This drives the real page against a real fixture
 * agent and mocks ONLY the per-agent instructions endpoint, so the reload can be
 * shown fetching a CHANGED file (v1 -> v2) rather than re-reading the same bytes.
 *
 * The load-bearing arm is red-capable: if the Update button did not actually
 * reload, the box would still hold the stale v1 after the click, and
 * "Update reloads the current on-disk version" would fail.
 *
 *   HEADED=0 node docs/browser-checks/render-reassign-update-3050.js
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-reassign-update-3050.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ru-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ru-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ru-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ru-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ru-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const create = require('../../engine/create');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const V1 = 'OLD instructions the box was opened with';
const V2 = 'NEW instructions now on disk (post-reassign)';

(async () => {
  fleet.install([
    fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' }),
  ]);
  fs.writeFileSync(create.plistPath('beatrix'),
    create.plistFor('beatrix', '/bin/echo', '/opt/homebrew/bin/tmux', 'claude-sonnet-5'), 'utf8');

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    // Mock ONLY the per-agent instructions GET. `served` flips from v1 to v2 to
    // stand in for the file changing on disk between opening the box and pressing
    // Update. A non-GET (the save PUT) is never issued here, but pass it through.
    let served = V1;
    let servedVersion = 'v1';
    await page.route('**/api/agent/*/instructions*', (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      route.fulfill({
        json: {
          exists: true, editable: true, text: served, version: servedVersion,
          hasPrevious: false, staleness: { state: 'current' },
        },
      });
    });

    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.waitForSelector('[data-agent="beatrix"]', { timeout: 8000 });
    await page.click('[data-agent="beatrix"]');
    await page.waitForSelector('#panel-detail:not([hidden])');
    await page.click('#d-nav button[data-go="instr"]');
    // openDetail calls loadInstructions for a tied agent, so the box loads v1.
    await page.waitForFunction((v) => document.getElementById('d-instr').value === v, V1, { timeout: 8000 });

    // ── Static: the note names the action, offers an Update button, and the old
    // dead-end wording is gone. The K mark lives in its own element. ────────────
    const markup = await page.evaluate(() => {
      const n = document.getElementById('d-instr-outdated');
      const btn = document.getElementById('d-instr-update');
      const upd = document.getElementById('d-instr-updating');
      return {
        noteText: n ? n.textContent.replace(/\s+/g, ' ').trim() : null,
        hasButton: !!btn,
        btnText: btn ? btn.textContent.trim() : null,
        buttonInNote: !!(btn && n && n.contains(btn)),
        hasUpdating: !!upd,
        kInUpdating: !!(upd && upd.querySelector('.kspin')),
        updatingSeparateFromNote: !!(upd && n && !n.contains(upd)),
      };
    });
    chk(/this agent needs to be updated/i.test(markup.noteText), 'the note names the action ("This agent needs to be updated")', markup.noteText);
    chk(!/reopen this agent/i.test(markup.noteText), 'the dead-end "Reopen this agent to see the current version" wording is gone', markup.noteText);
    chk(markup.hasButton && markup.btnText === 'Update' && markup.buttonInNote, 'the note offers an Update button', JSON.stringify(markup));
    chk(markup.hasUpdating && markup.kInUpdating && markup.updatingSeparateFromNote,
      'the K mark lives in its own element outside the note (which hides on click)', JSON.stringify(markup));

    // ── Behaviour: the file has moved on since the box was opened. The poll would
    // put the box in its stale state and raise the note; simulate that, flip the
    // served file to v2, press Update, and assert the box reloads v2, the note
    // and the K clear, and a confirmation lands. ───────────────────────────────
    await page.evaluate((old) => {
      document.getElementById('d-instr').value = old;              // stale text in the box
      document.getElementById('d-instr-outdated').hidden = false;  // the poll's note
      document.getElementById('d-instr-msg').textContent = '';
    }, V1);
    served = V2; servedVersion = 'v2';                             // the on-disk file changed

    // Sanity CONTROL: before the click the box still holds the stale v1, so the
    // post-click v2 is proof the handler reloaded, not proof of the initial load.
    const before = await page.evaluate(() => document.getElementById('d-instr').value);
    chk(before === V1, 'CONTROL: before Update the box holds the stale version', before);

    await page.click('#d-instr-update');
    await page.waitForFunction((v) => document.getElementById('d-instr').value === v, V2, { timeout: 8000 });
    const after = await page.evaluate(() => ({
      box: document.getElementById('d-instr').value,
      noteHidden: document.getElementById('d-instr-outdated').hidden,
      updatingHidden: document.getElementById('d-instr-updating').hidden,
      msg: document.getElementById('d-instr-msg').textContent.trim(),
    }));
    chk(after.box === V2, 'Update reloads the current on-disk version into the box', JSON.stringify(after));
    chk(after.noteHidden === true, 'Update clears the staleness note', JSON.stringify(after));
    chk(after.updatingHidden === true, 'the updating K mark is cleared once the reload finishes', JSON.stringify(after));
    chk(/^updated\.$/i.test(after.msg), 'a confirmation ("Updated.") is shown after a clean update', after.msg);

    chk(errs.length === 0, 'no page errors', errs.slice(0, 4).join(' | '));
    await page.close();
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
  }
  if (fail.length) { console.error('FAILURES: ' + fail.length); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => {
  console.error('render-reassign-update-3050 threw: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
