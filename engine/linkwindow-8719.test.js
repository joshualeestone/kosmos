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
    if (args[0] === 'set-option' && args[1] === '-u') {
      if (o.unsetFails || o.gone) return { ok: false, code: 1, stdout: '' };
      delete options[args[3] + ' ' + args[4]]; return { ok: true, code: 0, stdout: '' };
    }
    if (args[0] === 'set-option') {
      if (o.setFails) return { ok: false, code: 1, stdout: '' };
      options[args[2] + ' ' + args[3]] = args[4];
      return { ok: true, code: 0, stdout: '' };
    }
    if (args[0] === 'show-options') {
      if (o.readWrong) return { ok: true, code: 0, stdout: 'someone-else\n' };
      /* By the target after -t and the option last, so a -q read finds the same option (kosmos#8724). As tmux 3.6a:
         with -q an option that is not set answers empty and succeeds; without it, it fails. */
      const v = options[args[args.indexOf('-t') + 1] + ' ' + args[args.length - 1]];
      if (v === undefined) return args.includes('-q') ? { ok: true, code: 0, stdout: '' } : { ok: false, code: 1, stdout: '' };
      return { ok: true, code: 0, stdout: v + '\n' };
    }
    if (args[0] === 'display-message') {
      o.looks = (o.looks || 0) + 1;
      const after = o.looks > 1;
      if (after && o.gone) return { ok: false, code: 1, stdout: '' };
      const id = after && o.swapped ? '$9' : '$0';
      const cmd = after && o.nowRunning ? o.nowRunning : (o.firstRunning || fleet.CLAUDE_COMMAND);
      const claim = !after && o.claimedAtLook ? o.claimedAtLook : (options['$0 @kosmos_agent'] || '');
      const count = after && o.paneAdded ? '1x2' : '1x1';
      return { ok: true, code: 0, stdout: id + '\t' + count + '\t' + cmd + '\t' + '\t' + claim + '\n' };   // kosmos#8724: an empty runner field
    }
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
  const fmt = '#{session_id}\t#{session_windows}x#{window_panes}\t#{pane_current_command}\t#{@kosmos_runner}\t#{@kosmos_agent}';   // kosmos#8724: the runner too
  assert.deepEqual(calls[0], ['display-message', '-p', '-t', '=zara:0.0', fmt], 'first, the very pane by its exact name');
  assert.deepEqual(calls[1], ['set-option', '-t', '$0', '@kosmos_agent', 'zara'], 'the mark, on that session by its id');
  assert.deepEqual(calls[2], ['show-options', '-v', '-t', '$0', '@kosmos_agent'], 'then read back, by id');
  assert.deepEqual(calls[3], ['display-message', '-p', '-t', '$0:0.0', fmt], 'and the same session, pane and program again');
  assert.equal(calls.length, 4, 'nothing else is changed');
});

test('#8719: in a named Kosmos the card is the agent name and the mark goes on the raw session (zara+world)', () => {
  const pane = { name: 'zara', session: 'zara+atlas', claim: '', command: fleet.CLAUDE_COMMAND, pane: '0.0', title: '' };
  const p = linkwindow.plan('zara', [pane], 'darwin');
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.equal(p.session, 'zara+atlas');
  const calls = fakeTmux();
  assert.equal(linkwindow.link('zara', { panes: [pane], platform: 'darwin' }).outcome, 'linked');
  assert.deepEqual(calls[0][3], '=zara+atlas:0.0', 'the look names the raw session');
  assert.deepEqual(calls[1], ['set-option', '-t', '$0', '@kosmos_agent', 'zara+atlas'], 'the claim equals the raw session, as a launch sets it');
  assert.equal(linkwindow.plan('zara+atlas', [pane], 'darwin').ok, undefined, 'CONTROL: the raw session is not the name a card carries');
});

