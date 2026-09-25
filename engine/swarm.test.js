'use strict';
// Sandbox every root BEFORE any require.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-swarm-')));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const swarm = require('./swarm');
const projects = require('./projects');
const store = require('./store');
const chat = require('./chat');
const fleet = require('../test-support/fleet');

test.after(() => { try { fleet.restore(); } catch { /* ok */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

/* ---- settings ---------------------------------------------------------------- */

test('#3564 createProblem: Claude only, 2-10 helpers, a daily limit required', () => {
  assert.equal(swarm.createProblem({ provider: 'anthropic', maxHelpers: 3, dailyTokenLimit: 1000 }), null);
  assert.equal(swarm.createProblem({ dailyTokenLimit: 1000 }), null, 'no provider means Claude, and no count means the default');
  assert.match(swarm.createProblem({ provider: 'openai', dailyTokenLimit: 1000 }), /Claude/);
  for (const n of [1, 11, 2.5, '3']) assert.match(swarm.createProblem({ maxHelpers: n, dailyTokenLimit: 1000 }), /2 to 10/, String(n));
  for (const n of [2, 10]) assert.equal(swarm.createProblem({ maxHelpers: n, dailyTokenLimit: 1000 }), null, 'CONTROL: ' + n);
  for (const lim of [undefined, 0, -5, 1.5, '1000']) assert.match(swarm.createProblem({ dailyTokenLimit: lim }), /daily token limit/, String(lim));
});

test('#3564 settings: born active with the default count; a patch is checked key by key; switching on clears the reason', () => {
  const born = swarm.birthProfile({ dailyTokenLimit: 5000 });
  assert.equal(born.kind, 'swarm');
  assert.deepEqual(swarm.settingsOf(born), { maxHelpers: swarm.DEFAULT_HELPERS, dailyTokenLimit: 5000, active: true, pausedBecause: null, pausedAt: null, limitOverrideDay: null });
  assert.equal(swarm.settingsOf({ role: 'pm' }), null, 'an ordinary agent has no swarm settings');
  for (const bad of [null, [], {}, { maxHelpers: 11 }, { dailyTokenLimit: 0 }, { active: 'no' }, { other: 1 }]) {
    assert.ok(swarm.patchProblem(bad), JSON.stringify(bad) + ' was accepted');
  }
  const off = swarm.applyPatch(born, { active: false });
  assert.equal(off.active, false);
  assert.equal(off.pausedBecause, 'person');
  assert.ok(off.pausedAt);
  const on = swarm.applyPatch({ ...born, swarm: off }, { active: true });
  assert.deepEqual([on.active, on.pausedBecause, on.pausedAt], [true, null, null]);
  assert.deepEqual(swarm.applyPatch(born, { maxHelpers: 7 }).maxHelpers, 7);
});

test('#3564 the lead\'s block names its own N, isolation, claims and one voice', () => {
  const flat = swarm.blockBody(6).replace(/\s+/g, ' ');
  assert.match(flat, /at most 6 at once/);
  assert.match(flat, /isolation set to "worktree"/);
  assert.match(flat, /exactly one part/);
  assert.match(flat, /Only you speak: helpers never post in a room/);
  assert.doesNotMatch(flat, /Kosmos tells you that you are paused/, 'the block relies on a pause message nothing ever sends');
  assert.ok(projects.ALL_MARKERS().includes(swarm.START) && projects.ALL_MARKERS().includes(swarm.END), 'the markers are not registered');
});

/* ---- the meter ----------------------------------------------------------------- */

const NOW = new Date(2026, 8, 24, 15, 0, 0).getTime();   // 15:00 local
const today = (h, m = 0) => new Date(2026, 8, 24, h, m, 0).toISOString();
const yesterday = new Date(2026, 8, 23, 23, 0, 0).toISOString();
const asst = (at, usage, stop) => JSON.stringify({ type: 'assistant', timestamp: at, message: { role: 'assistant', stop_reason: stop || null, usage } });
const U = (i, o, cw, cr) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: cw || 0, cache_read_input_tokens: cr || 0 });

function transcripts(dirName, files) {
  const dir = path.join(SANDBOX, 'proj', dirName);
  for (const [rel, lines, mtime] of files) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, lines.join('\n') + '\n');
    if (mtime) fs.utimesSync(f, new Date(mtime), new Date(mtime));
  }
  return dir;
}

