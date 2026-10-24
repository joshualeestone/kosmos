'use strict';
require('./test-support/tmpscope');
/**
 * #7030 (the iPhone plan's slice 4, #6838): /api/status gives each agent the phone's Today shows a reason code
 * (needsReason, engine/cardlabel reasonOf) and the name of the project its wait names (stateProjectName), ready-made,
 * so the phone turns the code into the board's own sentence (PJ_NEEDS_WHY) and keeps no copy of the rule.
 *   1. reasonOf on cards built by hand: each reason, the precedence that matters, and no reason off Today;
 *   2. withCardWords: the project name from the route's one read of the projects file, absent when unknown or unread;
 *   3. the route, on a fake fleet classified by the real engine.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-todayreason-7030-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, withCardWords } = require('./server');
const fleet = require('./test-support/fleet');
const cardlabel = require('./engine/cardlabel');
const { needsPerson } = require('./engine/status');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.close(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

/* Review 1: every card below starts from a REAL /api/status row (an idle agent on a fake fleet, classified by the real
   engine), with only the fields under test changed. Hand-built cards supplied `present` and `tied`, which real rows
   never carry, and so passed on a premise production lacks: every reason but the question read 'other' for real. */
let REAL = null;
async function realRow() {
  if (REAL) return REAL;
  const board = fleet.install([fleet.agent('basil', { state: 'idle' })]);
  try {
    const s = await (await fetch(base + '/api/status')).json();
    const row = s.agents.find((a) => a.sessionName === 'basil');
    assert.ok(row, 'CONTROL: the agent is on the board');
    const { cardWord, cardTone, needsReason, stateProjectName, ...card } = row;
    REAL = card;
    return REAL;
  } finally { board.restore(); }
}
const reason = (card) => cardlabel.reasonOf(card, needsPerson(card));

test('#7030 premise: a real status row carries no present or tied, and the board says it is ours', async () => {
  const row = await realRow();
  assert.equal('present' in row, false, 'real rows now carry present; the review-1 note is stale');
  assert.equal('tied' in row, false, 'real rows now carry tied; the review-1 note is stale');
  assert.equal(row.isNamedOurs, true);
  assert.equal(reason(row), null, 'CONTROL: an idle agent is not on Today');
});

test('#7030 reasonOf on real rows: each reason the phone has a sentence for', async () => {
  const r = await realRow();
  const on = (fields) => reason({ ...r, ...fields });
  assert.equal(on({ state: 'needs_you', stateReportedBy: 'agent' }), 'question', 'its own question');
  assert.equal(on({ state: 'needs_you' }), 'question', 'a question read off its screen');
  assert.equal(on({ state: 'needs_you', awaitingApproval: true }), 'permission');
  assert.equal(on({ state: 'needs_you', disruption: { failed: true } }), 'restart_failed');
  assert.equal(on({ state: 'needs_trust' }), 'trust');
  assert.equal(on({ state: 'needs_trust', running: false, needsTrust: true }), 'trust', 'a trust prompt on a card that is not running');
  assert.equal(on({ state: 'connection_lost', reconnect: { phase: 'gave_up' } }), 'gave_up');
  assert.equal(on({ crashLoop: { looping: true } }), 'crash_loop');
  assert.equal(on({ state: 'auth_failed', stuckError: { stuck: true, state: 'auth_failed' } }), 'stuck_auth');
  assert.equal(on({ state: 'rate_limited', stuckError: { stuck: true, state: 'rate_limited' } }), 'stuck_rate');
  assert.equal(on({ ownBound: { raised: true } }), 'own_bound');
  // On Today with no specific reason from the engine: worded generally.
  assert.equal(on({ running: false }), 'other', 'not running');
  assert.equal(on({ state: 'rate_limited' }), 'other', 'a rate limit not counted as stuck');
  assert.equal(on({ state: 'blocked' }), 'other');
  assert.deepEqual([...cardlabel.NEEDS_REASONS].sort(), ['crash_loop', 'gave_up', 'other', 'own_bound', 'permission', 'question',
    'restart_failed', 'stuck_auth', 'stuck_rate', 'trust']);
});

test('#7030 reasonOf on real rows: the board\'s order, and no reason for an agent Today does not show', async () => {
  const r = await realRow();
  const on = (fields) => reason({ ...r, ...fields });
  // pjAlsoWhy's order: a failed restart, then a crash loop, before the question.
  assert.equal(on({ state: 'needs_you', disruption: { failed: true }, crashLoop: { looping: true } }), 'restart_failed');
  assert.equal(on({ state: 'needs_you', awaitingApproval: true, crashLoop: { looping: true } }), 'crash_loop',
    'the card says Keeps stopping, so the sentence must not say it is waiting for an answer');
  // labelOf's order: an agent-reported wait reads Question even on a permission prompt, so the sentence agrees.
  assert.equal(on({ state: 'needs_you', stateReportedBy: 'agent', awaitingApproval: true }), 'question');
  // A rate limit never hides a real reason (needsYouReasonPastUsage).
  assert.equal(on({ state: 'connection_lost', reconnect: { phase: 'gave_up' }, stuckError: { stuck: true, state: 'rate_limited' } }), 'gave_up');
  // Review 2: a pane the board does not say is ours is still on Today when its reconnect gave up (needsPerson does not
  // ask about the tie), and its reason is the real one: the tie gate is for crediting a project, which Today does not do.
  assert.equal(on({ state: 'connection_lost', reconnect: { phase: 'gave_up' }, isNamedOurs: false }), 'gave_up');
  // Review 2: an offline card on its trust prompt, shaped as the route builds one (server.js: state needs_trust,
  // running false, needsTrust true, and its crashloop read), is trust even when its short runs register as a loop:
  // its word is "Waiting on a trust prompt", and the engine ranks trust above a crash loop.
  const offlineTrust = { state: 'needs_trust', running: false, needsTrust: true };
  assert.equal(cardlabel.labelOf({ ...r, ...offlineTrust, crashLoop: { looping: true } }), 'Waiting on a trust prompt', 'premise: the word');
  assert.equal(on({ ...offlineTrust, crashLoop: { looping: true } }), 'trust');
  for (const quiet of [{ state: 'working' }, { state: 'idle' }, { state: 'restarting' }, { state: 'connection_lost', reconnect: { phase: 'waiting' } }]) {
    assert.equal(on(quiet), null, JSON.stringify(quiet));
  }
  // The tone decides: the same idle row with the board's needs-the-person verdict gets a reason.
  assert.equal(cardlabel.reasonOf({ ...r }, true), 'other');
});