test('#8719: a window whose program changed between the look and the mark is not linked, and the mark comes off', () => {
  const panes = panesOf({ session: 'zara', claim: '' });
  const calls = fakeTmux({ nowRunning: 'zsh' });
  const r = linkwindow.link('zara', { panes, platform: 'darwin' });
  assert.equal(r.outcome, 'refused');
  assert.match(r.because, /took the mark off again/);
  assert.deepEqual(calls[calls.length - 1], ['set-option', '-u', '-t', '$0', '@kosmos_agent'], 'the mark was removed, from that session by id');
  assert.equal(calls.options['$0 @kosmos_agent'], undefined, 'and is gone');
  // The look reports another session id afterwards: not linked, and only this call's session (by id) is unmarked.
  const swapped = fakeTmux({ swapped: true });
  assert.match(linkwindow.link('zara', { panes, platform: 'darwin' }).because, /took the mark off again/);
  assert.deepEqual(swapped.filter((c) => c[0] === 'set-option' && c[1] === '-u'), [['set-option', '-u', '-t', '$0', '@kosmos_agent']]);
  // The session went away after the mark (no id at the after-look, the unmark finds nothing): no false alarm.
  fakeTmux({ gone: true });
  const goneR = linkwindow.link('zara', { panes, platform: 'darwin' });
  assert.match(goneR.because, /went away while Kosmos was linking it, so nothing was linked/);
  assert.doesNotMatch(goneR.because, /could not take the mark off/);
  assert.notEqual(goneR.markLeft, true, 'kosmos#8724: a window that went away left no mark');
  // A window added to the session after the look: not linked, and the mark comes off.
  const grew = fakeTmux({ paneAdded: true });
  assert.match(linkwindow.link('zara', { panes, platform: 'darwin' }).because, /took the mark off again/);
  assert.equal(grew.filter((c) => c[0] === 'set-option' && c[1] === '-u').length, 1);
  // A program that is not the one the board saw (an unmarked node that replaced it): nothing is marked.
  const nodeNow = fakeTmux({ firstRunning: 'node' });
  assert.match(linkwindow.link('zara', { panes, platform: 'darwin' }).because, /could not confirm what runs in the window called zara/);
  assert.equal(nodeNow.filter((c) => c[0] === 'set-option').length, 0);
  // A mark already there at the look (a supervisor started it since the board's look): refused, nothing set.
  const claimed = fakeTmux({ claimedAtLook: 'zara' });
  assert.match(linkwindow.link('zara', { panes, platform: 'darwin' }).because, /already linked/);
  assert.equal(claimed.filter((c) => c[0] === 'set-option').length, 0);
  // And when the mark cannot be taken off, it says so rather than claiming it did.
  fakeTmux({ nowRunning: 'zsh', unsetFails: true });
  const stuck = linkwindow.link('zara', { panes, platform: 'darwin' });
  assert.match(stuck.because, /could not take the mark off/);
  assert.equal(stuck.markLeft, true, 'kosmos#8724: the refusal that may leave the mark says so as a field');
  // What runs there is checked before any mark: a shell at the first look marks nothing.
  const first = fakeTmux({ firstRunning: 'zsh' });
  assert.match(linkwindow.link('zara', { panes, platform: 'darwin' }).because, /could not confirm what runs in the window called zara, so nothing was linked/);
  assert.equal(first.filter((c) => c[0] === 'set-option').length, 0);
});

/* The tmux arguments link() sends, against a REAL tmux server on a private socket (nothing else on this computer is
   reachable on it). A stand-in cannot say whether a target form resolves: `=zara` does not on tmux 3.6a, `=zara:` does. */
