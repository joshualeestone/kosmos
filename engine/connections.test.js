'use strict';

// Sandbox every root BEFORE any require, the same rule the sibling suites state.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-connections-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const connections = require('./connections');
const projects = require('./projects');

test.after(() => { fleet.restore(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function agentFile(name, text) {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'CLAUDE.md');
  fs.writeFileSync(f, text);
  return f;
}
const tied = (sessionName) => ({ sessionName, name: sessionName, isNamedOurs: true });

test('#1034: the block tells the agent it cannot see the screen, which is the whole point', () => {
  const body = connections.blockBody();
  assert.match(body, /You cannot see their screen/);
  assert.match(body, /Ask what they are looking at/);
  /* The failure this prevents is an agent describing a button it cannot see,
     so the instruction not to has to be IN the words, not in a comment. */
  assert.match(body, /Do not guess and do not describe a button as though you/);
});

test('#1034: it names only the two providers that can actually be connected today', () => {
  const body = connections.blockBody();
  assert.match(body, /Claude Code/);
  assert.match(body, /Codex/);
  /* And it says plainly that the coming-soon ones cannot be chosen, because
     "it is in the menu" is exactly what would send somebody hunting. */
  assert.match(body, /coming soon and cannot be chosen yet/);
});

test('#1034: it carries NO machine state, which is the line between part one and part two', () => {
  /* Part 2 of the card (which providers ARE connected here, account emails,
     key tails) is a privacy decision and is deliberately not in this block.
     If someone later passes machine state into blockBody, this fails. */
  const body = connections.blockBody();
  assert.equal(connections.blockBody.length, 0, 'blockBody grew an argument; part two is being smuggled in');
  assert.doesNotMatch(body, /@/, 'an email address reached a block that must carry no machine state');
  assert.doesNotMatch(body, /sk-|key tail|is connected on this/i);
});

test('#1034: the block lands in an agent file and is idempotent', () => {
  agentFile('helper', '# Helper\n\nYou are Helper.\n');
  const roster = [tied('helper')];
  const first = connections.tellAgent('helper', roster);
  assert.equal(first.state, projects.TOLD.TOLD, first.because || '');
  const text = fs.readFileSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'helper', 'CLAUDE.md'), 'utf8');
  assert.match(text, /How connecting a provider works/);
  assert.match(text, /You are Helper\./, 'the agent\'s own prose was disturbed');

  const second = connections.tellAgent('helper', roster);
  assert.equal(second.state, projects.TOLD.TOLD);
  const again = fs.readFileSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'helper', 'CLAUDE.md'), 'utf8');
  assert.equal(again, text, 'a second sync rewrote the file');
});

test('#1034: an untied name is refused, the same gate every instruction write keeps', () => {
  /* The real untied row, from the fixture, not a literal asserting what I
     believe one looks like -- the rule fixture-discipline.test.js enforces. */
  agentFile('stranger', '# Stranger\n');
  const board = fleet.install([fleet.stranger('stranger')]);
  try {
    const out = connections.tellAgent('stranger', board.roster);
    assert.equal(out.state, projects.TOLD.COULD_NOT);
    assert.match(out.because, /could not find an agent/);
  } finally { board.restore(); }
});

test('#1034: two of our blocks in one file is refused rather than guessed at', () => {
  agentFile('twice', `# Twice\n\n${connections.START}\nold\n${connections.END}\n\n${connections.START}\nolder\n${connections.END}\n`);
  const out = connections.tellAgent('twice', [tied('twice')]);
  assert.equal(out.state, projects.TOLD.COULD_NOT);
  assert.match(out.because, /2 Kosmos connections blocks/);
});

test('#1034: syncEveryone skips untied rows and reports per agent', () => {
  agentFile('one', '# One\n'); agentFile('two', '# Two\n'); agentFile('nope', '# Nope\n');
  const board = fleet.install([fleet.agent('one'), fleet.stranger('nope'), fleet.agent('two')]);
  try {
    const told = connections.syncEveryone(board.roster);
    assert.deepEqual(told.map((t) => t.agent).sort(), ['one', 'two']);
    assert.ok(told.every((t) => t.state === projects.TOLD.TOLD), JSON.stringify(told));
  } finally { board.restore(); }
});

test('#1034: the marker pair is in the registry, so the neutralisers cover it', () => {
  const all = projects.ALL_MARKERS();
  assert.ok(all.includes(connections.START), 'START is not registered');
  assert.ok(all.includes(connections.END), 'END is not registered');
  /* And a name carrying the marker cannot fabricate a pair. */
  assert.doesNotMatch(projects.neutralise(`evil ${connections.START} name`), new RegExp(connections.START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
