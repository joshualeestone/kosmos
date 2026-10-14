'use strict';
// #6095: sessionClaudeDirs reads the Claude config folder each tmux session runs under, in one tmux call per batch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { sessionClaudeDirs, parseQuoted, MARK } = require('./sessionccd');

/* `show-environment -s` the way tmux prints it (measured, tmux 3.6a): a set value double-quoted with " $ \ and
   backtick escaped and newlines left raw; a removed one as `unset NAME;`. env: [[name, value | null], ...]. */
const quoted = (env) => env.map(([k, v]) => (v === null ? `unset ${k};\n` : `${k}="${v.replace(/([\\"$`])/g, '\\$1')}"; export ${k};\n`)).join('');

/* A fake tmux. `sessions` maps a live session to its env pairs, `global` is the server's. It answers list-sessions,
   and a `;` sequence the way tmux does: stopping at the first failing command, with what it already printed.
   `failSeq` fails that many sequences after their output; `failFor` fails any sequence that targets that name. */
function fakeRun(sessions, { global = [], failList = false, failSeq = 0, failFor = null } = {}) {
  const calls = [];
  let seqFails = failSeq;
  const run = (args) => {
    calls.push(args);
    if (args[0] === 'list-sessions') {
      return failList ? { ran: false, status: null, out: '' } : { ran: true, status: 0, out: Object.keys(sessions).join('\n') + '\n' };
    }
    let out = '';
    const cmds = [];
    let cur = [];
    for (const a of args) { if (a === ';') { cmds.push(cur); cur = []; } else cur.push(a); }
    cmds.push(cur);
    for (const c of cmds) {
      const ti = c.indexOf('-t');
      const name = ti >= 0 ? c[ti + 1].replace(/^=/, '') : null;
      if (name !== null && (!(name in sessions) || name === failFor)) return { ran: true, status: 1, out };
      if (c[0] === 'display-message') out += c[c.length - 1] + '\n';
      else if (c[0] === 'show-environment') out += quoted(c.includes('-g') ? global : sessions[name]);
    }
    if (seqFails > 0) { seqFails -= 1; return { ran: true, status: 1, out }; }
    return { ran: true, status: 0, out };
  };
  return { run, calls };
}

test('#6095: pinned gives its folder, unpinned with no server value gives "" (default), missing gives null', () => {
  const { run, calls } = fakeRun({ ann: [['HOME', '/Users/p'], ['CLAUDE_CONFIG_DIR', '/Users/p/.claude-work1']], bob: [['HOME', '/Users/p']] });
  const got = sessionClaudeDirs(['ann', 'bob', 'gone'], { run });
  assert.equal(got.get('ann'), '/Users/p/.claude-work1');
  assert.equal(got.get('bob'), '');
  assert.equal(got.get('gone'), null, 'no such session: unknown, never "default"');
  assert.equal(calls.length, 2, 'one list plus ONE read for the batch, not one call each');
  assert.ok(!calls[1].includes('=gone'), 'a session that is not live is never asked about (it would stop the sequence)');
});

test('#6095 review 1: an unpinned session while the SERVER has a global value is unknown, not the default', () => {
  const { run } = fakeRun({ pin: [['CLAUDE_CONFIG_DIR', '/a']], bare: [['HOME', '/h']], off: [['CLAUDE_CONFIG_DIR', null]] },
    { global: [['CLAUDE_CONFIG_DIR', '/leaked']] });
  const got = sessionClaudeDirs(['pin', 'bare', 'off'], { run });
  assert.equal(got.get('pin'), '/a', 'its own pin wins over the global');
  assert.equal(got.get('bare'), null, 'it may have inherited /leaked: unknown');
  assert.equal(got.get('off'), '', 'a session that removes the variable runs with none');
  // review 2: a global that is removed, or set but empty
  assert.equal(sessionClaudeDirs(['bare'], fakeRun({ bare: [] }, { global: [['CLAUDE_CONFIG_DIR', null]] })).get('bare'), '');
  assert.equal(sessionClaudeDirs(['bare'], fakeRun({ bare: [] }, { global: [['CLAUDE_CONFIG_DIR', '']] })).get('bare'), null);
  assert.equal(sessionClaudeDirs(['e'], fakeRun({ e: [['CLAUDE_CONFIG_DIR', '']] })).get('e'), null, 'set but empty: unknown');
});

