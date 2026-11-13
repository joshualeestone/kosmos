'use strict';
/**
 * kosmos#8506: an agent's working rules hold only its own platform's lines. A Windows agent got the macOS tmux
 * permission box, and a Mac agent the PowerShell forms. The board writes an agent's instructions on the computer the
 * agent runs on, so the module is loaded here as each platform's board loads it (process.platform set before the
 * require, in a child), and what appendTo writes into a new agent's file is read back.
 *
 *   node --test engine/defaults.platform-8506.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEFAULTS = path.join(__dirname, 'defaults.js');
/** What appendTo writes into a new agent's file on a board that reports `platform`. */
function writtenOn(platform) {
  const script = `Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });
    const d = require(${JSON.stringify(DEFAULTS)});
    process.stdout.write(JSON.stringify({ file: d.appendTo('# An agent\\n'), block: d.block(), sections: d.sections().map((s) => s.heading) }));`;
  return JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }));
}

const MAC_ONLY = /\btmux\b|\bthis Mac\b|\byour Mac\b|### When your work reaches outside your own folder/;
const WINDOWS_ONLY = /PowerShell|here-string|@'/;

test('a Windows agent gets no macOS-only line, and keeps the PowerShell forms it needs', () => {
  const w = writtenOn('win32');
  assert.doesNotMatch(w.file, MAC_ONLY, 'a Windows agent was written a macOS-only line');
  assert.match(w.file, /\*\*Only if your commands run in PowerShell\*\*/, 'a Windows agent lost the PowerShell paragraph');
  assert.match(w.file, /in PowerShell, use the here-string under "Formatted messages need\nline breaks"/);
  assert.equal(w.sections.includes('### When your work reaches outside your own folder'), false);
});

test('a Mac agent gets no Windows-only line, and keeps the tmux permission box it needs', () => {
  const m = writtenOn('darwin');
  assert.doesNotMatch(m.file, WINDOWS_ONLY, 'a Mac agent was written a Windows-only line');
  assert.match(m.file, /### When your work reaches outside your own folder\n\nThe first time you touch a folder like Desktop or Documents, this Mac may/);
  assert.match(m.file, /give it on stdin instead \(the shell trap under "Send readable\nmessages"\)\.\n/, 'the pointer no longer ends cleanly without its PowerShell half');
});

test('a Linux agent gets neither: no tmux permission box (a macOS prompt) and no PowerShell forms', () => {
  const l = writtenOn('linux');
  assert.doesNotMatch(l.file, MAC_ONLY);
  assert.doesNotMatch(l.file, WINDOWS_ONLY);
});

test('every platform keeps every shared section, in the same order, and no marker reaches an agent', () => {
  const by = Object.fromEntries(['darwin', 'linux', 'win32'].map((p) => [p, writtenOn(p)]));
  const shared = by.darwin.sections.filter((h) => h !== '### When your work reaches outside your own folder');
  assert.deepEqual(by.linux.sections, shared);
  assert.deepEqual(by.win32.sections, shared);
  for (const [p, w] of Object.entries(by)) {
    assert.doesNotMatch(w.file, /\u0000|kosmos-only/, p + ': a platform marker reached the agent');
    assert.doesNotMatch(w.file, /\n\n\n/, p + ': cutting a platform part left a doubled blank line');
    assert.ok(w.file.includes(w.block), p + ': appendTo wrote a different block than block() returns');
  }
  // CONTROL: the three blocks really differ, so the checks above compare different texts.
  assert.notEqual(by.darwin.block, by.win32.block);
  assert.notEqual(by.darwin.block, by.linux.block);
});

test('blockFor in this process composes the same text a board on that platform writes', () => {
  const d = require('./defaults');
  for (const p of d.PLATFORMS) assert.equal(d.blockFor(p), writtenOn(p).block, p);
  assert.equal(d.block(), d.blockFor(process.platform), 'block() is not this board\'s own platform');
});
