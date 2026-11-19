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
    if (verb === 'display-message') return { ok: true, code: 0, stdout: `$0\t1x1\t${cmd}\t${marks['@kosmos_runner']}\t${marks['@kosmos_agent']}\n` };
    if (verb === 'show-options') {
      const key = args[args.length - 1];
      if (key === '@kosmos_runner' && o.readFails) return { ok: false, code: 1, stdout: '' };
      let v = marks[key];
      if (key === '@kosmos_runner' && o.readRunnerAs !== undefined && v) v = o.readRunnerAs;
      if (key === '@kosmos_agent' && o.readAgentAs !== undefined && v) v = o.readAgentAs;
      /* As tmux: with -q an option that is not set answers empty and succeeds; without it, it fails. */
      if (!v) return args.includes('-q') ? { ok: true, code: 0, stdout: '' } : { ok: false, code: 1, stdout: '' };
      return { ok: true, code: 0, stdout: v + '\n' };
    }
    if (verb === 'set-option' && args[1] === '-u') {
      const key = args[args.length - 1];
      if (o.unsetFails === true || o.unsetFails === key) return { ok: false, code: 1, stdout: '' };
      marks[key] = ''; return { ok: true, code: 0, stdout: '' };
    }
    if (verb === 'set-option') {
      if (o.setFails === args[3]) return { ok: false, code: 1, stdout: '' };
      marks[args[3]] = args[4];
      if (o.setReportsFail === args[3]) return { ok: false, code: null, stdout: '' };   // applied, but answered late
      return { ok: true, code: 0, stdout: '' };
    }
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
  for (const [expected, why] of [['claude', /running Codex, but Kosmos knows zara as a Claude agent/], ['grok', /knows zara as a Grok agent/],
    ['antigravity', /knows zara as an Antigravity agent/], ['gemini', /knows zara as a Gemini agent/],
    [null, /Kosmos has no record of an agent called zara that it can read, so it was not linked\. Add zara to Kosmos first/]]) {
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

test('#8724 an agent mark that does not read back takes both marks off; CONTROL: the plain case above links', () => {
  linkwindow.setExpectedSource(() => 'codex');
  const t = fakeTmux('codex', { readAgentAs: 'someone-else' });
  const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '', command: 'codex' }), platform: 'darwin' });
  assert.equal(r.outcome, 'refused', JSON.stringify(r));
  assert.match(r.because, /took the mark off again and nothing was linked\.$/);
  assert.deepEqual(t.marks, { '@kosmos_agent': '', '@kosmos_runner': '' });
  assert.notEqual(r.markLeft, true);
});

test('#8724 a runner that reads back as another value: the agent mark comes off, that value is left alone', () => {
  linkwindow.setExpectedSource(() => 'codex');
  const t = fakeTmux('codex', { readRunnerAs: 'claude' });
  const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '', command: 'codex' }), platform: 'darwin' });
  assert.equal(r.outcome, 'refused');
  assert.equal(t.marks['@kosmos_agent'], '');
  assert.ok(!t.calls.some((c) => c[0] === 'set-option' && c[1] === '-u' && c.includes('@kosmos_runner')), 'another writer\'s runner value was taken off');
});

test('#8724 an agent mark that will not come off keeps its runner (never ours with an empty runner), and is markLeft', () => {
  linkwindow.setExpectedSource(() => 'codex');
  const t = fakeTmux('codex', { readRunnerAs: 'claude', unsetFails: '@kosmos_agent' });
  const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '', command: 'codex' }), platform: 'darwin' });
  assert.equal(r.markLeft, true);
  assert.equal(t.marks['@kosmos_agent'], 'zara');
  assert.equal(t.marks['@kosmos_runner'], 'codex', 'the runner note was taken off a window still marked ours');
  assert.ok(!t.calls.some((c) => c[0] === 'set-option' && c[1] === '-u' && c.includes('@kosmos_runner')));
});

test('#8724 a runner mark the board does not know (another tool) is seen at the look and left alone', () => {
  for (const [cmd, expected] of [['codex', 'codex'], [fleet.CLAUDE_COMMAND, null]]) {
    linkwindow.setExpectedSource(() => expected);
    const t = fakeTmux(cmd, { runner: 'sometool' });
    const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '', command: cmd }), platform: 'darwin' });
    assert.equal(r.outcome, 'refused', cmd);
    assert.match(r.because, /carries a runner mark naming sometool, so Kosmos did not change it/, cmd);
    assert.ok(!t.calls.some((c) => c[0] === 'set-option'), cmd + ': a mark was written over another tool\'s');
  }
});

test('#8724 an agent mark that applied but answered as failed is taken off before the runner note; nothing is left', () => {
  linkwindow.setExpectedSource(() => 'codex');
  const t = fakeTmux('codex', { setReportsFail: '@kosmos_agent' });
  const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '', command: 'codex' }), platform: 'darwin' });
  assert.equal(r.outcome, 'refused');
  assert.deepEqual(t.marks, { '@kosmos_agent': '', '@kosmos_runner': '' });
  assert.match(r.because, /Nothing was changed/);
  const unsets = t.calls.filter((c) => c[0] === 'set-option' && c[1] === '-u').map((c) => c[c.length - 1]);
  assert.deepEqual(unsets, ['@kosmos_agent', '@kosmos_runner'], 'the agent mark must come off before the runner note');
});

