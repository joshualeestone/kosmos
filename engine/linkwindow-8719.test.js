'use strict';
/* kosmos#8719 part 2: linking a running window to its agent sets Kosmos's own mark on that one session, after it checks
   the window is plainly that agent, and reports linked only once the mark reads back. tmux is a stand-in here. */
const test = require('node:test');
const assert = require('node:assert/strict');
const status = require('./status');
const linkwindow = require('./linkwindow');
const fleet = require('../test-support/fleet');

const panesOf = (...lines) => {
  status.setPaneSource(() => lines.map((l) => fleet.line(l)).join('\n') + '\n');
  try { return status.panesWithCommands(); } finally { status.setPaneSource(null); }
};

/* A stand-in tmux: records each call, keeps the session options it is given, answers what runs in a session, and can
   be told to fail or to answer with another program (a window replaced between the look and the mark). */
function fakeTmux(opts) {
  const o = opts || {};
  const calls = [];
  const options = {};
  linkwindow.setRunner((bin, args) => {
    calls.push(args);
    if (args[0] === 'set-option' && args[1] === '-u') { delete options[args[3] + ' ' + args[4]]; return { ok: true, code: 0, stdout: '' }; }
    if (args[0] === 'set-option') {
      if (o.setFails) return { ok: false, code: 1, stdout: '' };
      options[args[2] + ' ' + args[3]] = args[4];
      return { ok: true, code: 0, stdout: '' };
    }
    if (args[0] === 'show-options') {
      if (o.readWrong) return { ok: true, code: 0, stdout: 'someone-else\n' };
      const v = options[args[3] + ' ' + args[4]];
      return v === undefined ? { ok: false, code: 1, stdout: '' } : { ok: true, code: 0, stdout: v + '\n' };
    }
    if (args[0] === 'display-message') return { ok: true, code: 0, stdout: (o.nowRunning || fleet.CLAUDE_COMMAND) + '\n' };
    return { ok: false, code: 1, stdout: '' };
  });
  calls.options = options;
  return calls;
}
test.afterEach(() => linkwindow.setRunner(null));

test('#8719: a hand-started Claude window is linked, with an exact target, and only after the mark reads back', () => {
  const panes = panesOf({ session: 'zara', claim: '' });
  assert.equal(linkwindow.plan('zara', panes, 'darwin').ok, true, 'premise: the window is linkable');
  const calls = fakeTmux();
  const r = linkwindow.link('zara', { panes, platform: 'darwin' });
  assert.deepEqual(r, { outcome: 'linked', session: 'zara', name: 'zara' });
  assert.deepEqual(calls[0], ['set-option', '-t', '=zara', '@kosmos_agent', 'zara'], 'the mark, on the exact session (= anchored)');
  assert.deepEqual(calls[1], ['show-options', '-v', '-t', '=zara', '@kosmos_agent'], 'then read back');
  assert.deepEqual(calls[2], ['display-message', '-p', '-t', '=zara', '#{pane_current_command}'], 'and what runs in it, again');
  assert.equal(calls.length, 3, 'nothing else is changed');
});

test('#8719: in a named Kosmos the card is the agent name and the mark goes on the raw session (zara+world)', () => {
  const pane = { name: 'zara', session: 'zara+atlas', claim: '', command: fleet.CLAUDE_COMMAND, pane: '0.0', title: '' };
  const p = linkwindow.plan('zara', [pane], 'darwin');
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.equal(p.session, 'zara+atlas');
  const calls = fakeTmux();
  assert.equal(linkwindow.link('zara', { panes: [pane], platform: 'darwin' }).outcome, 'linked');
  assert.deepEqual(calls[0], ['set-option', '-t', '=zara+atlas', '@kosmos_agent', 'zara+atlas'], 'the claim equals the raw session, as a launch sets it');
  assert.equal(linkwindow.plan('zara+atlas', [pane], 'darwin').ok, undefined, 'CONTROL: the raw session is not the name a card carries');
});

test('#8719: a window whose program changed between the look and the mark is not linked, and the mark comes off', () => {
  const panes = panesOf({ session: 'zara', claim: '' });
  const calls = fakeTmux({ nowRunning: 'zsh' });
  const r = linkwindow.link('zara', { panes, platform: 'darwin' });
  assert.equal(r.outcome, 'refused');
  assert.match(r.because, /took the mark off again/);
  assert.deepEqual(calls[calls.length - 1], ['set-option', '-u', '-t', '=zara', '@kosmos_agent'], 'the mark was removed');
  assert.equal(calls.options['=zara @kosmos_agent'], undefined, 'and is gone');
});

test('#8719: a mark that does not read back is not reported linked, and is taken off; CONTROL above reads it back', () => {
  const panes = panesOf({ session: 'zara', claim: '' });
  fakeTmux({ readWrong: true });
  const r = linkwindow.link('zara', { panes, platform: 'darwin' });
  assert.equal(r.outcome, 'refused');
  assert.match(r.because, /could not confirm the window called zara after marking it, so it took the mark off again/);
  fakeTmux({ setFails: true });
  const s = linkwindow.link('zara', { panes, platform: 'darwin' });
  assert.equal(s.outcome, 'refused');
  assert.match(s.because, /could not mark the window called zara\. Nothing was changed\./);
});

test('#8719: it refuses every window that is not plainly that agent, and changes nothing', () => {
  const calls = fakeTmux();
  const cases = [
    [panesOf({ session: 'zara', claim: 'zara' }), /already linked/, 'already marked'],
    [panesOf({ session: 'zara-discord', claim: '' }), /already linked/, 'a -discord session carries the name zara and is ours by its suffix'],
    [panesOf({ session: 'zarah', claim: '' }), /There is no window called zara to link/, 'a prefix is not the name'],
    [panesOf({ session: 'zara', claim: '', command: 'zsh' }), /running zsh, not Claude/, 'a crashed pane back at a shell'],
    [panesOf({ session: 'zara', claim: '', command: 'vim' }), /running vim, not Claude/, 'an editor under the name'],
    [panesOf({ session: 'zara', claim: '', command: 'codex' }), /running codex, not Claude/, 'a Codex window: its runner would read as Claude'],
    [panesOf({ session: 'zara', claim: '', command: 'node' }), /cannot tell that the window called zara is running an agent/, 'an unmarked node could be any program'],
    [[], /There is no window called zara/, 'nothing running at all'],
  ];
  for (const [panes, why, label] of cases) {
    const r = linkwindow.link('zara', { panes, platform: 'darwin' });
    assert.equal(r.outcome, 'refused', label);
    assert.match(r.because, why, label);
  }
  assert.equal(linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '' }), platform: 'win32' }).outcome, 'refused', 'Windows');
  assert.equal(linkwindow.link('  ', { panes: [], platform: 'darwin' }).outcome, 'refused', 'a blank name');
  assert.equal(calls.length, 0, 'a refusal never touched tmux');
});
