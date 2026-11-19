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

/* A stand-in tmux: records each call, keeps the session options it is given, and can be told to fail. */
function fakeTmux(opts) {
  const o = opts || {};
  const calls = [];
  const options = {};
  linkwindow.setRunner((bin, args) => {
    calls.push(args);
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
    return { ok: false, code: 1, stdout: '' };
  });
  return calls;
}
test.afterEach(() => linkwindow.setRunner(null));

test('#8719: a hand-started Claude window is linked, with an exact target, and only after the mark reads back', () => {
  const panes = panesOf({ session: 'zara', claim: '' });
  assert.equal(linkwindow.plan('zara', panes, 'darwin').ok, true, 'premise: the window is linkable');
  const calls = fakeTmux();
  const r = linkwindow.link('zara', { panes, platform: 'darwin' });
  assert.deepEqual(r, { outcome: 'linked', session: 'zara' });
  assert.deepEqual(calls[0], ['set-option', '-t', '=zara', '@kosmos_agent', 'zara'], 'the mark, on the exact session (= anchored)');
  assert.deepEqual(calls[1], ['show-options', '-v', '-t', '=zara', '@kosmos_agent'], 'then read back');
  assert.equal(calls.length, 2, 'nothing else is changed');
});

test('#8719: a mark that does not read back is not reported linked; CONTROL above reads it back', () => {
  const panes = panesOf({ session: 'zara', claim: '' });
  fakeTmux({ readWrong: true });
  const r = linkwindow.link('zara', { panes, platform: 'darwin' });
  assert.equal(r.outcome, 'refused');
  assert.match(r.because, /could not read the mark back/);
  fakeTmux({ setFails: true });
  const s = linkwindow.link('zara', { panes, platform: 'darwin' });
  assert.equal(s.outcome, 'refused');
  assert.match(s.because, /could not mark the window called zara\. Nothing was changed\./);
});

test('#8719: it refuses every window that is not plainly that agent, and changes nothing', () => {
  const calls = fakeTmux();
  const cases = [
    [panesOf({ session: 'zara', claim: 'zara' }), /already linked/, 'already marked'],
    [panesOf({ session: 'zara-discord', claim: '' }), /There is no window called zara to link/, 'only a near name (a -discord session is ours anyway)'],
    [panesOf({ session: 'zarah', claim: '' }), /There is no window called zara to link/, 'a prefix is not the name'],
    [panesOf({ session: 'zara', claim: '', command: 'zsh' }), /running zsh, not Claude/, 'a crashed pane back at a shell'],
    [panesOf({ session: 'zara', claim: '', command: 'vim' }), /running vim, not Claude/, 'an editor under the name'],
    [panesOf({ session: 'zara', claim: '', command: 'codex' }), /running codex, not Claude/, 'a Codex window: its runner would read as Claude'],
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