test('#8724 an agent mark that applied and will not come off keeps its runner, and is markLeft', () => {
  linkwindow.setExpectedSource(() => 'codex');
  const t = fakeTmux('codex', { setReportsFail: '@kosmos_agent', unsetFails: '@kosmos_agent' });
  const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '', command: 'codex' }), platform: 'darwin' });
  assert.equal(r.markLeft, true, JSON.stringify(r));
  assert.equal(t.marks['@kosmos_runner'], 'codex', 'a window marked ours lost its runner');
});

test('#8724 an unreadable record is refused as unreadable, never as "no record"', () => {
  linkwindow.setExpectedSource(() => undefined);
  fakeTmux('codex');
  const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '', command: 'codex' }), platform: 'darwin' });
  assert.equal(r.outcome, 'refused');
  assert.match(r.because, /^Kosmos could not read its record of zara, so it was not linked\.$/);
});

test('#8724 an agent mark that cannot be taken off is reported as a mark left on the window', () => {
  linkwindow.setExpectedSource(() => 'codex');
  fakeTmux('codex', { readRunnerAs: 'claude', unsetFails: true });
  const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '', command: 'codex' }), platform: 'darwin' });
  assert.equal(r.outcome, 'refused');
  assert.equal(r.markLeft, true);
  assert.match(r.because, /could not take the mark off/);
});

test('#8724 only the runner note left behind is said, not reported as the mark left on the window', () => {
  linkwindow.setExpectedSource(() => 'codex');
  const t = fakeTmux('codex', { readAgentAs: 'someone-else', unsetFails: '@kosmos_runner' });
  const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '', command: 'codex' }), platform: 'darwin' });
  assert.equal(r.outcome, 'refused');
  assert.notEqual(r.markLeft, true, 'a runner note alone does not make the window ours');
  assert.match(r.because, /A note of which program runs it stayed on the window, which does not make it Kosmos's\./);
  assert.equal(t.marks['@kosmos_agent'], '');
});

test('#8724 an agent mark that will not take, with a runner note that will not come off, says so honestly', () => {
  linkwindow.setExpectedSource(() => 'codex');
  const t = fakeTmux('codex', { setFails: '@kosmos_agent', unsetFails: '@kosmos_runner' });
  const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '', command: 'codex' }), platform: 'darwin' });
  assert.equal(r.outcome, 'refused');
  assert.match(r.because, /could not take back the note of which program runs it\. The window is not linked\./);
  assert.doesNotMatch(r.because, /Nothing was changed/);
  assert.equal(t.marks['@kosmos_agent'], '');
  /* CONTROL: when the note does come off, it is the plain sentence. */
  fakeTmux('codex', { setFails: '@kosmos_agent' });
  const r2 = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '', command: 'codex' }), platform: 'darwin' });
  assert.match(r2.because, /could not mark the window called zara\. Nothing was changed\./);
});

test('#8724 a Claude window still links as before (no record, or a Claude record), and no runner mark is written', () => {
  for (const expected of [null, 'claude']) {
    linkwindow.setExpectedSource(() => expected);
    const t = fakeTmux(fleet.CLAUDE_COMMAND);
    const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '' }), platform: 'darwin' });
    assert.equal(r.outcome, 'linked', JSON.stringify(r));
    assert.equal(r.runner, undefined);
    assert.equal(t.marks['@kosmos_runner'], '');
    assert.ok(!t.calls.some((c) => c[0] === 'set-option' && c.includes('@kosmos_runner')), 'a Claude link wrote the runner mark');
  }
});

test('#8724 a Claude window under an agent Kosmos knows runs something else is refused; nothing is changed', () => {
  linkwindow.setExpectedSource(() => 'codex');
  const t = fakeTmux(fleet.CLAUDE_COMMAND);
  const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '' }), platform: 'darwin' });
  assert.equal(r.outcome, 'refused');
  assert.match(r.because, /running Claude, but Kosmos knows zara as a Codex agent, so it was not linked/);
  assert.equal(t.calls.length, 0);
});

test('#8724 a Claude window carrying a runner mark for another program is left alone; CONTROL: an empty one links (above)', () => {
  linkwindow.setExpectedSource(() => null);
  const t = fakeTmux(fleet.CLAUDE_COMMAND, { runner: 'codex' });
  const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '', runner: 'codex' }), platform: 'darwin' });
  assert.equal(r.outcome, 'refused');
  assert.match(r.because, /carries a runner mark naming codex, so Kosmos did not change it/);
  assert.equal(t.marks['@kosmos_agent'], '');
  assert.equal(t.calls.length, 0, 'read from the board look, so tmux is not asked');
});