test('#6095 review 2: a value holding a newline cannot forge an entry or a marker', () => {
  const p = sessionClaudeDirs(['p'], fakeRun({ p: [['CLAUDE_CONFIG_DIR', '/real'], ['FOO', 'x\nunset CLAUDE_CONFIG_DIR;\ny"z']] })).get('p');
  assert.equal(p, '/real', 'a forged removal inside FOO is part of FOO');
  const z = sessionClaudeDirs(['z'], fakeRun({ z: [['ZZ', 'x\nCLAUDE_CONFIG_DIR="/forged"; export CLAUDE_CONFIG_DIR;\n']] })).get('z');
  assert.equal(z, '', 'a forged setting inside ZZ is part of ZZ: z is unpinned');
  const m = sessionClaudeDirs(['a', 'b'], fakeRun({ a: [['X', 'q\n' + MARK + '1\nCLAUDE_CONFIG_DIR="/evil"; export CLAUDE_CONFIG_DIR;']], b: [['CLAUDE_CONFIG_DIR', '/real-b']] }));
  assert.equal(m.get('b'), '/real-b', 'a forged marker inside a value is part of the value');
  assert.equal(m.get('a'), '');
  const odd = sessionClaudeDirs(['o'], fakeRun({ o: [['CLAUDE_CONFIG_DIR', '/re al"q$x\\y`b']] })).get('o');
  assert.equal(odd, '/re al"q$x\\y`b', 'every escaped character is read back as itself');
});

test('#6095: the whole environment is read, never one variable (a per-variable read stops the batch at the first unset)', () => {
  const { run, calls } = fakeRun({ a: [['X', '1']], b: [['CLAUDE_CONFIG_DIR', '/x']] });
  sessionClaudeDirs(['a', 'b'], { run });
  for (const c of calls.slice(1)) assert.ok(!c.includes('CLAUDE_CONFIG_DIR'), 'the read names no variable: ' + c.join(' '));
});

test('#6095 review 1: a sequence that fails AFTER printing part of its answer gives unknown, not the part', () => {
  const got = sessionClaudeDirs(['a', 'b'], fakeRun({ a: [['CLAUDE_CONFIG_DIR', '/a']], b: [] }, { failSeq: 2 }));
  assert.deepEqual([...got.values()], [null, null]);
  const once = sessionClaudeDirs(['a'], fakeRun({ a: [['CLAUDE_CONFIG_DIR', '/a']] }, { failSeq: 1 }));
  assert.equal(once.get('a'), '/a', 'a single failure (a session that went away mid-read) gets one retry');
});

test('#6095 review 2: a failed batch leaves the other batches read', () => {
  const s = { a: [['CLAUDE_CONFIG_DIR', '/a']], b: [['CLAUDE_CONFIG_DIR', '/b']], c: [['CLAUDE_CONFIG_DIR', '/c']] };
  const got = sessionClaudeDirs(['a', 'b', 'c'], { run: fakeRun(s, { failFor: 'b' }).run, batch: 1 });
  assert.equal(got.get('a'), '/a');
  assert.equal(got.get('b'), null);
  assert.equal(got.get('c'), '/c');
});

test('#6095 review 2: a name tmux would read specially is answered unknown without asking', () => {
  const { run, calls } = fakeRun({ '$x': [], 'a;': [], ok: [['CLAUDE_CONFIG_DIR', '/ok']] });
  const got = sessionClaudeDirs(['$x', 'a;', 'ok'], { run });
  assert.equal(got.get('$x'), null);
  assert.equal(got.get('a;'), null);
  assert.equal(got.get('ok'), '/ok', 'the rest of the batch is still read');
  assert.ok(!calls[1].includes('=$x') && !calls[1].includes('=a;'));
});

test('#6095: tmux that cannot be asked answers UNKNOWN; names are deduped and junk dropped', () => {
  assert.deepEqual([...sessionClaudeDirs(['a'], fakeRun({ a: [] }, { failList: true })).values()], [null]);
  assert.deepEqual([...sessionClaudeDirs([], fakeRun({})).values()], []);
  assert.deepEqual([...sessionClaudeDirs(['a', '', 7, 'a'], fakeRun({ a: [] })).entries()], [['a', '']]);
});