test('#3564 meter: today\'s lead + helper tokens (all four counts), yesterday left out, working helpers counted honestly', () => {
  swarm.resetForTests();
  const dir = transcripts('m1', [
    ['sess1.jsonl', [asst(yesterday, U(1000, 1000)), asst(today(9), U(10, 20, 30, 40), 'end_turn')], NOW - 60000],
    // A finished helper, a working one, and one that stopped moving 11 minutes ago without finishing.
    ['sess1/subagents/agent-done.jsonl', [asst(today(10), U(100, 100), 'end_turn')], NOW - 60000],
    ['sess1/subagents/agent-busy.jsonl', [asst(today(14, 59), U(5, 5), 'tool_use')], NOW - 30000],
    ['sess1/subagents/agent-dead.jsonl', [asst(today(14, 40), U(1, 1), 'tool_use')], NOW - 11 * 60000],
    // An earlier session today (a Fresh start) still counts toward today.
    ['sess0.jsonl', [asst(today(8), U(50, 50), 'end_turn')], NOW - 7 * 3600000],
  ]);
  const m = swarm.meter(path.join(dir, 'sess1.jsonl'), NOW);
  assert.equal(m.leadTokens, 100 + 100, 'lead: 10+20+30+40 today in sess1, and 50+50 in sess0; yesterday excluded');
  assert.equal(m.helperTokens, 200 + 10 + 2);
  assert.equal(m.tokensToday, m.leadTokens + m.helperTokens);
  assert.equal(m.activeHelpers, 1, 'only the helper that is unfinished AND moving is working');
  assert.deepEqual(swarm.meter(null, NOW), { tokensToday: 0, leadTokens: 0, helperTokens: 0, activeHelpers: 0 });
});

test('#3564 meter: one message counts ONCE, however many content-block lines carry its usage (measured 2.23x overcount)', () => {
  swarm.resetForTests();
  const line = (id, stop) => JSON.stringify({ type: 'assistant', timestamp: today(9), message: { id, role: 'assistant', stop_reason: stop || null, usage: U(100, 0) } });
  const dir = transcripts('dup', [['s.jsonl', [line('msg_1', 'tool_use'), line('msg_1', 'tool_use'), line('msg_1', 'tool_use'), line('msg_2', 'end_turn')], NOW - 60000]]);
  assert.equal(swarm.meter(path.join(dir, 's.jsonl'), NOW).leadTokens, 200, 'a message was counted once per content block');
});

test('#3564 meter: reads grow incrementally and stay exact, including a line cut in half at the read point', () => {
  swarm.resetForTests();
  const line = (id, n) => JSON.stringify({ type: 'assistant', timestamp: today(9), message: { id, role: 'assistant', stop_reason: 'tool_use', usage: U(n, 0) } });
  const dir = transcripts('inc', [['s.jsonl', [line('a', 10)], NOW - 60000]]);
  const f = path.join(dir, 's.jsonl');
  assert.equal(swarm.meter(f, NOW).leadTokens, 10);
  const next = line('b', 20);
  fs.appendFileSync(f, next.slice(0, 25));            // half a line
  assert.equal(swarm.meter(f, NOW).leadTokens, 10, 'half a line was counted');
  fs.appendFileSync(f, next.slice(25) + '\n' + line('a', 10) + '\n' + line('c', 5) + '\n');
  assert.equal(swarm.meter(f, NOW).leadTokens, 35, 'the rest of the line, a repeated id and a new one: 10 + 20 + 5');
  fs.writeFileSync(f, line('z', 7) + '\n');           // rewritten shorter: read from the start
  assert.equal(swarm.meter(f, NOW).leadTokens, 7);
});

test('#3564 cardField: null for an ordinary agent; for a swarm, settings + meter + the real ratio', () => {
  swarm.resetForTests();
  let resolved = 0;
  assert.equal(swarm.cardField({ role: 'pm' }, () => { resolved += 1; return null; }, NOW), null);
  assert.equal(resolved, 0, 'an ordinary agent paid for resolving its transcript');
  const dir = transcripts('m2', [
    ['s.jsonl', [asst(today(9), U(100, 0), 'end_turn')], NOW - 60000],
    ['s/subagents/agent-a.jsonl', [asst(today(9), U(170, 0), 'end_turn')], NOW - 60000],
  ]);
  const f = swarm.cardField(swarm.birthProfile({ maxHelpers: 4, dailyTokenLimit: 9999 }), () => path.join(dir, 's.jsonl'), NOW);
  assert.deepEqual(f, { maxHelpers: 4, activeHelpers: 0, tokensToday: 270, dailyTokenLimit: 9999, active: true, pausedBecause: null, helperTokenRatio: 2.7 });
});

