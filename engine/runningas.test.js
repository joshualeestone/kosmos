'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { runningAs, everyone, agentUnder } = require('./runningas');

/**
 * #1304. Every reader is injected, so these run without a tmux server, a process
 * tree, or a signed-in account. The acceptance bar Splinter set for this card was
 * that whatever gets built has a control that can return the other value, and a
 * module that can only run against the real machine cannot have one.
 */

/* 🪟 #570: THE ARM IS NAMED, not inherited from whatever box runs the suite. These
   are the DARWIN arm's tests -- panes and a process tree -- and `runningAs` now
   picks its arm from `deps.platform || process.platform`. Left implicit they
   would pass on a Mac and silently exercise the win32 reader on Windows, where
   they would fail for a reason that has nothing to do with what they assert.
   Naming it is also what lets the fleet's Macs assert the win32 arm and this
   Windows box assert the darwin one -- the same control-that-can-return-the-other-
   value bar #1304 set for every reader in this module. */
const DARWIN = 'darwin';

/* A pane whose direct child is the bun discord plugin and whose claude process is
   a GRANDCHILD. This is the real shape on this machine and it is trap 1: reading
   the direct child gives "no --model flag" for every agent, uniformly, which
   looks exactly like a finding. */
const REAL_SHAPE = () => new Map([
  [100, { ppid: 1, command: '/bin/zsh -c source /Users/x/.claude/shell-snapshots/snap.sh' }],
  [101, { ppid: 100, command: 'bun run --cwd /Users/x/.claude/plugins/discord start' }],
  [102, { ppid: 101, command: '/Users/x/.local/bin/claude --model claude-opus-5 --channels plugin:discord' }],
]);
const PANES = () => new Map([['pigeonpete-discord', 100]]);

test('#1304: reports the model from the claude process, not the pane child', () => {
  const r = runningAs('pigeonpete-discord', {
    platform: DARWIN, panes: PANES(), procs: REAL_SHAPE(),
    envOf: () => 'CLAUDE_CONFIG_DIR=/Users/x/.claude-account-d /Users/x/.local/bin/claude',
    identityOf: () => ({ email: 'agent@example.com', organization: 'Example' }),
  });
  assert.equal(r.ok, true, r.because);
  assert.equal(r.model, 'claude-opus-5', 'it read the bun plugin instead of the claude descendant');
  assert.equal(r.account, 'agent@example.com');
  assert.equal(r.configDir, '/Users/x/.claude-account-d');
});

test('#1304: with no CLAUDE_CONFIG_DIR in the env it falls back to the default dir', () => {
  /* Trap 3: the variable is in the ENVIRONMENT, never the cmdline, so an agent on
     the default account shows nothing here and must not be reported as unknown. */
  const r = runningAs('pigeonpete-discord', {
    platform: DARWIN, panes: PANES(), procs: REAL_SHAPE(),
    envOf: () => '/Users/x/.local/bin/claude --model claude-opus-5',
    identityOf: (d) => (d.endsWith('.claude') ? { email: 'default@example.com' } : null),
  });
  assert.equal(r.account, 'default@example.com',
    'a default-account agent was reported as having no account');
  assert.match(r.configDir, /\.claude$/);
});

test('#1304 CONTROL: the two accounts come back DIFFERENT, so the reader discriminates', () => {
  /* Without this the assertions above pass against a reader that returns one
     hardcoded answer. */
  const mk = (dir) => runningAs('pigeonpete-discord', {
    platform: DARWIN, panes: PANES(), procs: REAL_SHAPE(),
    envOf: () => `CLAUDE_CONFIG_DIR=${dir} claude`,
    identityOf: (d) => ({ email: d.includes('account-d') ? 'agent@example.com' : 'someone@else.com' }),
  });
  assert.notEqual(mk('/Users/x/.claude-account-d').account, mk('/Users/x/.claude').account);
});

test('#1304: an unreadable account is NULL, never a guess', () => {
  const r = runningAs('pigeonpete-discord', {
    platform: DARWIN, panes: PANES(), procs: REAL_SHAPE(), envOf: () => 'claude', identityOf: () => null,
  });
  assert.equal(r.ok, true, 'an unreadable account is not a failure to look');
  assert.equal(r.account, null);
  assert.equal(r.model, 'claude-opus-5', 'the model is knowable even when the account is not');
});