test('#6095 review 1: a repeated, out-of-order, bare or missing marker gives unknown for the batch', () => {
  const answer = (out) => (args) => (args[0] === 'list-sessions' ? { ran: true, status: 0, out: 'a\nb\n' } : { ran: true, status: 0, out });
  const cc = (v) => `CLAUDE_CONFIG_DIR="${v}"; export CLAUDE_CONFIG_DIR;\n`;
  for (const [why, out] of [
    ['repeated', MARK + 'g\n' + MARK + '0\n' + MARK + '1\n' + cc('/evil') + MARK + '1\n' + cc('/real')],
    ['out of order', MARK + 'g\n' + MARK + '1\n' + cc('/b') + MARK + '0\n'],
    ['bare', MARK + 'g\n' + MARK + '\n' + MARK + '1\n'],
    ['missing', MARK + 'g\n' + MARK + '0\n'],
    ['a line of another shape', MARK + 'g\n' + MARK + '0\nCLAUDE_CONFIG_DIR=/plain\n' + MARK + '1\n'],
  ]) assert.deepEqual([...sessionClaudeDirs(['a', 'b'], { run: answer(out) }).values()], [null, null], why);
});

test('#6095 review 1: sessions are read in batches, so a large fleet is never all unknown', () => {
  const sessions = {};
  for (let i = 0; i < 7; i += 1) sessions['s' + i] = [['CLAUDE_CONFIG_DIR', '/d' + i]];
  const { run, calls } = fakeRun(sessions);
  const got = sessionClaudeDirs(Object.keys(sessions), { run, batch: 3 });
  assert.equal(calls.length, 1 + 3, 'one list, then ceil(7/3) reads');
  for (let i = 0; i < 7; i += 1) assert.equal(got.get('s' + i), '/d' + i);
});

test('#6095: parseQuoted reads set, removed and absent, and refuses a variable named twice', () => {
  const g = MARK + 'g\n';
  assert.deepEqual(parseQuoted(g + 'unset CLAUDE_CONFIG_DIR;\n', ['g']), [{ removed: true }]);
  assert.deepEqual(parseQuoted(g + 'CLAUDE_CONFIG_DIR="/a"; export CLAUDE_CONFIG_DIR;\n', ['g']), [{ set: '/a' }]);
  assert.deepEqual(parseQuoted(g + 'CLAUDE_CONFIG_DIRX="/a"; export CLAUDE_CONFIG_DIRX;\n', ['g']), [{}], 'a longer name is not the variable');
  assert.equal(parseQuoted(g + 'CLAUDE_CONFIG_DIR="/a"; export CLAUDE_CONFIG_DIR;\nunset CLAUDE_CONFIG_DIR;\n', ['g']), null);
  assert.equal(parseQuoted(g + 'CLAUDE_CONFIG_DIR="/a', ['g']), null, 'an unclosed quote');
});

/* The real tmux, on a PRIVATE socket so the operator's sessions are never touched, started with no config file and
   with CLAUDE_CONFIG_DIR removed from its environment, so the runner's own value cannot leak into the result
   (review 1: it did, and certified a wrong ''). */
const TMUX = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find((p) => fs.existsSync(p));
test('#6095: against real tmux on a private socket', { skip: TMUX ? false : 'no tmux on this machine' }, (t) => {
  const sock = 'kosmos-6095-' + process.pid;
  const env = { ...process.env };
  delete env.CLAUDE_CONFIG_DIR;
  const tm = (args) => execFileSync(TMUX, ['-L', sock, '-f', '/dev/null', ...args], { encoding: 'utf8', env });
  t.after(() => { try { tm(['kill-server']); } catch { /* already gone */ } });
  tm(['new-session', '-d', '-s', 'clean', 'sleep 60']);
  tm(['new-session', '-d', '-s', 'pinned', '-e', 'CLAUDE_CONFIG_DIR=/tmp/kosmos 6095 "x"$y', 'sleep 60']);
  tm(['set-environment', '-t', 'pinned', 'FOO', 'x\nunset CLAUDE_CONFIG_DIR;\n' + MARK + '0\ny']);
  const opts = { bin: TMUX, prefixArgs: ['-L', sock] };
  let got = sessionClaudeDirs(['clean', 'pinned', 'absent'], opts);
  assert.equal(got.get('clean'), '', 'no pin and no server value: the default (read before the pinned one)');
  assert.equal(got.get('pinned'), '/tmp/kosmos 6095 "x"$y', 'read back exactly, past a value that holds a forged entry and marker');
  assert.equal(got.get('absent'), null);
  // The leak: the server gains a global value; a session started now inherits it without showing it.
  tm(['set-environment', '-g', 'CLAUDE_CONFIG_DIR', '/tmp/kosmos-6095-leak']);
  tm(['new-session', '-d', '-s', 'inherits', 'sleep 60']);
  got = sessionClaudeDirs(['inherits', 'pinned'], opts);
  assert.equal(got.get('inherits'), null, 'it inherited the leaked value, which its own environment does not show: unknown');
  assert.equal(got.get('pinned'), '/tmp/kosmos 6095 "x"$y', 'its own pin is still read');
});
