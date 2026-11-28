'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#8378 group 5: test-support/faketmux-win.js, the Windows stand-in for fake tmux's reads, and its board-child
 * preload. Pinned here, on every host:
 *   - off Windows it does nothing, so macOS and Linux tests still run the script;
 *   - asked to act as Windows, it answers what test-support/fake-tmux.sh answers, from the same files and defaults;
 *   - server.js still wires the two factories the preload replaces (win32roster.make, win32capture.make), so a rename
 *     there cannot make the preload silently stop applying in a board child.
 *
 *   node --test server.faketmux-win-8378.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-faketmux-win-8378-'));
const PANES = path.join(SANDBOX, 'panes.txt');
const SCREEN = path.join(SANDBOX, 'screen.txt');
// fake tmux, so a pane-session question that falls through (a broken stand-in) never asks this Mac's real tmux
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
const win = require('./test-support/faketmux-win');

test('off Windows it does nothing: no seam installed, and a board child keeps its argv', () => {
  assert.equal(win.serveOnWindows('darwin'), false);
  assert.equal(win.serveOnWindows('linux'), false);
  assert.deepEqual(win.current(), { source: null, capture: null }, 'a seam was installed off Windows');
  assert.deepEqual(win.childArgs('darwin'), []);
  assert.deepEqual(win.childArgs('linux'), []);
  const args = win.childArgs('win32');
  assert.equal(args[0], '--require');
  assert.ok(fs.existsSync(args[1]), 'the preload the Windows argv names does not exist: ' + args[1]);
});

test('asked to act as Windows, it answers what fake-tmux.sh answers, from the same files and defaults', () => {
  const status = require('./engine/status');
  const messages = require('./engine/messages');
  const was = { panes: process.env.AGENT_WORKFORCE_FAKE_PANES, screen: process.env.AGENT_WORKFORCE_FAKE_SCREEN };
  try {
    delete process.env.AGENT_WORKFORCE_FAKE_PANES;
    delete process.env.AGENT_WORKFORCE_FAKE_SCREEN;
    // Spies on the two engine seams (round 4: without them, deleting either install call passed): the helper must hand
    // engine/status exactly the reads current() reports.
    const real = { src: status.setPaneSource, cap: status.setPaneCapture };
    const got = {};
    status.setPaneSource = (fn) => { got.src = fn; return real.src(fn); };
    status.setPaneCapture = (fn) => { got.cap = fn; return real.cap(fn); };
    try { assert.equal(win.serveOnWindows('win32'), true); } finally { status.setPaneSource = real.src; status.setPaneCapture = real.cap; }
    const { source, capture } = win.current();
    assert.ok(typeof source === 'function' && got.src === source, 'the pane list was not installed in engine/status');
    assert.ok(typeof capture === 'function' && got.cap === capture, 'the screen was not installed in engine/status');
    assert.equal(source(), '', 'with no panes file the board is empty, as the script says');
    assert.equal(capture('x:0.0'), '', 'with no screen file the screen is empty');
    fs.writeFileSync(PANES, 'line one\nline two\n');
    fs.writeFileSync(SCREEN, 'a screen');
    process.env.AGENT_WORKFORCE_FAKE_PANES = PANES;
    process.env.AGENT_WORKFORCE_FAKE_SCREEN = SCREEN;
    assert.equal(source(), 'line one\nline two\n');
    fs.writeFileSync(PANES, 'rewritten\n');
    assert.equal(source(), 'rewritten\n', 'the panes file is read on every call, as the script reads it');
    assert.equal(capture('any:0.0'), 'a screen');
    process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'missing.txt');
    assert.equal(source(), '', 'a missing file reads as an empty board, never a failure');
    // The script answers display-message #{session_name} with fixture-discord for any pane.
    assert.deepEqual(messages.paneSession('%9'), { ok: true, session: 'fixture-discord' }, 'the pane-session question is not answered as the script answers it');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
    messages.setRunner(null);
    win.reset();   // round 4: the helper's own state too, so a later fleet.restore() in this process returns to none
    if (was.panes === undefined) delete process.env.AGENT_WORKFORCE_FAKE_PANES; else process.env.AGENT_WORKFORCE_FAKE_PANES = was.panes;
    if (was.screen === undefined) delete process.env.AGENT_WORKFORCE_FAKE_SCREEN; else process.env.AGENT_WORKFORCE_FAKE_SCREEN = was.screen;
  }
});

test('server.js still wires the two factories the board-child preload replaces', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(src, /setPaneSource\(require\('\.\/engine\/win32roster'\)\.make\(\)\)/, 'the Windows roster is no longer wired as win32roster.make(): test-support/faketmux-win-preload.js would stop applying');
  assert.match(src, /setPaneCapture\(require\('\.\/engine\/win32capture'\)\.make\(/, 'the Windows capture is no longer wired as win32capture.make(...): test-support/faketmux-win-preload.js would stop applying');
});

test('in a board child, installForChild has win32roster.make and win32capture.make hand back the same reads', () => {
  const status = require('./engine/status');
  const messages = require('./engine/messages');
  const roster = require('./engine/win32roster');
  const cap = require('./engine/win32capture');
  const was = { make: roster.make, capMake: cap.make };
  try {
    assert.equal(win.installForChild('darwin'), false, 'it acted off Windows');
    assert.equal(roster.make, was.make, 'win32roster.make was replaced off Windows');
    assert.equal(cap.make, was.capMake, 'win32capture.make was replaced off Windows');
    assert.equal(win.installForChild('win32'), true);
    const { source, capture } = win.current();
    assert.equal(roster.make(), source, 'the board child would wire its own Windows roster, not the fixture');
    assert.equal(cap.make({ lastState: null }), capture, 'the board child would wire its own Windows capture, not the fixture');
    const preload = fs.readFileSync(path.join(__dirname, 'test-support', 'faketmux-win-preload.js'), 'utf8');
    assert.match(preload, /require\('\.\/faketmux-win'\)\.installForChild\(\)/, 'the preload no longer runs installForChild');
  } finally {
    roster.make = was.make;
    cap.make = was.capMake;
    status.setPaneSource(null);
    status.setPaneCapture(null);
    messages.setRunner(null);
    win.reset();
  }
});

test('reset() forgets what the helper installed', () => {
  const status = require('./engine/status');
  const messages = require('./engine/messages');
  try {
    assert.equal(win.serveOnWindows('win32'), true);
    assert.equal(typeof win.current().source, 'function', 'CONTROL: something was installed to forget');
    win.reset();
    assert.deepEqual(win.current(), { source: null, capture: null }, 'reset kept the helper state');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
    messages.setRunner(null);
    win.reset();
  }
});

test('fleet.restore() returns to the stand-in once it is installed, and to none after reset()', () => {
  const status = require('./engine/status');
  const messages = require('./engine/messages');
  const fleet = require('./test-support/fleet');
  const real = status.setPaneSource;
  const seen = [];
  try {
    assert.equal(win.serveOnWindows('win32'), true);
    const { source } = win.current();
    status.setPaneSource = (fn) => { seen.push(fn); return real(fn); };
    fleet.restore();
    assert.equal(seen.pop(), source, 'fleet.restore() dropped the stand-in (on Windows the board would read a tmux it cannot run)');
    win.reset();
    fleet.restore();
    assert.equal(seen.pop(), null, 'CONTROL: with nothing installed, fleet.restore() still puts back none, as before');
  } finally {
    status.setPaneSource = real;
    status.setPaneSource(null);
    status.setPaneCapture(null);
    messages.setRunner(null);
    win.reset();
  }
});