test('#1304: a pane with no claude under it says so, and does not say "no account"', () => {
  /* 🛑 "we could not tell" and "it is running on nothing" are different answers
     and only one of them is ever true. */
  const r = runningAs('pigeonpete-discord', {
    platform: DARWIN, panes: PANES(),
    procs: new Map([[100, { ppid: 1, command: '/bin/zsh' }]]),
    envOf: () => '', identityOf: () => ({ email: 'nobody@example.com' }),
  });
  assert.equal(r.ok, false);
  /* The FULL sentence, not the prefix. `/nothing that looks like Claude Code/`
     matches the old Claude-only wording and the current one equally, so it could
     not tell them apart; #2811 changed this string and an assertion that survives
     the change it is meant to cover is not covering it. */
  assert.match(r.because, /nothing that looks like Claude Code or Codex is running under/);
  assert.equal(r.account, undefined, 'it invented an account for a pane with no agent in it');
});

test('#1304: an unknown session says so', () => {
  const r = runningAs('not-a-session', { platform: DARWIN, panes: PANES(), procs: REAL_SHAPE(), envOf: () => '' });
  assert.equal(r.ok, false);
  assert.match(r.because, /no pane called not-a-session/);
});

test('#1304: a recycled-pid cycle does not hang the walk', () => {
  /* A pid table read in one shot can contain a process whose parent has exited
     and been recycled. A naive downward walk on that loops forever. */
  const procs = new Map([
    [100, { ppid: 102, command: 'a' }],
    [101, { ppid: 100, command: 'b' }],
    [102, { ppid: 101, command: 'c' }],
  ]);
  assert.equal(agentUnder(100, procs), null);
});

test('#1304 CONTROL: agentUnder is not fooled by the word "claude" in an argument', () => {
  /* This module\'s own probe command line contains the word. Matching on the
     executable path is what keeps a `grep claude` pane from reading as an agent. */
  const procs = new Map([
    [100, { ppid: 1, command: '/bin/zsh' }],
    [101, { ppid: 100, command: '/usr/bin/grep -r claude /Users/x' }],
  ]);
  assert.equal(agentUnder(100, procs), null);
  const withReal = new Map(procs).set(102, { ppid: 100, command: '/Users/x/.local/bin/claude --model m' });
  assert.deepEqual(agentUnder(100, withReal), { pid: 102, runner: 'claude' },
    'it cannot find a real claude either: the matcher is dead');
});

/* ─────────────────────────── #2811 ───────────────────────────
 * A Kosmos OpenAI agent runs the codex binary, and this reader matched only
 * `claude`, so it refused for every codex agent: `kosmos whoami` answered
 * "nothing that looks like Claude Code is running under <name>" about an agent
 * that was plainly running, and could not name its .codex account.
 */
test('#2811: a CODEX process under the pane is found, and named as codex', () => {
  const procs = new Map([
    [100, { ppid: 1, command: '/bin/zsh' }],
    [101, { ppid: 100, command: '/opt/homebrew/bin/codex -m gpt-5.6' }],
  ]);
  assert.deepEqual(agentUnder(100, procs), { pid: 101, runner: 'codex' },
    'a codex agent is still invisible to the identity reader (#2811)');
});

test('#2811 CONTROL: the codex match is on the executable PATH, not the word anywhere', () => {
  /* The same rule the claude arm above is held to. Without this, `grep codex`
     or an argument mentioning codex would read as an agent. */
  const procs = new Map([
    [100, { ppid: 1, command: '/bin/zsh' }],
    [101, { ppid: 100, command: '/usr/bin/grep -r codex /Users/x' }],
  ]);
  assert.equal(agentUnder(100, procs), null, 'the word "codex" in an argument was read as an agent');
});

