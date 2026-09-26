'use strict';
/**
 * The "no brief yet" room note is for the agents, not the person (Kano's state 7; #2707
 * introduced the note).
 *
 * A project staffed with agents and given no description gets one note in its room:
 * "This project has no brief yet ... ONE of you ask here what the goal is ... One question
 * to the operator, not seven." (engine/projects.js BRIEF_PENDING_NOTE). Agents read the room
 * through `kosmos room` (the route's ?as=text view) and need it to coordinate; the page
 * reads the same route as JSON and drew it as the first thing in a new room. This drives the
 * REAL create route on the REAL server and reads:
 *   - the agents' view (?as=text) still carries the note;
 *   - the person's view (the JSON rows, and the page) does not, and the page shows its own
 *     "Nothing here yet" instead;
 *   - a note written before notes carried an audience (the same text, untagged) is left
 *     out of the person's view too, and still reaches the agents;
 *   - an ordinary Kosmos note (no audience) still shows on the page, so the filter is not
 *     hiding every note.
 *
 * Controls, measured: with the room route's audience filter removed, the person's-view arms
 * red (the JSON carries the note and the page draws it).
 *
 *   node docs/browser-checks/render-brief-note-agents.js            # headed
 *   HEADED=0 node docs/browser-checks/render-brief-note-agents.js   # headless
 *   ENGINES=chromium,webkit HEADED=0 node docs/browser-checks/render-brief-note-agents.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bn-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bn-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bn-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bn-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bn-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

let pw;
try { pw = require('playwright'); }
catch {
  console.log('render-brief-note-agents: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const create = require('../../engine/create');
const store = require('../../engine/store');
const messages = require('../../engine/messages');
const projects = require('../../engine/projects');

// The gate runs Chromium; ENGINES=chromium,webkit adds WebKit by hand.
const ALL_ENGINES = ['chromium', 'webkit'];
const ASKED = (process.env.ENGINES || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const ENGINES = ASKED.filter((e) => ALL_ENGINES.includes(e));
// A misspelt engine would otherwise be dropped silently and the run read as covering it.
if (!ENGINES.length || ENGINES.length !== ASKED.length) {
  console.log('FAIL  render-brief-note-agents: ENGINES names an unknown engine (' + (process.env.ENGINES || '') + '); known: ' + ALL_ENGINES.join(', '));
  process.exit(1);
}
const NAMES = ['ada', 'bram'];
const NOTE_MARK = 'no brief yet';
const PLAIN_NOTE = 'Kosmos here: this room was moved from another computer.';

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

async function roomText(base, id) {
  const r = await fetch(base + '/api/project/' + encodeURIComponent(id) + '/room?as=text');
  return r.text();
}
async function roomRows(base, id) {
  const r = await fetch(base + '/api/project/' + encodeURIComponent(id) + '/room');
  const b = await r.json().catch(() => ({}));
  return Array.isArray(b.rows) ? b.rows : [];
}

async function openRoom(page, base, id) {
  await page.goto(base, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.click('[data-tab="projects"]');
  await page.waitForSelector(`#pj-list .pj-row[data-project="${id}"]`, { timeout: 8000 });
  await page.click(`#pj-list .pj-row[data-project="${id}"]`);
  await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
  // The room paints from its own fetch; wait until it has painted something.
  await page.waitForFunction(() => { const r = document.getElementById('pj-room'); return r && r.textContent.trim().length > 0; }, null, { timeout: 8000 }).catch(() => {});
  return page.evaluate(() => (document.getElementById('pj-room') || {}).textContent || '');
}

(async () => {
  fleet.install(NAMES.map((n, i) => fleet.agent(n, { state: 'idle', displayName: n[0].toUpperCase() + n.slice(1), role: 'Role ' + (i + 1) })));
  NAMES.forEach((n, i) => {
    store.writeProfile(n, { role: 'Role ' + (i + 1) });
    fs.mkdirSync(create.workerDir(n), { recursive: true });
  });
  const server = await srv.start(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    // A new project, staffed, with no description: the create route posts the note.
    const res = await fetch(base + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ name: 'Spring launch', agents: NAMES }) });
    const made = await res.json().catch(() => ({}));
    const pid = made && (made.id || (made.project && made.project.id));
    chk(res.ok && !!pid, 'the create route made a staffed project with no description', `status ${res.status}`);
    if (!pid) throw new Error('no project to read');
    const text = await roomText(base, pid);
    chk(text.toLowerCase().includes(NOTE_MARK), 'the agents\' view (kosmos room, ?as=text) still carries the note', JSON.stringify(text.slice(0, 120)));
    const rows = await roomRows(base, pid);
    const leaked = rows.filter((r) => r && r.kind === 'note' && String(r.text || '').toLowerCase().includes(NOTE_MARK));
    chk(leaked.length === 0, 'the person\'s view (the room JSON) leaves the note out', `${leaked.length} note row(s) carry it`);

    // A room written before notes carried an audience: the same text, untagged. And an ordinary
    // Kosmos note, which must still show.
    const res2 = await fetch(base + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ name: 'Old room', description: 'Sell more tea' }) });
    const made2 = await res2.json().catch(() => ({}));
    const pid2 = made2 && (made2.id || (made2.project && made2.project.id));
    chk(res2.ok && !!pid2, 'a second project for the older room', `status ${res2.status}`);
    if (!pid2) throw new Error('no second project');
    messages.roomNote(pid2, projects.BRIEF_PENDING_NOTE);   // untagged: the pre-change shape
    messages.roomNote(pid2, PLAIN_NOTE);
    chk((await roomText(base, pid2)).toLowerCase().includes(NOTE_MARK), 'an older, untagged note still reaches the agents');
    const rows2 = await roomRows(base, pid2);
    chk(!rows2.some((r) => r && r.kind === 'note' && String(r.text || '').toLowerCase().includes(NOTE_MARK)), 'an older, untagged note is left out of the person\'s view too');
    chk(rows2.some((r) => r && r.kind === 'note' && r.text === PLAIN_NOTE), 'an ordinary Kosmos note is still in the person\'s view');

    for (const engine of ENGINES) {
      let browser;
      try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
      catch (err) {
        chk(false, `[${engine}] could not start a browser` + (process.env.HEADED === '0' ? '' : ' (headed; try HEADED=0)'),
          err && err.message ? err.message.split('\n')[0] : String(err));
        continue;
      }
      try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(String(e.message || e).split('\n')[0]));
        const shown = await openRoom(page, base, pid);
        chk(!shown.toLowerCase().includes(NOTE_MARK), `[${engine}] the new room does not show the agents' note`, JSON.stringify(shown.slice(0, 160)));
        chk(/Nothing here yet/.test(shown), `[${engine}] the new room shows its own empty state instead`, JSON.stringify(shown.slice(0, 160)));
        const shown2 = await openRoom(page, base, pid2);
        chk(!shown2.toLowerCase().includes(NOTE_MARK) && shown2.includes(PLAIN_NOTE), `[${engine}] the older room hides the untagged note and still shows an ordinary Kosmos note`, JSON.stringify(shown2.slice(0, 200)));
        chk(errs.length === 0, `[${engine}] no page errors`, errs.join(' | '));
        await ctx.close();
      } finally {
        await browser.close();
      }
    }
  } finally {
    try { await server.close(); } catch { /* server may already be down */ }
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nALL PASS');
})().catch((e) => { console.error(e); process.exit(1); });
