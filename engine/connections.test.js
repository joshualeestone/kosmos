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
   * ⚠️ Pinned by property WHERE IT CAN BE. Two arms below pin literal wording
   * (the three-state sentence and the withholding sentence) because those two
   * sentences ARE the decision, not a way of expressing it. The claim used to be
   * a flat "not by wording", which was stronger than what the assertions do. What must survive any rewrite is: it names the verb, it
   * refuses the two-state reading, and it refuses to hand over the credential.
   */
  const body = connections.blockBody();

  // 1. It names the verb, using THIS machine's path rather than the bare command
  //    the file's own opening comment calls a measured lie on a stock install.
  assert.match(body, /connections`/, 'the block stopped naming the connections verb');
  /* 🛑 THIS ARM USED TO READ doesNotMatch(body, /try `kosmos connections`/) AND
     IT COULD NOT FAIL. Measured: `blockBody()` contains the string "try " ZERO
     times (control: "run" appears 4 times), so it pinned a state the block
     cannot reach, and the bare-command hazard it named would have passed
     straight through it. A guard aimed at a phrase nobody emits is decoration.

     What is actually true and worth pinning is a CONSISTENCY property that
     holds on every machine: `clipath` returns either a path or the bare
     fallback, and the follow-up sentence must describe whichever one was
     resolved. A block that teaches a bare command while saying "if that path
     is not there" is talking about a path it never gave. */
  const teachesAPath = /`[^`]*\/[^`]*connections`/.test(body);
  if (teachesAPath) {
    assert.match(body, /that path is not there/,
      'the block teaches a PATH but its follow-up does not describe one');
  } else {
    assert.doesNotMatch(body, /that path is not there/,
      'the block teaches the bare command but says "that path", describing a path it never gave');
        /* 🛑 THIS ASSERTED A SENTENCE THE CODE NO LONGER EMITS, AND ITS SIBLING AT
       THE BOTTOM OF THIS FILE ASSERTS THE OPPOSITE. I corrected the cause-claim
       in one test and did not sweep to this one, so the file held two guards
       giving opposite answers about one string. It stayed green only because a
       source checkout always resolves a path, so this branch never ran: the
       exact unreachable-arm problem the cliAdvice seam exists to solve, in the
       test that did not get the seam.
       ⇒ Driven through cliAdvice so BOTH arms actually execute here too. */
    assert.doesNotMatch(connections.cliAdvice('kosmos').join(' '), /could not work out where/,
      'the bare arm asserts a cause it cannot know');
    assert.match(connections.cliAdvice('kosmos').join(' '), /may not be on your path/,
      'the bare arm dropped the remedy');  }

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

test('#1034: BOTH advice arms render, including the one no machine here can reach', () => {
  /**
   * 🛑 THE BARE-FALLBACK ARM IS UNREACHABLE IN EVERY ENVIRONMENT THIS SUITE RUNS
   * IN. `kosmosCliShown()` returns a path on a source checkout and in a bundle,
   * so the non-path prose never rendered under test and a typo in it would have
   * shipped unseen. That is why `cliAdvice` is a pure function of the resolved
   * string: it is the seam that makes the unreachable arm reachable.
   *
   * `blockBody` deliberately keeps no argument (asserted below), so the seam
   * could not go there.
   */
  const asPath = connections.cliAdvice('/opt/kosmos/bin/kosmos').join('\n');
  const asBare = connections.cliAdvice('kosmos').join('\n');

  // Each arm says the thing only it can say...
  assert.match(asPath, /that path is not there/,
    'the path arm stopped describing a path');
  assert.doesNotMatch(asBare, /that path is not there/,
    'the bare arm describes a path it never gave');
  /* 🛑 THIS ARM USED TO REQUIRE THE BARE COPY TO SAY "could not work out where
     its own command lives", AND THAT CLAIM IS FALSE IN ONE OF THE TWO CASES IT
     COVERS. clipath returns the bare word either because both probes failed OR
     because it resolved a path and DECLINED to print it (a path carrying
     ["$`\!] or a newline). In the second, it worked the location out and
     refused. So the test was pinning a wrong sentence into place, and the copy
     fix had to break it to land. The invariant is the opposite: give the
     REMEDY, assert no CAUSE. */
  assert.doesNotMatch(asBare, /could not work out where/,
    'the bare arm asserts a cause it cannot know: clipath also returns the bare '
    + 'word for a path it resolved and refused to print');
  assert.match(asBare, /may not be on your path/,
    'the bare arm dropped the remedy, which is the half that is true either way');

  // ...and BOTH cover the two failure modes that are not about the path at all,
  // because an agent hitting either got a non-zero exit and no next step.
  for (const [name, text] of [['path', asPath], ['bare', asBare]]) {
    assert.match(text, /not running/, `${name} arm: no advice for a board that is not running`);
    assert.match(text, /list of commands/, `${name} arm: no advice for an older installed copy`);
    assert.match(text, /open Kosmos/, `${name} arm: no next step at all`);
  }

  // CONTROL: the two arms must actually DIFFER, or this test would pass with the
  // chooser hard-wired to one branch, which is the defect it exists to prevent.
  assert.notEqual(asPath, asBare,
    'control: both arms rendered identically, so the chooser is not choosing');
});