const realTmux = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find((t) => { try { return require('node:fs').statSync(t).isFile(); } catch { return false; } });
test('#8719: on a real tmux, link() marks exactly the named session and never a prefix-named one', { skip: !realTmux && 'no tmux on this computer' }, () => {
  const cp = require('node:child_process');
  const sock = 'kosmos-link-8719-' + process.pid;
  // -f /dev/null: the person's own ~/.tmux.conf (hooks, destroy-unattached, a default-command) never reaches this server.
  const t = (...args) => cp.spawnSync(realTmux, ['-L', sock, '-f', '/dev/null', ...args], { encoding: 'utf8', timeout: 10000 });
  /* No Claude runs on a test box, so the look's program ("sleep") is read as Claude's version string; every other call
     is real tmux with link()'s own arguments. Installed for the prefix phase too: a non-exact target would then really
     resolve to zarah, find "Claude" there, and mark it, which this test must see. */
  const asClaude = (bin, args) => {
    const r = t(...args);
    const out = args[0] === 'display-message' ? String(r.stdout || '').replace(/\tsleep/, '\t' + fleet.CLAUDE_COMMAND) : String(r.stdout || '');
    return { ok: r.status === 0, code: r.status, stdout: out };
  };
  try {
    assert.equal(t('new-session', '-d', '-s', 'zarah', 'sleep 60').status, 0, 'premise: the private tmux server started');
    linkwindow.setRunner(asClaude);
    const onlyPrefix = linkwindow.link('zara', { panes: [{ name: 'zara', session: 'zara', claim: '', command: fleet.CLAUDE_COMMAND, pane: '0.0', title: '' }], platform: 'darwin' });
    assert.equal(onlyPrefix.outcome, 'refused', 'with only zarah running, nothing called zara was linked');
    assert.notEqual(t('show-options', '-v', '-t', '=zarah:', '@kosmos_agent').status, 0, 'zarah was not marked');
    assert.equal(t('new-session', '-d', '-s', 'zara', 'sleep 60').status, 0, 'premise: a session called zara started');
    // The pane reports its shell for a moment before `sleep` starts: wait (bounded) until it shows the program.
    let seen = '';
    for (let i = 0; i < 40 && !/\tsleep/.test(seen); i++) {
      seen = t('display-message', '-p', '-t', '=zara:', '#{session_id}\t#{pane_current_command}').stdout;
      if (!/\tsleep/.test(seen)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
    assert.match(seen, /^\$\d+\tsleep/, 'premise: the look reads id and program');
    const linked = linkwindow.link('zara', { panes: [{ name: 'zara', session: 'zara', claim: '', command: fleet.CLAUDE_COMMAND, pane: '0.0', title: '' }], platform: 'darwin' });
    assert.deepEqual(linked, { outcome: 'linked', session: 'zara', name: 'zara' }, 'a real link through real tmux');
    assert.equal(t('show-options', '-v', '-t', '=zara:', '@kosmos_agent').stdout.trim(), 'zara', 'the mark is on zara');
    assert.notEqual(t('show-options', '-v', '-t', '=zarah:', '@kosmos_agent').status, 0, 'and not on its prefix-named neighbour');
    assert.match(t('list-panes', '-a', '-F', '#{session_name}=#{@kosmos_agent}').stdout, /^zara=zara$/m, 'the board\'s own read sees it');
    /* A session replaced after the look cannot be marked: the id it was looked up by is gone. Measured as link() sends it. */
    const oldId = t('display-message', '-p', '-t', '=zara:', '#{session_id}').stdout.trim();
    t('kill-session', '-t', oldId);
    t('new-session', '-d', '-s', 'zara', 'sleep 60');
    assert.notEqual(t('set-option', '-t', oldId, '@kosmos_agent', 'zara').status, 0, 'the old id marks nothing');
    assert.match(t('list-panes', '-a', '-F', '#{session_name}=#{@kosmos_agent}').stdout, /^zara=$/m, 'and the new zara is unmarked');
  } finally {
    linkwindow.setRunner(null);
    /* kosmos#6857's accepted shape: an -L array literal, so the guard can see the kill names this test's own socket. */
    cp.spawnSync(realTmux, ['-L', sock, 'kill-server'], { encoding: 'utf8', timeout: 10000 });
  }
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
    [panesOf({ session: 'zara', claim: '', command: 'zsh' }), /running zsh, which Kosmos cannot tell is an agent/, 'a crashed pane back at a shell'],
    [panesOf({ session: 'zara', claim: '', command: 'vim' }), /running vim, which Kosmos cannot tell is an agent/, 'an editor under the name'],
    /* kosmos#8724 item 3: a Codex window is linked only for an agent Kosmos knows runs Codex; zara is a Claude agent here. */
    [panesOf({ session: 'zara', claim: '', command: 'codex' }), /running Codex, but Kosmos knows zara as a Claude agent/, 'a Codex window under a Claude agent\'s name'],
    [panesOf({ session: 'zara', claim: '', command: 'node' }), /cannot tell that the window called zara is running an agent/, 'an unmarked node could be any program'],
    [[], /There is no window called zara/, 'nothing running at all'],
  ];
  linkwindow.setExpectedSource(() => 'claude');
  try {
    for (const [panes, why, label] of cases) {
      const r = linkwindow.link('zara', { panes, platform: 'darwin' });
      assert.equal(r.outcome, 'refused', label);
      assert.match(r.because, why, label);
    }
  } finally { linkwindow.setExpectedSource(null); }

  assert.equal(linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '' }), platform: 'win32' }).outcome, 'refused', 'Windows');
  assert.equal(linkwindow.link('  ', { panes: [], platform: 'darwin' }).outcome, 'refused', 'a blank name');
  assert.equal(calls.length, 0, 'a refusal never touched tmux');
});