test('#7030 premise: an offline card on its trust prompt, as the route builds it, is already needs_you (no tone change needed)', () => {
  // Review 2: the route gives an offline card needsTrust only together with state needs_trust, which needsPerson counts,
  // so its tone was needs_you before this card; an earlier version added a tone branch for an idle row nobody builds.
  const card = { state: 'needs_trust', running: false, needsTrust: true };
  assert.equal(needsPerson(card), true);
  assert.equal(cardlabel.toneOf(card, needsPerson(card)), 'needs_you');
});

test('#7030 withCardWords: the project name from the route\'s projects read; none when unknown, unnamed or unread', async () => {
  const r = await realRow();
  const live = (fields) => ({ ...r, ...fields });
  const list = [{ id: 'p-cat', name: 'Spring catalogue' }, { id: 'p-blank', name: '' }];
  const [named, unknown, blank, none] = withCardWords([
    live({ state: 'needs_you', stateReportedBy: 'agent', stateProject: 'p-cat' }),
    live({ state: 'needs_you', stateReportedBy: 'agent', stateProject: 'p-gone' }),
    live({ state: 'needs_you', stateReportedBy: 'agent', stateProject: 'p-blank' }),
    live({ state: 'needs_you', stateReportedBy: 'agent' }),
  ], list);
  assert.equal(named.stateProjectName, 'Spring catalogue');
  assert.equal(named.needsReason, 'question');
  for (const r of [unknown, blank, none]) assert.equal('stateProjectName' in r, false, JSON.stringify(r));
  const [unread] = withCardWords([live({ state: 'needs_you', stateProject: 'p-cat' })], null);
  assert.equal('stateProjectName' in unread, false, 'an unreadable projects file named a project');
  assert.equal(unread.needsReason, 'question', 'and the reason still goes');
  const [calm] = withCardWords([live({ state: 'working', stateProject: 'p-cat' })], list);
  assert.equal('needsReason' in calm, false, 'a working agent carried a reason');
});

test('#7030 /api/status: rows on Today carry needsReason equal to reasonOf over that row; others carry none', async () => {
  const board = fleet.install([
    fleet.agent('wanda', { state: 'working' }),
    fleet.agent('ivo', { state: 'idle' }),
    fleet.agent('sol', { state: 'auth_failed' }),
    fleet.agent('rae', { state: 'rate_limited' }),
    fleet.agent('quin', { state: 'needs_you' }),
  ]);
  try {
    const res = await fetch(base + '/api/status');
    assert.equal(res.status, 200);
    const s = await res.json();
    const rows = s.agents.filter((a) => ['wanda', 'ivo', 'sol', 'rae', 'quin'].includes(a.sessionName));
    assert.equal(rows.length, 5, 'CONTROL: the five agents are on the board');
    for (const r of rows) {
      const { cardWord, cardTone, needsReason, stateProjectName, ...card } = r;
      assert.equal(needsReason === undefined ? null : needsReason, cardlabel.reasonOf(card, needsPerson(card)), r.sessionName);
    }
    const by = (n) => rows.find((a) => a.sessionName === n);
    assert.equal(by('wanda').needsReason, undefined);
    assert.equal(by('ivo').needsReason, undefined);
    assert.equal(by('quin').needsReason, 'question');
    // A sign-in error and a rate limit not yet counted as stuck: on Today, with no specific reason.
    assert.deepEqual([by('sol').needsReason, by('rae').needsReason], ['other', 'other']);
  } finally { board.restore(); }
});

test('#7030 /api/status: an unreadable projects file still answers, with no project names and the unread count at 0', async () => {
  const projects = require('./engine/projects');
  projects.writeAll([{ id: 'p-x', name: 'X', folder: SANDBOX, agents: [], tasks: [] }]);
  const f = projects.file();
  fs.chmodSync(f, 0o000);
  // Review 2: only meaningful where the mode really blocks the read (not as root, not on Windows).
  let blocked = false;
  try { projects.readAll(); } catch { blocked = true; }
  if (!blocked) { fs.chmodSync(f, 0o600); return; }
  const board = fleet.install([fleet.agent('quin', { state: 'needs_you' })]);
  try {
    const res = await fetch(base + '/api/status');
    assert.equal(res.status, 200, 'an unreadable projects file failed the status read');
    const s = await res.json();
    assert.equal(s.counts.projectsUnread, 0);
    assert.equal(s.agents.find((a) => a.sessionName === 'quin').needsReason, 'question');
  } finally { board.restore(); fs.chmodSync(f, 0o600); }
});
