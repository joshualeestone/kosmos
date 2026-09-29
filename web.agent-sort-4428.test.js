'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-agent-sort-ui-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
const fleet = require('./test-support/fleet');

const SCRIPT = fs.readFileSync(require.resolve('./web/index.html'), 'utf8');

function lift(names) {
  const out = [];
  for (const name of names) {
    const start = SCRIPT.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} is missing`);
    let depth = 0; let opened = false; let quote = null; let esc = false;
    for (let i = start; i < SCRIPT.length; i += 1) {
      const c = SCRIPT[i];
      if (quote) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') { depth += 1; opened = true; }
      if (c === '}') {
        depth -= 1;
        if (opened && depth === 0) { out.push(SCRIPT.slice(start, i + 1)); break; }
      }
    }
  }
  return out.join('\n');
}

function api() {
  const constants = /const AGENT_SORTS = \[[^\]]*\];\s*const AGENT_SORT_DEFAULT = '[a-z-]+';/.exec(SCRIPT);
  assert.ok(constants, 'the agent sort vocabulary is missing');
  const modelStart = SCRIPT.indexOf('function modelLine(');
  const modelEnd = SCRIPT.indexOf('function acctParenthetical(', modelStart);
  const roleStart = SCRIPT.indexOf('function roleLine(');
  const roleEnd = SCRIPT.indexOf('const NEARLY_FULL =', roleStart);
  assert.ok(modelStart >= 0 && modelEnd > modelStart && roleStart >= 0 && roleEnd > roleStart,
    'the displayed model or role derivation is missing');
  const displayed = SCRIPT.slice(modelStart, modelEnd) + SCRIPT.slice(roleStart, roleEnd);
  const body = displayed + lift(['agentNeedsAttention', 'agentSortMode', 'agentFirstProject', 'sortAgents']);
  const seam = "const ROLE_TITLES = null; function cardStOf(a) { const attention = a && (a.state === 'needs_you' || a.state === 'needs_trust' || (a.state === 'connection_lost' && a.reconnect && a.reconnect.phase === 'gave_up')); return { pres: a && a.state === 'stopped' ? 'off' : 'on', st: attention ? 'attn' : 'idle' }; }";
  return new Function(`${constants[0]}\n${seam}\n${body}\nreturn { AGENT_SORTS, AGENT_SORT_DEFAULT, modelLine, roleLine, agentNeedsAttention, agentSortMode, agentFirstProject, sortAgents };`)();
}

const board = fleet.install(['a', 'ada', 'b', 'bea', 'cam', 'dee', 'missing', 'zed', 'zulu'].map((name) => (
  fleet.agent(name, { displayName: name[0].toUpperCase() + name.slice(1), state: 'idle' })
)));
test.after(() => {
  board.restore();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const a = (name, extra) => Object.assign({}, board.card(name.toLowerCase()), { profile: {} }, extra || {});
const projects = [
  { id: 'z', name: 'Zebra', agents: [board.card('bea')] },
  { id: 'a', name: 'Alpha', agents: [board.card('cam'), board.card('bea')] },
];

test('#4428: saved modes are allow-listed and Last talked to is the default', () => {
  const { AGENT_SORTS, AGENT_SORT_DEFAULT, agentSortMode } = api();
  assert.deepEqual(AGENT_SORTS, ['talked', 'model', 'name', 'needs', 'active', 'newest', 'project', 'role']);
  assert.equal(AGENT_SORT_DEFAULT, 'talked');
  for (const mode of AGENT_SORTS) assert.equal(agentSortMode(mode), mode);
  for (const bad of [null, '', 'oldest', '__proto__']) assert.equal(agentSortMode(bad), 'talked');
});

test('#4428: every timestamp sort is newest first, missing last, then name', () => {
  const { sortAgents } = api();
  const rows = [
    a('Zulu', { lastTalkedAt: null, lastActiveAt: null, createdAt: null }),
    a('Bea', { lastTalkedAt: '2026-09-28T10:00:00Z', lastActiveAt: '2026-09-28T12:00:00Z', createdAt: '2026-09-20T00:00:00Z' }),
    a('Ada', { lastTalkedAt: '2026-09-28T10:00:00Z', lastActiveAt: '2026-09-28T11:00:00Z', createdAt: '2026-09-21T00:00:00Z' }),
  ];
  assert.deepEqual(sortAgents(rows, 'talked', projects).map((x) => x.name), ['Ada', 'Bea', 'Zulu']);
  assert.deepEqual(sortAgents(rows, 'active', projects).map((x) => x.name), ['Bea', 'Ada', 'Zulu']);
  assert.deepEqual(sortAgents(rows, 'newest', projects).map((x) => x.name), ['Ada', 'Bea', 'Zulu']);
});

test('#4428: model order uses exactly the model text displayed on each card', () => {
  const { sortAgents, modelLine } = api();
  const rows = [
    a('Missing', { runner: 'claude', modelName: null }),
    a('Zed', { runner: 'codex', modelName: null }),
    a('Bea', { runner: 'claude', modelName: 'Sonnet', state: 'idle' }),
    a('Ada', { runner: 'claude', modelName: 'Haiku', plannedModelName: 'Opus', state: 'stopped' }),
  ];
  assert.deepEqual(rows.map(modelLine), ['Made before Kosmos recorded this', 'OpenAI Codex', 'Claude Sonnet', 'Claude Opus']);
  assert.deepEqual(sortAgents(rows, 'model', projects).map((x) => x.name), ['Ada', 'Bea', 'Zed', 'Missing']);
});

test('#4428: role and needs order use exactly the values and attention shown on cards', () => {
  const { sortAgents, agentFirstProject, roleLine, agentNeedsAttention } = api();
  const rows = [
    a('Dee', { state: 'idle', role: null }),
    a('Cam', { state: 'working', role: 'Engineer' }),
    a('Bea', { state: 'blocked', role: 'Designer' }),
    a('Ada', { state: 'connection_lost', reconnect: { phase: 'gave_up' }, role: 'writes docs', profile: { role: 'Analyst' } }),
  ];
  assert.equal(roleLine(rows[3], null), 'Analyst');
  assert.equal(agentNeedsAttention(rows[3]), true, 'a gave-up connection carries the Issue marker');
  assert.equal(agentFirstProject(rows[1], projects), 'Alpha');
  assert.equal(agentFirstProject(rows[2], projects), 'Alpha', 'first project means the alphabetically first project, not store order');
  assert.equal(agentFirstProject(rows[0], projects), null);
  assert.deepEqual(sortAgents(rows, 'name', projects).map((x) => x.name), ['Ada', 'Bea', 'Cam', 'Dee']);
  assert.deepEqual(sortAgents(rows, 'needs', projects).map((x) => x.name), ['Ada', 'Bea', 'Cam', 'Dee']);
  assert.deepEqual(sortAgents(rows, 'project', projects).map((x) => x.name), ['Bea', 'Cam', 'Ada', 'Dee']);
  assert.deepEqual(sortAgents(rows, 'role', projects).map((x) => x.name), ['Ada', 'Bea', 'Cam', 'Dee']);
});

test('#4428: Needs you first matches every Issue tile case, not the visual card state', () => {
  const { sortAgents, agentNeedsAttention } = api();
  const rows = [
    a('Zulu', { state: 'idle' }),
    a('Cam', { state: 'blocked' }),
    a('Bea', { state: 'needs_trust', running: false, needsTrust: true }),
    a('Ada', { state: 'needs_you', stateReportedBy: 'agent' }),
    a('Zed', { state: 'connection_lost', reconnect: { phase: 'gave_up' } }),
  ];
  assert.deepEqual(rows.map(agentNeedsAttention), [false, false, true, true, true]);
  assert.deepEqual(sortAgents(rows, 'needs', projects).map((x) => x.name), ['Ada', 'Bea', 'Zed', 'Cam', 'Zulu']);
});

test('#4428: sorting is pure and invalid input remains harmless', () => {
  const { sortAgents } = api();
  const rows = [a('B'), a('A')];
  assert.deepEqual(sortAgents(rows, 'name', projects).map((x) => x.name), ['A', 'B']);
  assert.deepEqual(rows.map((x) => x.name), ['B', 'A']);
  assert.deepEqual(sortAgents(null, 'name', projects), []);
  assert.equal(sortAgents([null, undefined], 'name', projects).length, 2);
});

test('#4428: the persisted control repaints both flat views and hides for the org chart', () => {
  assert.match(SCRIPT, /localStorage\.getItem\('kosmos\.sort\.agents'\)/);
  assert.match(SCRIPT, /localStorage\.setItem\('kosmos\.sort\.agents', AGENT_SORT\)/);
  assert.match(SCRIPT, /const orderedAgents = sortAgents\(shown, AGENT_SORT, PROJECTS\);[\s\S]*orderedAgents\.map\(card\)/);
  assert.match(SCRIPT, /const shown = sortAgents\(lim \? src\.slice\(0, Number\(lim\)\) : src, AGENT_SORT, PROJECTS\);[\s\S]*shown\.map\(lrow\)/);
  assert.match(SCRIPT, /agentSortVisibility\(\)/);
  assert.match(SCRIPT, /BOARD_LAYOUT === 'org'/);
  assert.match(SCRIPT, /mode === 'model'[\s\S]*modelLine\(aa\)/);
  assert.match(SCRIPT, /mode === 'role'[\s\S]*roleLine\(a\.agent \|\| \{\}, ROLE_TITLES\)/);
  assert.match(SCRIPT, /const needsRank = \(a\) => \{\s*if \(agentNeedsAttention\(a\)\) return 0;/);
  assert.ok((SCRIPT.match(/agentNeedsAttention\(a\) \? ' data-attn'/g) || []).length >= 6,
    'grid and list cards no longer share the Issue predicate used by the sort');
});