/* ---- the daily limit --------------------------------------------------------------- */

function deps(profiles) {
  const calls = { writes: [], interrupts: [], stops: [], says: [] };
  return {
    calls,
    readProfile: (n) => profiles[n],
    writeProfile: (n, patch) => { calls.writes.push([n, patch]); profiles[n] = { ...profiles[n], ...patch }; },
    interrupt: (n) => { calls.interrupts.push(n); return { ok: true }; },
    stopHelpers: (n, count) => { calls.stops.push([n, count]); return { ok: true, sent: count }; },
    say: (n, text) => { calls.says.push([n, text]); },
  };
}
const card = (name, tokensToday, activeHelpers = 0) => ({ name, tokensToday, activeHelpers });   // a sweep row, not a board card (sweepRows derives these)

test('#3564 sweep: at the limit it stops its working helpers too (one Escape does not); none working, none stopped', () => {
  const profiles = { busy: swarm.birthProfile({ dailyTokenLimit: 1000 }), calm: swarm.birthProfile({ dailyTokenLimit: 1000 }) };
  const d = deps(profiles);
  const did = swarm.sweepOnce([card('busy', 1000, 3), card('calm', 1000, 0)], d, NOW);
  assert.deepEqual(d.calls.stops, [['busy', 3]], 'the helpers of a swarm paused at its limit were left running');
  assert.deepEqual(did.map((x) => [x.name, x.helpersStopped]), [['busy', 3], ['calm', 0]]);
});

