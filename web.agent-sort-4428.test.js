'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

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
  const body = lift(['agentSortMode', 'agentFirstProject', 'sortAgents']);
  return new Function(`${constants[0]}\n${body}\nreturn { AGENT_SORTS, AGENT_SORT_DEFAULT, agentSortMode, agentFirstProject, sortAgents };`)();
}

const a = (name, extra) => ({ sessionName: name.toLowerCase(), name, ...(extra || {}) });
const projects = [
  { id: 'z', name: 'Zebra', agents: [{ sessionName: 'bea' }] },
  { id: 'a', name: 'Alpha', agents: [{ sessionName: 'cam' }, { sessionName: 'bea' }] },
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

test('#4428: model groups by provider then model, and incomplete values go last', () => {
  const { sortAgents } = api();
  const rows = [
    a('Missing', { runner: 'claude', modelName: null }),
    a('Zed', { runner: 'codex', modelName: 'GPT-5' }),
    a('Bea', { runner: 'claude', modelName: 'Sonnet' }),
    a('Ada', { runner: 'claude', modelName: 'Opus' }),
  ];
  assert.deepEqual(sortAgents(rows, 'model', projects).map((x) => x.name), ['Ada', 'Bea', 'Zed', 'Missing']);
});

test('#4428: name, needs-you, project and role use one stable missing-last contract', () => {
  const { sortAgents, agentFirstProject } = api();
  const rows = [
    a('Dee', { state: 'idle', role: null }),
    a('Cam', { state: 'working', role: 'Engineer' }),
    a('Bea', { state: 'blocked', role: 'Designer' }),
    a('Ada', { state: 'needs_you', role: 'Engineer' }),
  ];
  assert.equal(agentFirstProject(rows[1], projects), 'Alpha');
  assert.equal(agentFirstProject(rows[2], projects), 'Alpha', 'first project means the alphabetically first project, not store order');
  assert.equal(agentFirstProject(rows[0], projects), null);
  assert.deepEqual(sortAgents(rows, 'name', projects).map((x) => x.name), ['Ada', 'Bea', 'Cam', 'Dee']);
  assert.deepEqual(sortAgents(rows, 'needs', projects).map((x) => x.name), ['Ada', 'Bea', 'Cam', 'Dee']);
  assert.deepEqual(sortAgents(rows, 'project', projects).map((x) => x.name), ['Bea', 'Cam', 'Ada', 'Dee']);
  assert.deepEqual(sortAgents(rows, 'role', projects).map((x) => x.name), ['Bea', 'Ada', 'Cam', 'Dee']);
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
});