test('#1034: the paragraph ORDER is the invariant, and nothing guarded it', () => {
  /**
   * 🛑 A RECORDED DEFECT WITH NO GUARD IS A DEFECT WITH A NOTE ATTACHED. The
   * comment in engine/connections.js records that the troubleshooting must come
   * AFTER the description, not between the command and it, because splicing it
   * in the middle left "It tells you which providers are connected" with Kosmos
   * as its nearest antecedent. The suite asserted the three sentences were
   * PRESENT and never that they were in that order, so a future re-splice
   * reproduces the exact defect silently.
   *
   * ⚠️ Order, not wording: each anchor is the shortest stable phrase in its
   * paragraph, so a rewrite of the prose does not go red for nothing.
   */
  const body = connections.blockBody();
  const cmd = body.indexOf('connections`');
  const what = body.indexOf('It tells you which providers are');
  /* ⚠️ ANCHORED ON A PHRASE BOTH ARMS SHARE. 'If that path is not there' exists
     only in the PATH arm, so on a machine where clipath returns the bare word
     this test went red reporting a MISSING paragraph while the paragraph was
     present and merely worded for the other arm. The order property is
     arm-independent; the anchor was not. */
  const trouble = body.indexOf('list of commands');
  const withheld = body.indexOf('deliberately does NOT show you');

  for (const [name, at] of [['command', cmd], ['description', what], ['troubleshooting', trouble], ['withholding', withheld]]) {
    assert.notEqual(at, -1, `control: the ${name} paragraph is not in the block at all`);
  }

  assert.ok(cmd < what,
    'the description no longer follows the command it describes');
  assert.ok(what < trouble,
    'the troubleshooting is spliced between the command and its description again, '
    + 'which is the recorded antecedent defect');
  assert.ok(trouble < withheld,
    'the withholding paragraph moved above the troubleshooting');
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
  /* ⚠️ An EMAIL SHAPE, not a bare `@`. The block now embeds a machine-derived
     install path, and `kosmosCliShown` does not strip `@` (it is outside the
     path allowlist, so such a path is merely quoted). A bare /@/ would fail on
     any machine whose install path contains one, with a message accusing the
     block of leaking an email, which is the worst kind of red: loud, wrong, and
     pointing at the wrong file. */
  assert.doesNotMatch(body, /[\w.+-]+@[\w-]+\.[\w.]+/,
    'an email address reached a block that must carry no credential');
  /* ⚠️ WORD-BOUNDARY ANCHORED. `/sk-/i` unanchored matches "ask-", and this block
     contains "ask" TWELVE times: measured, /sk-|key tail/i against the body plus
     the string " ask-first" returns TRUE. One rephrase to "ask-first" or
     "task-based" and the guard goes red accusing the block of leaking an API key.
     That is the same trap the comment above says it removed for the phrase
     "is connected on this", reintroduced two lines below it. */
  assert.doesNotMatch(body, /\bsk-[A-Za-z0-9]/i, 'an API key reached the block');
  assert.doesNotMatch(body, /key tail/i, 'a key tail reached the block');
  /* CONTROL: the key pattern must still catch a real one, or narrowing it has
     quietly disarmed it. */
  assert.match('sk-proj-ABC123', /\bsk-[A-Za-z0-9]/i,
    'control: the narrowed key pattern no longer matches a real key');
  assert.doesNotMatch('ask-first, then task-based', /\bsk-[A-Za-z0-9]/i,
    'control: the narrowed pattern still fires on ordinary prose');
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
