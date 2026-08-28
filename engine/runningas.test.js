'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { runningAs, everyone, claudeUnder } = require('./runningas');

/**
 * #1304. Every reader is injected, so these run without a tmux server, a process
 * tree, or a signed-in account. The acceptance bar Splinter set for this card was
 * that whatever gets built has a control that can return the other value, and a
 * module that can only run against the real machine cannot have one.
 */

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
    panes: PANES(), procs: REAL_SHAPE(),
    envOf: () => 'CLAUDE_CONFIG_DIR=/Users/x/.claude-account-d /Users/x/.local/bin/claude',
    identityOf: () => ({ email: 'josh@book.io', organization: 'Book' }),
  });
  assert.equal(r.ok, true, r.because);
  assert.equal(r.model, 'claude-opus-5', 'it read the bun plugin instead of the claude descendant');
  assert.equal(r.account, 'josh@book.io');
  assert.equal(r.configDir, '/Users/x/.claude-account-d');
});

test('#1304: with no CLAUDE_CONFIG_DIR in the env it falls back to the default dir', () => {
  /* Trap 3: the variable is in the ENVIRONMENT, never the cmdline, so an agent on
     the default account shows nothing here and must not be reported as unknown. */
  const r = runningAs('pigeonpete-discord', {
    panes: PANES(), procs: REAL_SHAPE(),
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
    panes: PANES(), procs: REAL_SHAPE(),
    envOf: () => `CLAUDE_CONFIG_DIR=${dir} claude`,
    identityOf: (d) => ({ email: d.includes('account-d') ? 'josh@book.io' : 'someone@else.com' }),
  });
  assert.notEqual(mk('/Users/x/.claude-account-d').account, mk('/Users/x/.claude').account);
});

test('#1304: an unreadable account is NULL, never a guess', () => {
  const r = runningAs('pigeonpete-discord', {
    panes: PANES(), procs: REAL_SHAPE(), envOf: () => 'claude', identityOf: () => null,
  });
  assert.equal(r.ok, true, 'an unreadable account is not a failure to look');
  assert.equal(r.account, null);
  assert.equal(r.model, 'claude-opus-5', 'the model is knowable even when the account is not');
});

test('#1304: a pane with no claude under it says so, and does not say "no account"', () => {
  /* 🛑 "we could not tell" and "it is running on nothing" are different answers
     and only one of them is ever true. */
  const r = runningAs('pigeonpete-discord', {
    panes: PANES(),
    procs: new Map([[100, { ppid: 1, command: '/bin/zsh' }]]),
    envOf: () => '', identityOf: () => ({ email: 'nobody@example.com' }),
  });
  assert.equal(r.ok, false);
  assert.match(r.because, /nothing that looks like Claude Code/);
  assert.equal(r.account, undefined, 'it invented an account for a pane with no agent in it');
});

test('#1304: an unknown session says so', () => {
  const r = runningAs('not-a-session', { panes: PANES(), procs: REAL_SHAPE(), envOf: () => '' });
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
  assert.equal(claudeUnder(100, procs), null);
});

test('#1304 CONTROL: claudeUnder is not fooled by the word "claude" in an argument', () => {
  /* This module\'s own probe command line contains the word. Matching on the
     executable path is what keeps a `grep claude` pane from reading as an agent. */
  const procs = new Map([
    [100, { ppid: 1, command: '/bin/zsh' }],
    [101, { ppid: 100, command: '/usr/bin/grep -r claude /Users/x' }],
  ]);
  assert.equal(claudeUnder(100, procs), null);
  const withReal = new Map(procs).set(102, { ppid: 100, command: '/Users/x/.local/bin/claude --model m' });
  assert.equal(claudeUnder(100, withReal), 102, 'it cannot find a real claude either: the matcher is dead');
});

test('#1304: everyone() answers for each pane and sorts by name', () => {
  const panes = new Map([['b-discord', 200], ['a-discord', 100]]);
  const procs = new Map([
    [100, { ppid: 1, command: '/Users/x/.local/bin/claude --model claude-opus-5' }],
    [200, { ppid: 1, command: '/bin/zsh' }],
  ]);
  const all = everyone({ panes, procs, envOf: () => '', identityOf: () => ({ email: 'a@b.c' }) });
  assert.deepEqual(all.map((a) => a.session), ['a-discord', 'b-discord']);
  assert.equal(all[0].ok, true);
  assert.equal(all[1].ok, false, 'a pane with no agent was reported as answering');
});
