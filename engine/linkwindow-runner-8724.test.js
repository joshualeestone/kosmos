'use strict';
/* kosmos#8724 item 3: linking a Codex, Antigravity or Grok window. Linked only when the program names that runner
   exactly AND Kosmos's record of the agent says it runs on it; the runner is recorded (`@kosmos_runner`) before the
   agent mark, both are read back, and on a mismatch both come off. The pane list is the board's own look
   (status.panesWithCommands over test-support/fleet lines); tmux and the record are stand-ins.

     node --test engine/linkwindow-runner-8724.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const status = require('./status');
const linkwindow = require('./linkwindow');
const fleet = require('../test-support/fleet');

const panesOf = (...lines) => {
  status.setPaneSource(() => lines.map((l) => fleet.line(l)).join('\n') + '\n');
  try { return status.panesWithCommands(); } finally { status.setPaneSource(null); }
};

/* A stand-in tmux for one session, $0, running `cmd`: keeps both marks, records every call, and can be told to read
   the runner back as something else or to refuse to take a mark off. */
function fakeTmux(cmd, opts) {
  const o = opts || {};
  const marks = { '@kosmos_agent': o.agent || '', '@kosmos_runner': o.runner || '' };
  const calls = [];
  linkwindow.setRunner((bin, args) => {
    calls.push(args);
    const [verb] = args;
    if (verb === 'display-message') return { ok: true, code: 0, stdout: `$0\t1x1\t${cmd}\t${marks['@kosmos_agent']}\n` };
    if (verb === 'show-options') {
      const key = args[args.length - 1];
      let v = marks[key];
      if (key === '@kosmos_runner' && o.readRunnerAs !== undefined && v) v = o.readRunnerAs;
      return v ? { ok: true, code: 0, stdout: v + '\n' } : { ok: false, code: 1, stdout: '' };
    }
    if (verb === 'set-option' && args[1] === '-u') {
      if (o.unsetFails) return { ok: false, code: 1, stdout: '' };
      marks[args[args.length - 1]] = ''; return { ok: true, code: 0, stdout: '' };
    }
    if (verb === 'set-option') { marks[args[3]] = args[4]; return { ok: true, code: 0, stdout: '' }; }
    return { ok: false, code: 1, stdout: '' };
  });
  return { marks, calls };
}
test.afterEach(() => { linkwindow.setRunner(null); linkwindow.setExpectedSource(null); });

for (const [cmd, runner] of [['codex', 'codex'], ['agy', 'antigravity'], ['grok-native', 'grok']]) {
  test(`#8724 a ${cmd} window for an agent Kosmos knows runs ${runner} is linked, its runner recorded before the mark`, () => {
    linkwindow.setExpectedSource((n) => (n === 'zara' ? runner : null));
    const t = fakeTmux(cmd);
    const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '', command: cmd }), platform: 'darwin' });
    assert.equal(r.outcome, 'linked', JSON.stringify(r));
    assert.equal(r.runner, runner);
    assert.deepEqual(t.marks, { '@kosmos_agent': 'zara', '@kosmos_runner': runner });
    const sets = t.calls.filter((c) => c[0] === 'set-option').map((c) => c[3]);
    assert.deepEqual(sets, ['@kosmos_runner', '@kosmos_agent'], 'the runner must be recorded before the window is marked ours');
  });
}

test('#8724 refused when Kosmos knows the agent as another runner, or has no record of it; nothing is changed', () => {
  for (const [expected, why] of [['claude', /running Codex, but Kosmos knows zara as a Claude agent/], ['grok', /knows zara as a Grok agent/], [null, /Kosmos has no record of an agent called zara/]]) {
    linkwindow.setExpectedSource(() => expected);
    const t = fakeTmux('codex');
    const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '', command: 'codex' }), platform: 'darwin' });
    assert.equal(r.outcome, 'refused', String(expected));
    assert.match(r.because, why);
    assert.equal(t.calls.length, 0, 'a refusal from the plan touched tmux');
  }
});

test('#8724 a bare node is never taken for Codex (the npm codex and every dev server front as node)', () => {
  linkwindow.setExpectedSource(() => 'codex');
  fakeTmux('node');
  const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '', command: 'node' }), platform: 'darwin' });
  assert.equal(r.outcome, 'refused');
  assert.match(r.because, /cannot tell that the window called zara is running an agent/);
});

test('#8724 a runner mark naming something else is left alone; one already naming this runner is kept', () => {
  linkwindow.setExpectedSource(() => 'codex');
  let t = fakeTmux('codex', { runner: 'grok' });
  let r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '', command: 'codex' }), platform: 'darwin' });
  assert.equal(r.outcome, 'refused');
  assert.match(r.because, /carries a runner mark naming grok/);
  assert.deepEqual(t.marks, { '@kosmos_agent': '', '@kosmos_runner': 'grok' });
  t = fakeTmux('codex', { runner: 'codex' });
  r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '', command: 'codex' }), platform: 'darwin' });
  assert.equal(r.outcome, 'linked', JSON.stringify(r));
  assert.ok(!t.calls.some((c) => c[0] === 'set-option' && c[3] === '@kosmos_runner'), 'a runner mark already right was rewritten');
});

test('#8724 a runner that does not read back takes both marks off; CONTROL: the plain case above links', () => {
  linkwindow.setExpectedSource(() => 'codex');
  const t = fakeTmux('codex', { readRunnerAs: 'claude' });
  const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '', command: 'codex' }), platform: 'darwin' });
  assert.equal(r.outcome, 'refused', JSON.stringify(r));
  assert.match(r.because, /took the mark off again/);
  assert.deepEqual(t.marks, { '@kosmos_agent': '', '@kosmos_runner': '' });
  assert.notEqual(r.markLeft, true);
});

test('#8724 a runner mark that cannot be taken off is reported as a mark left on the window', () => {
  linkwindow.setExpectedSource(() => 'codex');
  fakeTmux('codex', { readRunnerAs: 'claude', unsetFails: true });
  const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '', command: 'codex' }), platform: 'darwin' });
  assert.equal(r.outcome, 'refused');
  assert.equal(r.markLeft, true);
  assert.match(r.because, /could not take the mark off/);
});

test('#8724 a Claude window still links as before, with no runner mark written', () => {
  linkwindow.setExpectedSource(() => { throw new Error('the record is not asked for a Claude window'); });
  const t = fakeTmux(fleet.CLAUDE_COMMAND);
  const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '' }), platform: 'darwin' });
  assert.equal(r.outcome, 'linked', JSON.stringify(r));
  assert.equal(r.runner, undefined);
  assert.equal(t.marks['@kosmos_runner'], '');
  assert.ok(!t.calls.some((c) => c.includes('@kosmos_runner')), 'a Claude link touched the runner mark');
});
