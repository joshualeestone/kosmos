'use strict';
/* Mona's look review of #3701 (the Tasks view, #3559): each thing said once per row, the Assigned
 * row in Josh's words where that is true, no Closed tile, and the two big gaps halved. The row is
 * the REAL tskRow lifted from web/index.html; "never reported" is the engine's field, end to end.
 *
 *   node --test web.tasks-look-3559.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// The roster is REAL board cards (fixture-discipline): sandbox the roots before requiring the fleet.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tasklook-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');
const commitments = require('./engine/commitments');
const tasks = require('./engine/tasks');
const fleet = require('./test-support/fleet');
const BOARD = fleet.install([fleet.agent('rex')]);
const REX = BOARD.agents.find((c) => c.sessionName === 'rex');
test.after(() => { try { BOARD.restore(); } catch { /* restored */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const GROUPS = SCRIPT.match(/const TSK_GROUPS = \[[\s\S]*?\n\];/)[0];
const FNS = page.liftAll(SCRIPT, ['claimNotReported', 'tskAgentName', 'tskRow']);
const rowOf = (t, by) => new Function('TSK', 'LAST', 'esc', 'agoWords', 'tskKey',
  GROUPS + '\n' + FNS + '\nreturn tskRow;')(
  { sel: new Set(), by }, [REX], (s) => String(s), () => '1 hour ago',
  (x) => x.projectId + '#' + x.number)(t);
const T = (over) => Object.assign({ number: 3, projectId: 'p', projectName: 'Launch', sentence: 'Do it',
  whoNames: ['rex'], state: 'assigned', createdAt: '2026-09-25T00:00:00Z', lastActivityAt: null, claim: null }, over);

test('the engine says "never reported" as a field, only for a record that does not exist', () => {
  const never = commitments.read('nobody-has-ever-reported');
  assert.equal(never.state, 'unknown');
  assert.equal(never.neverReported, true);
  const claim = tasks.claimFor({ number: 1, who: 'nobody-has-ever-reported' }, never);
  assert.equal(claim.claimed, null);
  assert.equal(claim.neverReported, true);
  // CONTROL: an unknown reading that is NOT "never reported" (unreadable, stale) does not say so.
  const unreadable = tasks.claimFor({ number: 1, who: 'x' }, { state: 'unknown', commitments: [], because: 'its record could not be read' });
  assert.equal(unreadable.neverReported, false);
  assert.equal(tasks.claimFor({ number: 1, who: 'x' }, null).neverReported, false);
});

test('the engine names an agent only while it holds open work on the task (never the one who finished)', () => {
  const never = commitments.read('nobody-has-ever-reported');
  // Parts: the first agent's part is done, another agent's is open. The reading is for the first.
  const donePart = { number: 2, parts: [{ id: 1, who: 'nobody-has-ever-reported', closedAt: '2026-09-25T00:00:00Z' }, { id: 2, who: 'someone-else', closedAt: null }] };
  assert.equal(tasks.claimFor(donePart, never).neverReported, false, 'the agent who finished is blamed for not reporting');
  const openPart = { number: 3, parts: [{ id: 1, who: 'nobody-has-ever-reported', closedAt: null }, { id: 2, who: 'someone-else', closedAt: null }] };
  assert.equal(tasks.claimFor(openPart, never).neverReported, true);
  assert.equal(tasks.claimFor({ number: 4, who: 'nobody-has-ever-reported' }, never).neverReported, true, 'a plain task lost it');
});

test('an agent that never reported: the row says so in the agent\'s name, briefly', () => {
  const html = rowOf(T({ claim: { claimed: null, neverReported: true, because: 'this agent has never reported what it is holding' } }), 'status');
  assert.ok(REX && REX.name, 'the fleet card has no name to speak');
  assert.ok(html.includes('<div class="why">' + REX.name + ' has not reported what it is working on yet.</div>'), html);
  // Only what the field knows: no record. Not "has not said", since it may have spoken in the room.
  assert.doesNotMatch(html, /has not said/);
  assert.doesNotMatch(html, /holding/, 'our word is back on the row');
});

