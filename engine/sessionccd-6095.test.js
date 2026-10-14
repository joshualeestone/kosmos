'use strict';
// #6095: sessionClaudeDirs reads the Claude config folder each tmux session is pinned to, in one tmux call.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { sessionClaudeDirs, ccdFromEnvLines, MARK } = require('./sessionccd');

/* A fake tmux: `sessions` maps a live session to its environment lines. It answers list-sessions, and a `;` sequence
   the way tmux does, stopping at the first failing command. */
function fakeRun(sessions, { failList = false, failSeq = false } = {}) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    if (args[0] === 'list-sessions') {
      return failList ? { ran: false, status: null, out: '' } : { ran: true, status: 0, out: Object.keys(sessions).join('\n') + '\n' };
    }
    if (failSeq) return { ran: true, status: 1, out: '' };
    let out = '';
    const cmds = [];
    let cur = [];
    for (const a of args) { if (a === ';') { cmds.push(cur); cur = []; } else cur.push(a); }
    cmds.push(cur);
    for (const c of cmds) {
      const name = c[c.indexOf('-t') + 1].replace(/^=/, '');
      if (!(name in sessions)) return { ran: true, status: 1, out };
      if (c[0] === 'display-message') out += c[c.length - 1] + '\n';
      else if (c[0] === 'show-environment') out += sessions[name].map((l) => l + '\n').join('');
    }
    return { ran: true, status: 0, out };
  };
  return { run, calls };
}

test('#6095: a pinned session gives its folder, an unpinned one "" (clean), a missing one null (unknown)', () => {
  const { run, calls } = fakeRun({
    ann: ['HOME=/Users/p', 'CLAUDE_CONFIG_DIR=/Users/p/.claude-work1'],
    bob: ['HOME=/Users/p'],
  });
  const got = sessionClaudeDirs(['ann', 'bob', 'gone'], { run });
  assert.equal(got.get('ann'), '/Users/p/.claude-work1');
  assert.equal(got.get('bob'), '', 'live and unpinned: the clean default launch');
  assert.equal(got.get('gone'), null, 'no such session: unknown, never "default"');
  assert.equal(calls.length, 2, 'one list plus ONE read for every session, not one call each');
  assert.ok(!calls[1].includes('=gone'), 'a session that is not live is never asked about (it would stop the sequence)');
});

test('#6095: the whole environment is read, never one variable (a per-variable read stops the batch at the first unset)', () => {
  const { run, calls } = fakeRun({ a: ['X=1'], b: ['CLAUDE_CONFIG_DIR=/x'] });
  sessionClaudeDirs(['a', 'b'], { run });
  for (const c of calls.slice(1)) assert.ok(!c.includes('CLAUDE_CONFIG_DIR'), 'the read names no variable: ' + c.join(' '));
});

test('#6095: tmux that cannot be asked, or a sequence that fails, answers UNKNOWN for every name', () => {
  assert.deepEqual([...sessionClaudeDirs(['a'], fakeRun({ a: [] }, { failList: true })).values()], [null]);
  assert.deepEqual([...sessionClaudeDirs(['a', 'b'], fakeRun({ a: [], b: [] }, { failSeq: true })).values()], [null, null]);
  assert.deepEqual([...sessionClaudeDirs([], fakeRun({})).values()], []);
  assert.deepEqual([...sessionClaudeDirs(['a', '', 7, 'a'], fakeRun({ a: [] })).entries()], [['a', '']], 'names are deduped and junk dropped');
});

test('#6095: a removed variable (-CLAUDE_CONFIG_DIR) is the clean launch, and the last line wins', () => {
  assert.equal(ccdFromEnvLines(['-CLAUDE_CONFIG_DIR']), '');
  assert.equal(ccdFromEnvLines(['CLAUDE_CONFIG_DIR=/a', '-CLAUDE_CONFIG_DIR']), '');
  assert.equal(ccdFromEnvLines(['CLAUDE_CONFIG_DIR=/a']), '/a');
  assert.equal(ccdFromEnvLines(['CLAUDE_CONFIG_DIRX=/a']), '', 'a longer name is not the variable');
});

test('#6095: a marker index outside the asked range is ignored, not trusted', () => {
  const run = (args) => (args[0] === 'list-sessions'
    ? { ran: true, status: 0, out: 'a\n' }
    : { ran: true, status: 0, out: MARK + '5\nCLAUDE_CONFIG_DIR=/wrong\n' });
  assert.equal(sessionClaudeDirs(['a'], { run }).get('a'), null, 'no block for index 0 was read: unknown');
});

/* The real tmux, on a PRIVATE socket so the operator's sessions are never touched. Proves the argument shape (`;` as
   its own argument, `=name` targets, the marker surviving display-message) against tmux itself. */
const TMUX = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find((p) => fs.existsSync(p));
test('#6095: against real tmux on a private socket', { skip: TMUX ? false : 'no tmux on this machine' }, (t) => {
  const sock = 'kosmos-6095-' + process.pid;
  const tm = (args) => execFileSync(TMUX, ['-L', sock, ...args], { encoding: 'utf8' });
  t.after(() => { try { tm(['kill-server']); } catch { /* already gone */ } });
  tm(['new-session', '-d', '-s', 'pinned', '-e', 'CLAUDE_CONFIG_DIR=/tmp/kosmos-6095-x', 'sleep 60']);
  tm(['new-session', '-d', '-s', 'clean', 'sleep 60']);
  tm(['new-session', '-d', '-s', 'clean-two', 'sleep 60']);   // a prefix of no other name, and "clean" is a prefix of it
  const got = sessionClaudeDirs(['clean', 'pinned', 'clean-two', 'absent'], { bin: TMUX, prefixArgs: ['-L', sock] });
  assert.equal(got.get('pinned'), '/tmp/kosmos-6095-x');
  assert.equal(got.get('clean'), '', 'unpinned, and read BEFORE the pinned one: a sequence that stopped here would leave pinned unread');
  assert.equal(got.get('clean-two'), '', '=name is an exact match: "clean" does not answer for "clean-two"');
  assert.equal(got.get('absent'), null);
});