test('#2811: at the SAME depth, a claude process wins over a codex one', () => {
  /* 🛑 THE CARD'S DEFECT INVERTED, which widening this matcher made possible for
     the first time: while only `claude` matched, two agent-shaped processes in
     one tree could not compete. Whichever the walk reached first would decide,
     and getting it wrong is worse than the bug being fixed -- a Claude agent told
     it is a Codex agent, its account read from CODEX_HOME, its recorded model
     suppressed as foreign. `claude` wins a tie because that is the answer this
     function gave before codex existed. */
  const codexFirst = new Map([
    [100, { ppid: 1, command: '/bin/zsh' }],
    [101, { ppid: 100, command: '/opt/homebrew/bin/codex exec' }],
    [102, { ppid: 100, command: '/usr/bin/claude --model claude-opus-5' }],
  ]);
  assert.deepEqual(agentUnder(100, codexFirst), { pid: 102, runner: 'claude' },
    'a stray codex at the same depth outranked the real claude agent');

  /* CONTROL, and it must pass in BOTH orders or the test is about map order. */
  const claudeFirst = new Map([
    [100, { ppid: 1, command: '/bin/zsh' }],
    [101, { ppid: 100, command: '/usr/bin/claude --model claude-opus-5' }],
    [102, { ppid: 100, command: '/opt/homebrew/bin/codex exec' }],
  ]);
  assert.deepEqual(agentUnder(100, claudeFirst), { pid: 101, runner: 'claude' });
});

test('#2811: DEPTH still decides before the runner preference', () => {
  /* The claude preference is a tie-break, not an override. A codex process
     closer to the pane IS the better candidate for "what this pane is running",
     and that is what makes the node-launcher case below work at all. */
  const procs = new Map([
    [100, { ppid: 1, command: '/bin/zsh' }],
    [101, { ppid: 100, command: '/opt/homebrew/bin/codex' }],
    [102, { ppid: 101, command: '/usr/bin/claude' }],
  ]);
  assert.deepEqual(agentUnder(100, procs), { pid: 101, runner: 'codex' },
    'a deeper claude beat a shallower codex, so depth stopped deciding');
});

test('#2811: a BARE executable name is matched, not only a path', () => {
  /* 🛑 A SURVIVING MUTANT FOUND THIS: removing the `t === name` arm and keeping
     only `t.endsWith('/' + name)` left every test green, because every fixture in
     this file used a full path. The bare arm is not hypothetical: sampled on this
     machine, 3 live processes front as a bare `claude` (against 18 with a full
     path), which is what a PATH-resolved exec looks like in `ps`. */
  const bareClaude = new Map([
    [100, { ppid: 1, command: '/bin/zsh' }],
    [101, { ppid: 100, command: 'claude --model claude-opus-5' }],
  ]);
  assert.deepEqual(agentUnder(100, bareClaude), { pid: 101, runner: 'claude' },
    'a bare `claude` command is not recognised, so a PATH-resolved agent is invisible');

  const bareCodex = new Map([
    [100, { ppid: 1, command: '/bin/zsh' }],
    [101, { ppid: 100, command: 'codex -m gpt-5.6' }],
  ]);
  assert.deepEqual(agentUnder(100, bareCodex), { pid: 101, runner: 'codex' });

  /* CONTROLS: bare matching must stay EXACT, or it becomes the "too loose" rule
     the path arm was written to avoid. */
  const lookalikes = new Map([
    [100, { ppid: 1, command: '/bin/zsh' }],
    [101, { ppid: 100, command: 'claudebot --serve' }],
    [102, { ppid: 100, command: 'codex-helper' }],
    [103, { ppid: 100, command: 'myclaude' }],
  ]);
  assert.equal(agentUnder(100, lookalikes), null,
    'a name merely starting or ending with the runner name was matched');
});