test('one fact, one wording: the project card and the task page say "never reported" the same way', () => {
  const helper = page.liftAll(SCRIPT, ['claimNotReported', 'taskClaimHtml']);
  const { claimNotReported, taskClaimHtml } = new Function('esc', helper + '\nreturn { claimNotReported, taskClaimHtml };')((x) => String(x));
  const never = { claimed: null, neverReported: true, because: 'this agent has never reported what it is holding' };
  assert.equal(claimNotReported(never), 'has not reported what it is working on yet');
  assert.match(taskClaimHtml(never), />has not reported what it is working on yet</);
  assert.doesNotMatch(taskClaimHtml(never), /holding/, 'the project card still shows our prose for the same fact');
  // CONTROL: another could-not-tell case keeps its own reason on the card.
  assert.match(taskClaimHtml({ claimed: null, neverReported: false, because: 'its record could not be read' }), />its record could not be read</);
  // The task page's line uses the same helper.
  assert.match(SCRIPT, /why\.textContent = notReported \? \(sayShown \|\| !claimWho \? '' : claimWho \+ ' ' \+ notReported \+ '\.'\)/);
});

test('could not tell for another reason: the row keeps the reason, never "has not said"', () => {
  const html = rowOf(T({ claim: { claimed: null, neverReported: false, because: 'its record could not be read' } }), 'status');
  assert.match(html, /We cannot tell whether it started: its record could not be read\./);
  assert.doesNotMatch(html, /has not reported/, 'an unreadable record is reported as never written');
  assert.doesNotMatch(rowOf(T({ claim: { claimed: false } }), 'status'), /class="why"/, 'a definite answer carries a sentence');
});

test('the state line shows only when grouping by project; the agent pill shows in both', () => {
  const t = T({ claim: { claimed: false } });
  const byStatus = rowOf(t, 'status');
  const byProject = rowOf(t, 'project');
  assert.doesNotMatch(byStatus, /class="tsk-state"/, 'the row repeats its own group heading');
  assert.match(byProject, /class="tsk-state"[^>]*><span class="tsk-dot"><\/span>Assigned, not started<\/span>/);
  for (const html of [byStatus, byProject]) assert.match(html, /class="tsk-who" data-agent="rex">/);
  // A screen reader moving between checkboxes still hears the state the row no longer shows.
  assert.match(byStatus, /aria-label="Select task 3 of Launch, Assigned, not started"/);
});

test('Closed is not a tile; it stays the folded list', () => {
  assert.match(SCRIPT, /getElementById\('tsk-tiles'\)\.innerHTML = !TSK\.data \? '' : TSK_GROUPS\.filter\(\(g\) => g\.k !== 'closed'\)\.map/);
  assert.match(SCRIPT, /<details class="tsk-fold"/, 'the Closed fold is gone');
});

test('the two big gaps: less top padding, and an empty crumb or status line takes no room', () => {
  assert.match(PAGE, /\.tsk-main \{ padding: 25px 26px 110px;/);
  assert.match(PAGE, /\.tsk-crumb:empty \{ min-height: 0; margin: 0; \}/);
  // The status line keeps its reserved line (a message must not push the list down); its margins go.
  assert.match(PAGE, /#tsk-msg \{ margin: 0; min-height: 1\.6em; min-height: 1lh; \}/);
  assert.doesNotMatch(PAGE, /#tsk-msg:empty \{[^}]*min-height: 0/, 'an empty status line collapses, so a message shifts the list');
  assert.match(PAGE, /#tsk-groups > \.tsk-grp:first-child \{ margin-top: 3px; \}/);
  // The status line must stay a live region: it is never display:none.
  assert.doesNotMatch(PAGE, /#tsk-msg[^{]*\{[^}]*display:\s*none/);
});

test('#3559 (Josh): the Tasks tab and the rail button start hidden and follow the status poll\'s tasksTab', () => {
  assert.match(PAGE, /<button class="tab"\s+data-tab="tasks"\s+role="tab" aria-selected="false" hidden>Tasks<\/button>/,
    'the tab is on screen before the poll says there are 25 tasks');
  assert.match(PAGE, /id="rail-projects-tasks" title="[^"]*" hidden>Tasks<\/button>/, 'the consolidated rail button is on screen before 25 tasks');
  assert.match(SCRIPT, /fedGateStamp\(data\);\s*\/\/[^\n]*\n\s*tskTabGate\(data\.tasksTab === true\);/, 'the status poll does not apply the gate');
  const els = { tab: { hidden: true }, rail: { hidden: true } };
  const document = { querySelector: (q) => (q === '.tab[data-tab="tasks"]' ? els.tab : null), getElementById: (id) => (id === 'rail-projects-tasks' ? els.rail : null) };
  const gate = new Function('document', page.liftAll(SCRIPT, ['tskTabGate']) + '\nreturn tskTabGate;')(document);
  gate(true);
  assert.deepEqual([els.tab.hidden, els.rail.hidden], [false, false]);
  gate(false);
  assert.deepEqual([els.tab.hidden, els.rail.hidden], [true, true], 'a false (or missing) tasksTab does not hide them');
});
