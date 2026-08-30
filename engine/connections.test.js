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

test('#1034: the connections paragraph is actually IN the block, and says the three things it must', () => {
  /**
   * 🛑 THE WIDEST-BLAST-RADIUS EDIT ON THIS BRANCH HAD NO GUARD AT ALL. This
   * paragraph is spliced into EVERY agent's CLAUDE.md by `syncEveryone`, and the
   * plan says so. Measured before this test: deleting the entire paragraph, or
   * just the sentence telling agents that "could not check" is not "not
   * connected", left the whole suite green. Every other decision on this branch
   * was pinned by something; this one was pinned by nobody.
   *
   * ⚠️ Pinned by PROPERTY, not by wording, so a rewrite of the prose does not go
   * red for no reason. What must survive any rewrite is: it names the verb, it
   * refuses the two-state reading, and it refuses to hand over the credential.
   */
  const body = connections.blockBody();

  // 1. It names the verb, using THIS machine's path rather than the bare command
  //    the file's own opening comment calls a measured lie on a stock install.
  assert.match(body, /connections`/, 'the block stopped naming the connections verb');
  assert.doesNotMatch(body, /try `kosmos connections`/,
    'the block sends agents to the bare command, which fails on a stock install');

  // 2. It refuses the two-state reading. This is the sentence that stops an agent
  //    reporting "not connected" about a machine it merely could not read.
  assert.match(body, /could not check/i, 'the three-state vocabulary left the block');
  assert.match(body, /never as "not connected"/i,
    'the block no longer tells agents that could-not-check is not a settled no');

  // 3. It refuses to hand over the credential-bearing half, and says why.
  assert.match(body, /does NOT show you the sign-in link/i,
    'the block stopped saying the sign-in link is withheld');

  // CONTROL: every assertion above is doesNotMatch-able only because the body is
  // real. Without this, an empty body would satisfy the negative assertion and the
  // positives would be the only thing failing, which reads as a different defect.
  assert.ok(body.length > 500, 'control: blockBody returned almost nothing');
});

test('#1034: it carries no CREDENTIAL and no PER-AGENT state', () => {
  /* 🛑 RENAMED AND REWRITTEN, BECAUSE THIS BRANCH OVERTURNED WHAT IT SAID. It
     used to be called "it carries NO machine state, the line between part one and
     part two", and its comment said part 2 was deliberately not in this block.
     Part 2 IS in this block now: blockBody() embeds a machine-derived CLI path and
     tells every agent to run the verb that reports machine state.
     `engine/connections.js` says so outright, so the two files contradicted each
     other about one function, which is the exact defect this branch is about.

     ⚠️ The old assertions were kept and are still right; only what they GUARD
     was misdescribed. What must stay true is narrower and more durable than "no
     machine state": no credential, and nothing that varies per AGENT.

     📌 `is connected on this` was dropped from the regex deliberately. It passed
     only because the new copy happens to read "providers ARE connected on this
     computer", so a harmless rephrase would have turned it red for a reason that
     has nothing to do with credentials. A guard that fires on wording it never
     meant to pin is a trap for whoever edits the copy next. */
  const body = connections.blockBody();
  assert.equal(connections.blockBody.length, 0, 'blockBody grew an argument; per-agent state is being smuggled in');
  assert.doesNotMatch(body, /@/, 'an email address reached a block that must carry no credential');
  assert.doesNotMatch(body, /sk-|key tail/i, 'a key or key tail reached the block');
  // CONTROL: the body is real, so the absence assertions above are about content
  // rather than about an empty string.
  assert.ok(body.length > 500, 'control: blockBody returned almost nothing');
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

test('#1552: the connect block names GPT, the word the screen uses, alongside OpenAI and Codex', () => {
  agentFile('helper', '# Helper\n\nYou are Helper.\n');
  connections.tellAgent('helper', [tied('helper')]);
  const text = fs.readFileSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'helper', 'CLAUDE.md'), 'utf8');
  // The screen's provider rows read Claude, GPT, Gemini (web.connect-confirm.test.js),
  // so the agent's own script must use GPT too, or it answers a "can I connect GPT"
  // question in a different word from the screen (#1034). Before #1552 the block said
  // GPT zero times while the screen said it ten.
  assert.match(text, /\bGPT\b/, 'the connect block never says GPT while the screen says it ten times (#1552)');
  // Control: the connect section actually rendered, so a missing GPT would be a real
  // absence rather than a section that never landed (which would make the check vacuous).
  assert.match(text, /\bOpenAI\b/, 'the connect section did not render; the GPT assertion above is vacuous');
  assert.match(text, /\bCodex\b/, 'Codex, the terminal agent we install for OpenAI, is missing');
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