test('#2811: the ANSWER SHAPE is pinned per path, because the docstring claims one', () => {
  /* 🛑 THE DOCSTRING LISTS KEY-SETS PER PATH AND NOTHING CHECKED THEM. It has
     been wrong three times about one field: unconditional (wrong for win32),
     then "darwin arm only" (wrong for darwin's refusals), then right. Each
     correction was narrower than the last and still too wide, because each was
     generalised from the paths I happened to drive.
     ⇒ A field list is a claim, and this file demands elsewhere that a claim be
     "a checked value rather than decoration". These arms make the documented
     matrix fail when it drifts, instead of asking a reader to believe it. */
  const keys = (r) => Object.keys(r).sort().join(',');
  const BASE = 'account,because,configDir,model,ok,organization';

  /* 🛑 THE DOCSTRING IS READ, NOT TRUSTED. Pinning the code against a list
     hardcoded HERE leaves the docstring free to drift, which is not a
     hypothetical: that paragraph silently reverted to an older, wrong version on
     this very branch and nothing went red, because no test was looking at it.
     So the documented matrix is parsed out of the source and compared to what the
     function really returns. If the line is reworded or removed this FAILS rather
     than passing quietly, which is correct: an unreadable contract is not a
     satisfied one. */
  const src = fs.readFileSync(require.resolve('./runningas.js'), 'utf8');
  /* 🛑 ALL THREE ROWS, NOT THE FIRST ONE. An earlier version parsed only
     `darwin ok:true` while its comment claimed it guarded the matrix, so two
     mutants rewriting the OTHER rows to assert the exact opposite ("runner is
     null", "also carries runner") passed. Worse, the revert this guard exists to
     catch was in those two rows: it was aimed at the only line that had never
     been wrong. */
  const row = (label) => {
    const m = src.match(new RegExp(label + '\\s+->\\s+([^\\n]+)'));
    assert.ok(m, 'the docstring no longer states a `' + label + '` row, so nothing documents that path');
    return m[1].trim();
  };
  assert.equal(row('darwin ok:true'), BASE + ',runner',
    'the docstring and this test disagree about the darwin success shape');
  assert.equal(row('darwin ok:false'), 'no `runner` key',
    'the docstring no longer says a darwin REFUSAL omits `runner`, which the arms below assert');
  assert.equal(row('win32  every path'), 'no `runner` key',
    'the docstring no longer says the win32 arm omits `runner` on every path');

  /* 🛑 EVERY RETURN PATH, NOT THE ONES I HAPPENED TO DRIVE. An earlier version of
     this test pinned TWO of the nine and its commit claimed the whole matrix was
     covered; five mutants adding a `runner` key to an unasserted refusal survived
     it. That is the same generalise-from-driven-paths failure the docstring made
     three times, reproduced inside the test written to stop it.
     ⇒ This table is the FULL set of returns in `runningAsDarwin`,
     `runningAsWin32` and `win32Answer`. A new return with no row here is the
     thing to notice. */
  const REFUSAL = 'because,ok';
  const W32 = (live, cmdlines) => ({ platform: 'win32', live, cmdlines });
  const paths = [
    ['darwin ok:true codex', BASE + ',runner', { platform: 'darwin',
      panes: new Map([['s', 100]]),
      procs: new Map([[100, { ppid: 1, command: '/bin/zsh' }], [101, { ppid: 100, command: '/opt/homebrew/bin/codex' }]]),
      envOf: () => 'CODEX_HOME=/Users/x/.codex', identityOf: () => ({ email: 'a@b.c' }) }],
    ['darwin ok:true claude', BASE + ',runner', { platform: 'darwin',
      panes: new Map([['s', 100]]),
      procs: new Map([[100, { ppid: 1, command: '/bin/zsh' }], [101, { ppid: 100, command: '/usr/bin/claude' }]]),
      envOf: () => '', identityOf: () => ({ email: 'a@b.c' }) }],
    ['darwin refuse: no pane', REFUSAL, { platform: 'darwin', panes: new Map(), procs: new Map() }],
    ['darwin refuse: nothing under it', REFUSAL, { platform: 'darwin',
      panes: new Map([['s', 100]]), procs: new Map([[100, { ppid: 1, command: '/bin/zsh' }]]) }],
    ['win32 ok:true', BASE, W32(() => new Map([['s', { name: 's', pid: 4242 }]]), () => new Map([[4242, 'claude --model m']]))],
    ['win32 refuse: live() null', REFUSAL, W32(() => null, () => new Map())],
    ['win32 refuse: unowned session', REFUSAL, W32(() => new Map(), () => new Map())],
    ['win32 refuse: entry has no pid', REFUSAL, W32(() => new Map([['s', { name: 's', pid: null }]]), () => new Map())],
    ['win32 refuse: no process table', REFUSAL, W32(() => new Map([['s', { name: 's', pid: 4242 }]]), () => null)],
    ['win32 refuse: pid gone', REFUSAL, W32(() => new Map([['s', { name: 's', pid: 4242 }]]), () => new Map())],
  ];

  for (const [name, want, deps] of paths) {
    const r = runningAs('s', deps);
    /* `Object.keys` lists an own key whose value is null or undefined, so this one
       assertion already catches a `runner: null` sneaking onto a refusal. An
       earlier version added a `hasOwnProperty` arm below it that could never fail
       (the keys check reds first), and whose message implied the opposite, that
       the keys check was null-blind. A vacuous assertion that teaches a future
       reader something false is worse than no assertion. */
    assert.equal(keys(r), want,
      name + ': the answer shape drifted from the documented one (a `runner: null` counts as a key here)');
  }

  /* A CONTROL ON THE TABLE ITSELF: the three shapes must actually differ, or every
     row could be satisfied by one answer and the table would prove nothing. */
  assert.notEqual(BASE + ',runner', BASE);
  assert.notEqual(REFUSAL, BASE);
});

