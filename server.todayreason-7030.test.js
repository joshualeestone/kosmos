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

// Only the fields the reason reads (a present, tied agent, as the board's rows are): inputs to one function, not
// stand-ins for board cards (fixture-discipline).
const live = (fields) => ({ present: true, tied: true, ...fields });
const reason = (card) => cardlabel.reasonOf(card, needsPerson(card));

test('#7030 reasonOf: each reason the phone has a sentence for', () => {
  assert.equal(reason(live({ state: 'needs_you', stateReportedBy: 'agent' })), 'question', 'its own question');
  assert.equal(reason(live({ state: 'needs_you' })), 'question', 'a question read off its screen');
  assert.equal(reason(live({ state: 'needs_you', awaitingApproval: true })), 'permission');
  assert.equal(reason(live({ state: 'needs_trust' })), 'trust');
  assert.equal(reason(live({ state: 'connection_lost', reconnect: { phase: 'gave_up' } })), 'gave_up');
  assert.equal(reason(live({ state: 'idle', crashLoop: { looping: true } })), 'crash_loop');
  assert.equal(reason(live({ state: 'auth_failed', stuckError: { stuck: true, state: 'auth_failed' } })), 'stuck_auth');
  assert.equal(reason(live({ state: 'rate_limited', stuckError: { stuck: true, state: 'rate_limited' } })), 'stuck_rate');
  assert.equal(reason(live({ state: 'idle', ownBound: { raised: true } })), 'own_bound');
  // On Today with no specific reason from the engine: worded generally.
  assert.equal(reason(live({ state: 'idle', running: false })), 'other', 'not running');
  assert.equal(reason(live({ state: 'rate_limited' })), 'other', 'a rate limit not counted as stuck');
  assert.equal(reason(live({ state: 'blocked' })), 'other');
  for (const r of ['question', 'permission', 'trust', 'gave_up', 'crash_loop', 'stuck_auth', 'stuck_rate', 'own_bound', 'other']) {
    assert.ok(cardlabel.NEEDS_REASONS.includes(r), r);
  }
});

test('#7030 reasonOf: precedence, and no reason for an agent Today does not show', () => {
  // A permission prompt is a permission even when the agent itself reported the wait.
  assert.equal(reason(live({ state: 'needs_you', stateReportedBy: 'agent', awaitingApproval: true })), 'permission');
  // The engine's order: a crash loop outranks a connection Kosmos gave up on.
  assert.equal(reason(live({ state: 'connection_lost', reconnect: { phase: 'gave_up' }, crashLoop: { looping: true } })), 'crash_loop');
  for (const quiet of [live({ state: 'working' }), live({ state: 'idle' }), live({ state: 'restarting' }),
    live({ state: 'connection_lost', reconnect: { phase: 'waiting' } })]) {
    assert.equal(reason(quiet), null, JSON.stringify(quiet));
  }
  // CONTROL: the tone decides, so the same idle card with the board's needs-the-person verdict gets a reason.
  assert.equal(cardlabel.reasonOf(live({ state: 'idle' }), true), 'other');
});

test('#7030 withCardWords: the project name from the route\'s projects read; none when unknown, unnamed or unread', () => {
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
    assert.ok(by('sol').needsReason && by('rae').needsReason, 'CONTROL: the needs-you rows carry a reason');
  } finally { board.restore(); }
});

test('#7030 /api/status: an unreadable projects file still answers, with no project names and the unread count at 0', async () => {
  const projects = require('./engine/projects');
  projects.writeAll([{ id: 'p-x', name: 'X', folder: SANDBOX, agents: [], tasks: [] }]);
  const f = projects.file();
  fs.chmodSync(f, 0o000);
  const board = fleet.install([fleet.agent('quin', { state: 'needs_you' })]);
  try {
    const res = await fetch(base + '/api/status');
    assert.equal(res.status, 200, 'an unreadable projects file failed the status read');
    const s = await res.json();
    assert.equal(s.counts.projectsUnread, 0);
    assert.equal(s.agents.find((a) => a.sessionName === 'quin').needsReason, 'question');
  } finally { board.restore(); fs.chmodSync(f, 0o600); }
});