test('#8719: the roster read fails closed (never "there is no window") when tmux could not be asked or answered nonsense', () => {
  status.setPaneSource(() => null);
  try { assert.throws(() => status.panesWithCommands(), /could not see what is running/); } finally { status.setPaneSource(null); }
  status.setPaneSource(() => 'garbage with no tabs\nmore garbage\n');
  try { assert.throws(() => status.panesWithCommands(), /could not make sense of what came back/); } finally { status.setPaneSource(null); }
  assert.equal(panesOf({ session: 'zara', claim: '' }).length, 1, 'CONTROL: a readable answer is read');
});

test('#8719: every pane carrying the name is checked for a mark, not only the one the board ranks first', () => {
  const panes = [
    { name: 'zara', session: 'zara', claim: '', command: fleet.CLAUDE_COMMAND, pane: '0.0', title: '' },
    { name: 'zara', session: 'zara-discord', claim: '', command: 'zsh', pane: '0.0', title: '' },
  ];
  assert.match(linkwindow.plan('zara', panes, 'darwin').because, /already linked/, 'a -discord sibling is Kosmos\'s by its suffix');
  assert.equal(linkwindow.plan('zara', [panes[0]], 'darwin').ok, true, 'CONTROL: without the sibling it is linkable');
});

test('#8719: a mark naming something else is its own refusal, never "already linked", and is not overwritten', () => {
  const panes = [{ name: 'zara', session: 'zara', claim: 'old-name', command: fleet.CLAUDE_COMMAND, pane: '0.0', title: '' }];
  const p = linkwindow.plan('zara', panes, 'darwin');
  assert.match(p.because, /carries a mark naming old-name, so Kosmos did not change it/);
  assert.doesNotMatch(p.because, /already linked/);
  const calls = fakeTmux({ claimedAtLook: 'something-else' });
  const r = linkwindow.link('zara', { panes: panesOf({ session: 'zara', claim: '' }), platform: 'darwin' });
  assert.match(r.because, /carries a mark naming something-else/, 'found at the look too');
  assert.equal(calls.filter((c) => c[0] === 'set-option').length, 0);
});

test('#8719: a session with another window besides the agent is not linked (the mark covers the whole session)', () => {
  const agent = { name: 'zara', session: 'zara', claim: '', command: fleet.CLAUDE_COMMAND, pane: '0.0', title: '' };
  const editor = { name: 'zara', session: 'zara', claim: '', command: 'vim', pane: '1.0', title: '' };
  const r = linkwindow.plan('zara', [agent, editor], 'darwin');
  assert.match(r.because, /shares its session with 1 other window, which Kosmos could close along with it later/);
  assert.equal(linkwindow.plan('zara', [agent], 'darwin').ok, true, 'CONTROL: the agent alone is linkable');
});