/* ───────────────── #2811, the node-fronting launcher ─────────────────
 * MEASURED, and recorded here because the WRONG conclusion is the intuitive one
 * and I drew it first. `/opt/homebrew/bin/codex` (the npm/homebrew launcher that
 * `runners.js` still supports) is a `#!/usr/bin/env node` script, so `ps` shows
 * `node /opt/homebrew/bin/codex` and its first token is the INTERPRETER, while
 * `claude` on a native install is a Mach-O binary. That asymmetry looks exactly
 * like a hole in a first-token matcher, and it is not one: the launcher SPAWNS
 * the native binary as a child. Sampled during a real run:
 *     node /opt/homebrew/bin/codex --help                    <- launcher
 *     .../vendor/aarch64-apple-darwin/bin/codex --help       <- the agent
 * This walk is a BREADTH walk over the whole subtree, so the plain rule reaches
 * the child. Teaching the matcher to hop from an interpreter to its script
 * argument would buy nothing and would let an unrelated node process in.
 */
test('#2811: a node-FRONTED codex is found at its native child, with no interpreter rule', () => {
  const procs = new Map([
    [100, { ppid: 1, command: '/bin/zsh' }],
    [101, { ppid: 100, command: 'node /opt/homebrew/bin/codex -m gpt-5.6' }],
    [102, { ppid: 101, command: '/opt/homebrew/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex -m gpt-5.6' }],
  ]);
  assert.deepEqual(agentUnder(100, procs), { pid: 102, runner: 'codex' },
    'the walk stopped at the node launcher instead of reaching the agent it spawned');
});

test('#2811 CONTROL: a bare node process is never an agent', () => {
  /* 🛑 THE ARM THAT KEEPS THE TEST ABOVE FROM BEING PASSED BY A LOOSER RULE.
     Accepting `node` (or its script argument) would satisfy the launcher case
     too, and would also claim every dev server, REPL and build watcher.
     `isFleetSession` refuses a bare `node` for this reason, and the fleet's
     canonical classifier accepts one only as a stated tradeoff. Here there is no
     tradeoff to make: the agent process is in the tree on its own. */
  const procs = new Map([
    [100, { ppid: 1, command: '/bin/zsh' }],
    [101, { ppid: 100, command: 'node /Users/x/proj/node_modules/.bin/webpack --watch' }],
    [102, { ppid: 100, command: 'node' }],
    [103, { ppid: 100, command: 'node /opt/homebrew/bin/codex' }],
  ]);
  assert.equal(agentUnder(100, procs), null,
    'a node process was claimed as an agent: the launcher, a watcher and a bare REPL are indistinguishable here');
});

test('#2811 CONTROL: a first token that merely CONTAINS "codex" is not an agent', () => {
  /* 🛑 THE ARGUMENT CONTROL ABOVE DOES NOT COVER THIS, and a mutation proved it:
     loosening the match to `first.includes('codex')` left the whole file GREEN,
     because that control's first token is `/usr/bin/grep` and the word sits in the
     ARGUMENTS. To catch a loose FIRST-TOKEN match the token itself has to be the
     near miss. */
  const procs = new Map([
    [100, { ppid: 1, command: '/bin/zsh' }],
    [101, { ppid: 100, command: '/usr/local/bin/codex-helper --watch' }],
    [102, { ppid: 100, command: '/opt/codextools/bin/run' }],
  ]);
  assert.equal(agentUnder(100, procs), null,
    'a binary whose name merely contains "codex" was read as a codex agent');
});

test('#2811: a codex agent with NO CODEX_HOME falls back to ~/.codex, never ~/.claude', () => {
  /* Also found by mutation: the arm below always supplies CODEX_HOME, so the
     fallback was never exercised and pointing it at ~/.claude stayed green.
     Reporting a codex agent as living in a Claude directory is the exact
     misattribution this card is about. */
  const panes = new Map([['subzero-discord', 100]]);
  const procs = new Map([
    [100, { ppid: 1, command: '/bin/zsh' }],
    [101, { ppid: 100, command: '/opt/homebrew/bin/codex' }],
  ]);
  const r = runningAs('subzero-discord', {
    panes, procs, envOf: () => '', identityOf: () => null,
  });
  assert.equal(r.runner, 'codex');
  assert.match(r.configDir, /\.codex$/,
    'a codex agent with no CODEX_HOME was reported as living in ' + r.configDir);
});

