'use strict';
const test = require('node:test');
const assert = require('node:assert');
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
  assert.match(r.because, /nothing that looks like Claude Code/);
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
    [101, { ppid: 100, command: '/opt/homebrew/bin/codex --model gpt-5.6' }],
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
    [101, { ppid: 100, command: '/opt/homebrew/bin/codex --model gpt-5.6' }],
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
  assert.equal(r.model, 'gpt-5.6', 'the model came from the codex command line');
  assert.equal(r.account, null, 'a codex account email must not be guessed here (kosmos#2790 owns it)');
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