test('#3564 sweep: at the limit it pauses itself, interrupts, and says so in its DM; below the limit nothing happens', () => {
  const profiles = { big: swarm.birthProfile({ dailyTokenLimit: 1000 }), small: swarm.birthProfile({ dailyTokenLimit: 1000 }) };
  const d = deps(profiles);
  const did = swarm.sweepOnce([card('big', 1000), card('small', 999)], d, NOW);
  assert.deepEqual(did.map((x) => [x.name, x.action]), [['big', 'paused']]);
  assert.equal(swarm.settingsOf(profiles.big).pausedBecause, 'limit');
  assert.equal(swarm.settingsOf(profiles.big).active, false);
  assert.deepEqual(d.calls.interrupts, ['big']);
  assert.match(d.calls.says[0][1], /paused myself at today's token limit \(1000 tokens\)/);
  assert.equal(swarm.settingsOf(profiles.small).active, true, 'CONTROL: under the limit it keeps running');
  // Already paused: a second pass does nothing more.
  assert.equal(swarm.sweepOnce([card('big', 5000)], d, NOW).length, 0);
});

test('#3564 sweep: switched back on by the person over its limit, it is NOT re-paused that day; the next day the limit applies again', () => {
  const limited = { ...swarm.birthProfile({ dailyTokenLimit: 1000 }), swarm: swarm.pausedFor(swarm.settingsOf(swarm.birthProfile({ dailyTokenLimit: 1000 })), 'limit', NOW - 3600000) };
  const on = swarm.applyPatch(limited, { active: true }, NOW);
  const profiles = { over: { ...limited, swarm: on } };
  const d = deps(profiles);
  assert.equal(swarm.sweepOnce([card('over', 5000)], d, NOW).length, 0, 'the person switched it on and the sweep paused it again');
  assert.equal(d.calls.interrupts.length, 0);
  // CONTROL: the next day, over its (new day's) limit, it pauses again.
  const tomorrow = NOW + 24 * 3600000;
  assert.deepEqual(swarm.sweepOnce([card('over', 5000)], deps(profiles), tomorrow).map((x) => x.action), ['paused']);
});

test('#3564 sweep: a LIMIT pause lifts on the next day; a person\'s pause or Stop now never lifts by itself', () => {
  const earlier = new Date(2026, 8, 23, 18, 0, 0).getTime();
  const mk = (because) => ({ ...swarm.birthProfile({ dailyTokenLimit: 1000 }), swarm: swarm.pausedFor(swarm.settingsOf(swarm.birthProfile({ dailyTokenLimit: 1000 })), because, earlier) });
  const profiles = { lim: mk('limit'), per: mk('person'), stp: mk('stopped') };
  profiles.per.swarm.pausedBecause = 'person';
  const d = deps(profiles);
  const did = swarm.sweepOnce([card('lim', 0), card('per', 0), card('stp', 0)], d, NOW);
  assert.deepEqual(did.map((x) => [x.name, x.action]), [['lim', 'resumed']]);
  assert.equal(swarm.settingsOf(profiles.lim).active, true);
  assert.equal(swarm.settingsOf(profiles.per).active, false);
  assert.equal(swarm.settingsOf(profiles.stp).active, false);
  // CONTROL: a limit pause from EARLIER TODAY does not lift yet.
  const fresh = { ...swarm.birthProfile({ dailyTokenLimit: 1000 }), swarm: swarm.pausedFor(swarm.settingsOf(swarm.birthProfile({ dailyTokenLimit: 1000 })), 'limit', NOW - 3600000) };
  assert.equal(swarm.sweepOnce([card('fresh', 0)], deps({ fresh }), NOW).length, 0);
});

/* ---- paused means nothing is typed; Stop now sends Escape ---------------------------- */

function withFleet(specs, fn) {
  const board = fleet.install(specs);
  try { return fn(board); } finally { board.restore(); }
}
function armTmux() {
  const calls = [];
  const fn = (args) => { calls.push(args); return { ran: true, spawnFailed: false, status: 0, out: '', err: '' }; };
  fn.calls = calls;
  chat.setRunner(fn);
  chat.setDryRun(false);
  return fn;
}

test('#3564 a PAUSED swarm is typed at NOT AT ALL; an active one and a looking-after command get past the gate', () => {
  store.writeProfile('lead', { ...swarm.birthProfile({ dailyTokenLimit: 1000 }), swarm: swarm.pausedFor(swarm.settingsOf(swarm.birthProfile({ dailyTokenLimit: 1000 })), 'limit') });
  try {
    withFleet([fleet.agent('lead', { state: 'idle' })], (board) => {
      const c = board.agents.find((a) => a.sessionName === 'lead');
      assert.ok(c && c.swarm && c.swarm.active === false, 'CONTROL: the card carries the paused swarm');
      const tmux = armTmux();
      const v = chat.deliver('lead', 'build the thing', board.agents);
      assert.equal(v.state, chat.DELIVERY.COULD_NOT);
      assert.match(v.because, /paused itself at today's token limit/);
      assert.equal(tmux.calls.length, 0, 'something was sent to a paused swarm');
      // A path is not a command: it stays paused.
      assert.equal(chat.deliver('lead', '/Users/x/file.txt please fix this', board.agents).state, chat.DELIVERY.COULD_NOT);
      assert.equal(tmux.calls.length, 0, 'a message starting with a path got past the pause');
      // Work, even as a slash command, stays paused.
      for (const cmd of ['/pplan build it', '/make-it-so', '/plugin:tidy now']) {
        const before = tmux.calls.length;
        assert.equal(chat.deliver('lead', cmd, board.agents).state, chat.DELIVERY.COULD_NOT, `${cmd} reached a paused swarm`);
        assert.equal(tmux.calls.length, before, `${cmd} was typed at a paused swarm`);
      }
      for (const cmd of ['/compact', '/clear', '/cost', '/context', '/status']) {
        const before = tmux.calls.length;
        const v = chat.deliver('lead', cmd, board.agents);
        assert.ok(tmux.calls.length > before || v.because !== require('./swarm').pausedSentence('lead', 'limit'), `${cmd} was refused as paused`);
        assert.doesNotMatch(String(v.because || ''), /paused/, `${cmd} was refused as paused`);
      }
    });
    store.writeProfile('lead', { swarm: { ...swarm.settingsOf(store.readProfile('lead')), active: true, pausedBecause: null } });
    withFleet([fleet.agent('lead', { state: 'idle' })], (board) => {
      const tmux = armTmux();
      chat.deliver('lead', 'build the thing', board.agents);
      assert.ok(tmux.calls.length > 0, 'CONTROL: an active swarm is not refused at the gate');
    });
  } finally { chat.setRunner(null); }
});

test('#3564 interrupt: Escape to our pane, through the same gate as deliver; a stranger\'s pane gets nothing', () => {
  try {
    withFleet([fleet.agent('lead2', { state: 'idle' }), fleet.stranger('other', { state: 'idle' })], (board) => {
      const tmux = armTmux();
      assert.deepEqual(chat.interrupt('lead2', board.agents), { ok: true });
      const sends = tmux.calls.filter((a) => a[0] === 'send-keys');
      assert.equal(sends.length, 1);
      assert.equal(sends[0][sends[0].length - 1], 'Escape');
      const before = tmux.calls.length;
      const r = chat.interrupt('other', board.agents);
      assert.equal(r.ok, false);
      assert.equal(tmux.calls.length, before, 'a stranger\'s pane was sent a key');
    });
  } finally { chat.setRunner(null); }
});

/* ---- per project On/Off --------------------------------------------------------------- */

test('#3564 per project: a swarm switched off is off only in that project, and back on', () => {
  const p = projects.create({ name: 'Swarm Room' });
  const id = p.id || (p.project && p.project.id);
  assert.ok(id, 'CONTROL: a project exists');
  assert.equal(projects.swarmOffIn(id, 'lead'), false);
  projects.setSwarmOn(id, 'lead', false);
  assert.equal(projects.swarmOffIn(id, 'lead'), true);
  assert.equal(projects.swarmOffIn(id, 'someone-else'), false, 'another agent was switched off too');
  projects.setSwarmOn(id, 'lead', true);
  assert.equal(projects.swarmOffIn(id, 'lead'), false);
});

test('#3564 per project: leaving a project clears its Off, so the agent re-added later starts On; a member who stays keeps it', () => {
  const p = projects.create({ name: 'Swarm Leave Room' });
  const id = p.id || (p.project && p.project.id);
  projects.mutate(id, (x) => ({ ...x, agents: ['leaver', 'stayer'] }));
  projects.setSwarmOn(id, 'leaver', false);
  projects.setSwarmOn(id, 'stayer', false);
  projects.removeAgent(id, 'leaver');
  assert.equal(projects.swarmOffIn(id, 'leaver'), false, 'an agent that left kept its Off, so it would come back switched off');
  assert.equal(projects.swarmOffIn(id, 'stayer'), true, 'CONTROL: removing one member cleared another member\'s Off');
});

test('#3564 sweepRows: only OUR swarms, as { name, tokensToday, activeHelpers }; a plain agent and a stranger are left out', () => {
  store.writeProfile('rowlead', swarm.birthProfile({ dailyTokenLimit: 1000 }));
  store.writeProfile('rowstranger', swarm.birthProfile({ dailyTokenLimit: 1000 }));
  withFleet([fleet.agent('rowlead', { state: 'idle' }), fleet.agent('rowplain', { state: 'idle' }), fleet.stranger('rowstranger', { state: 'idle' })], (board) => {
    const rows = swarm.sweepRows(board.agents);
    assert.deepEqual(rows.map((r) => r.name), ['rowlead']);
    assert.ok(Number.isFinite(rows[0].tokensToday));
    const lead = board.agents.find((c) => c.sessionName === 'rowlead');
    assert.ok(Number.isInteger(rows[0].activeHelpers), 'the board card\'s helper count does not reach the sweep');
    assert.equal(rows[0].activeHelpers, lead.swarm.activeHelpers);
  });
});

test('#3564 stopHelpers: the measured agent-manager keys (Down, then Down+x per helper, then Escape), same gate as deliver', () => {
  try {
    withFleet([fleet.agent('lead3', { state: 'idle' }), fleet.stranger('other3', { state: 'idle' })], (board) => {
      const tmux = armTmux();
      const onScreen = (screen) => chat.setRunner((args) => {
        tmux.calls.push(args);
        return { ran: true, spawnFailed: false, status: 0, out: args[0] === 'capture-pane' ? screen : '', err: '' };
      });
      onScreen('  helper-1 running\n  Enter to view \u00b7 x to stop');
      assert.deepEqual(chat.stopHelpers('lead3', board.agents, 2), { ok: true, sent: 2 });
      const keys = tmux.calls.filter((a) => a[0] === 'send-keys').map((a) => a[a.length - 1]);
      assert.deepEqual(keys, ['Down', 'Down', 'x', 'Down', 'x', 'Escape']);
      // No helper selected on screen (a stale count): no `x` is typed anywhere.
      tmux.calls.length = 0;
      onScreen('> ');
      assert.deepEqual(chat.stopHelpers('lead3', board.agents, 2), { ok: true, sent: 0 });
      const keys2 = tmux.calls.filter((a) => a[0] === 'send-keys').map((a) => a[a.length - 1]);
      assert.deepEqual(keys2, ['Down', 'Down', 'Escape'], 'x was typed with no helper on screen');
      const before = tmux.calls.length;
      assert.deepEqual(chat.stopHelpers('lead3', board.agents, 0), { ok: true, sent: 0 });
      assert.equal(tmux.calls.length, before, 'CONTROL: no helpers, no keys');
      assert.equal(chat.stopHelpers('other3', board.agents, 2).ok, false);
      assert.equal(tmux.calls.length, before, 'a stranger\'s pane was sent keys');
    });
  } finally { chat.setRunner(null); }
});