test('#2811: runningAs reports a codex agent with its CODEX_HOME, not a synthesised ~/.claude', () => {
  const panes = new Map([['subzero-discord', 100]]);
  const procs = new Map([
    [100, { ppid: 1, command: '/bin/zsh' }],
    [101, { ppid: 100, command: '/opt/homebrew/bin/codex -m gpt-5.6' }],
  ]);
  const r = runningAs('subzero-discord', {
    panes, procs,
    envOf: () => 'CODEX_HOME=/Users/agent1/.codex-work2\n',
    identityOf: () => { throw new Error('identityOf must NOT be asked about a codex dir'); },
  });
  assert.equal(r.ok, true, 'still refusing for a codex agent: ' + r.because);
  assert.equal(r.runner, 'codex');
  assert.equal(r.configDir, '/Users/agent1/.codex-work2',
    'the codex account dir is still not identified, which is half of #2811');
  assert.equal(r.model, 'gpt-5.6',
    'the model was not read off the codex command line, which writes `-m`, not `--model`');
  assert.equal(r.account, null, 'a codex account email must not be guessed here (kosmos#2790 owns it)');
});

test('#2811: the codex answer SAYS which half of the question it did not answer', () => {
  /* Nothing renders `because` on a successful read today, which is exactly why
     it is asserted: an unchecked string is decoration, and the codebase bans a
     comment that describes behaviour the code cannot produce. This makes the
     sentence a contract. It must name the account as unread WITHOUT reciting a
     stale one, which is the finding the whole card rests on. */
  const panes = new Map([['subzero-discord', 100]]);
  const procs = new Map([
    [100, { ppid: 1, command: '/bin/zsh' }],
    [101, { ppid: 100, command: '/opt/homebrew/bin/codex' }],
  ]);
  const out = runningAs('subzero-discord', {
    panes, procs,
    envOf: () => 'CODEX_HOME=/Users/agent1/.codex\n',
    identityOf: () => { throw new Error('identityOf must NOT be asked about a codex dir'); },
  });
  assert.equal(out.ok, true, 'refused: ' + out.because);
  assert.equal(out.runner, 'codex');
  assert.match(String(out.because), /not read here/,
    'a codex answer no longer says its account was not read, so a caller may invent one');
  assert.equal(out.account, null, 'an account was recited for a codex agent');
});

test('#2811: the model is read in BOTH spellings, because the product writes both', () => {
  /* 🛑 THE FIXTURE THAT WAS WRONG, KEPT AS A NAMED ARM SO IT CANNOT GO BACK.
     `bin/agent-supervisor.sh` launches codex with `-m` and claude with `--model`;
     `engine/win32launch.js` pushes `--model` for both. Every codex arm here once
     used `--model`, a shape the DARWIN product never writes, so it asserted an
     impossible input and a `--model`-only reader looked correct. */
  const read = (cmd) => runningAs('s', {
    panes: new Map([['s', 100]]),
    procs: new Map([
      [100, { ppid: 1, command: '/bin/zsh' }],
      [101, { ppid: 100, command: cmd }],
    ]),
    envOf: () => 'CODEX_HOME=/Users/x/.codex\n',
    identityOf: () => { throw new Error('identityOf must NOT be asked about a codex dir'); },
  }).model;

  assert.equal(read('/opt/homebrew/bin/codex -m gpt-5.6'), 'gpt-5.6',
    'the darwin codex spelling `-m` is unreadable, so a Codex model can never be reported');
  assert.equal(read('/opt/homebrew/bin/codex --model gpt-5.6'), 'gpt-5.6',
    'the win32 spelling `--model` stopped working on a codex command line');

  /* CONTROLS: the token has to stand alone. Neither of these names a model. */
  assert.equal(read('/opt/homebrew/bin/codex --resume /tmp/-m gpt-5.6'), null,
    'a `-m` embedded in a PATH was read as the model flag: the start-or-space anchor is gone');
  assert.equal(read('/opt/homebrew/bin/codex --harmless'), null,
    'a command line with no model flag produced a model');
  assert.equal(read('/opt/homebrew/bin/codex --stream-mode fast'), null,
    'a flag merely ENDING in -m was read as the model flag');
});

test('#2811: a longer AGENT_WORKFORCE_ twin does not win the config-dir read', () => {
  /* Both `AGENT_WORKFORCE_CODEX_HOME` and `AGENT_WORKFORCE_CLAUDE_CONFIG_DIR`
     are real names in this repo and are set by its own test sandboxes. An
     unanchored match takes whichever comes FIRST in the environment block, which
     is insertion order, so the bug is not even reliably reproducible. Both arms
     are asserted because both had the hole. */
  const read = (cmd, env) => runningAs('s', {
    panes: new Map([['s', 100]]),
    procs: new Map([
      [100, { ppid: 1, command: '/bin/zsh' }],
      [101, { ppid: 100, command: cmd }],
    ]),
    envOf: () => env,
    identityOf: () => ({ email: 'a@b.c', organization: 'O' }),
  }).configDir;

  assert.equal(
    read('/opt/homebrew/bin/codex', 'AGENT_WORKFORCE_CODEX_HOME=/tmp/sandbox CODEX_HOME=/Users/a/.codex-work2'),
    '/Users/a/.codex-work2',
    'the AGENT_WORKFORCE_ twin was read as CODEX_HOME');

  assert.equal(
    read('/usr/bin/claude', 'AGENT_WORKFORCE_CLAUDE_CONFIG_DIR=/tmp/sandbox CLAUDE_CONFIG_DIR=/Users/a/.claude-b'),
    '/Users/a/.claude-b',
    'the AGENT_WORKFORCE_ twin was read as CLAUDE_CONFIG_DIR');

  /* CONTROL: the real variable is still found when it is FIRST, so the anchor
     did not simply break the read. */
  assert.equal(
    read('/opt/homebrew/bin/codex', 'CODEX_HOME=/Users/a/.codex-first AGENT_WORKFORCE_CODEX_HOME=/tmp/sandbox'),
    '/Users/a/.codex-first');
});

test('#2811 CONTROL: a CLAUDE agent is unchanged, and still reads CLAUDE_CONFIG_DIR', () => {
  /* Without this, "make it work for codex" could quietly break the path that
     already worked, and every assertion above would still pass. */
  const panes = new Map([['angel-discord', 100]]);
  const procs = new Map([
    [100, { ppid: 1, command: '/bin/zsh' }],
    [101, { ppid: 100, command: '/Users/x/.local/bin/claude --model claude-opus-5' }],
  ]);
  const r = runningAs('angel-discord', {
    panes, procs,
    envOf: () => 'CLAUDE_CONFIG_DIR=/Users/agent1/.claude-account-c\n',
    identityOf: (dir) => ({ email: 'joshua@stonesyndicate.com', organization: 'Stone Syndicate', dir }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.runner, 'claude');
  assert.equal(r.configDir, '/Users/agent1/.claude-account-c');
  assert.equal(r.account, 'joshua@stonesyndicate.com', 'the claude account read regressed');
  assert.equal(r.model, 'claude-opus-5');
});

test('#2811: the refusal no longer says only "Claude Code" when nothing is running', () => {
  const panes = new Map([['empty-discord', 100]]);
  const procs = new Map([[100, { ppid: 1, command: '/bin/zsh' }]]);
  const r = runningAs('empty-discord', { panes, procs, envOf: () => '', identityOf: () => null });
  assert.equal(r.ok, false);
  assert.match(r.because, /Claude Code or Codex/,
    'the refusal still names only Claude, which is the sentence that lied about a running codex agent');
});

test('#1304: everyone() answers for each pane and sorts by name', () => {
  const panes = new Map([['b-discord', 200], ['a-discord', 100]]);
  const procs = new Map([
    [100, { ppid: 1, command: '/Users/x/.local/bin/claude --model claude-opus-5' }],
    [200, { ppid: 1, command: '/bin/zsh' }],
  ]);
  const all = everyone({ platform: DARWIN, panes, procs, envOf: () => '', identityOf: () => ({ email: 'a@b.c' }) });
  assert.deepEqual(all.map((a) => a.session), ['a-discord', 'b-discord']);
  assert.equal(all[0].ok, true);
  assert.equal(all[1].ok, false, 'a pane with no agent was reported as answering');
});
