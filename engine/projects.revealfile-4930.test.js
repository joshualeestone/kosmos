'use strict';
/**
 * kosmos#4930: the full-page preview's "Open in Finder" shows ONE file selected in its folder, and never opens it.
 * On a Mac: `/usr/bin/open -R <file>`. On Windows: File Explorer with `/select,"<file>"`, through win32explorer's own
 * path checks. No real Finder or Explorer: the runner seams stand in for the spawn.
 *
 *   node --test engine/projects.revealfile-4930.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-revealfile-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');
const explorer = require('./win32explorer');

test('on a Mac the file is selected in Finder (open -R), never opened', () => {
  const calls = [];
  projects.setRevealPlatform('darwin');
  projects.setRevealRunner((bin, args) => { calls.push([bin, args]); return { ok: true }; });
  try {
    const file = '/Users/someone/Library/Application Support/Kosmos/attachments/agent/ava/0123456789abcdef01234567/shot.png';
    assert.deepEqual(projects.revealFile(file), { ok: true });
    assert.deepEqual(calls, [['/usr/bin/open', ['-R', file]]], 'not exactly one open -R of that file');
  } finally { projects.setRevealPlatform(null); projects.setRevealRunner(null); }
});

test('on Windows the file is selected in File Explorer (/select), never opened, and never through /usr/bin/open', () => {
  const calls = [];
  const macCalls = [];
  projects.setRevealPlatform('win32');
  projects.setRevealRunner((bin, args) => { macCalls.push([bin, args]); return { ok: true }; });
  explorer.setRunner((exe, args) => { calls.push([exe, args]); return { ok: true }; });
  explorer.setStatForTests(() => ({ isDirectory: () => false, isFile: () => true }));
  try {
    const file = 'C:\\Users\\someone\\AppData\\Roaming\\Kosmos\\attachments\\agent\\ava\\0123456789abcdef01234567\\shot.png';
    assert.deepEqual(projects.revealFile(file), { ok: true });
    assert.equal(calls.length, 1);
    assert.match(calls[0][0], /\\explorer\.exe$/i);
    assert.deepEqual(calls[0][1], ['/select,"' + file + '"']);
    assert.equal(macCalls.length, 0, 'the Mac opener ran on Windows');
    for (const bad of ['/select,C:\\Windows\\notepad.exe', 'relative\\shot.png', '', '\\\\attacker\\share\\shot.png']) {
      assert.equal(projects.revealFile(bad).ok, false, 'accepted ' + JSON.stringify(bad));
    }
    assert.equal(calls.length, 1, 'a refused path reached Explorer');
  } finally {
    projects.setRevealPlatform(null); projects.setRevealRunner(null); explorer.setRunner(null); explorer.setStatForTests(null);
  }
});

test('a failed open says Finder did not open; a programming error is not dressed as one', () => {
  projects.setRevealPlatform('darwin');
  try {
    projects.setRevealRunner(() => { throw new Error('exit 1'); });
    assert.deepEqual(projects.revealFile('/tmp/x.png'), { ok: false, because: 'Finder did not open' });
    projects.setRevealRunner(() => { throw new TypeError('ours'); });
    assert.throws(() => projects.revealFile('/tmp/x.png'), TypeError);
  } finally { projects.setRevealPlatform(null); projects.setRevealRunner(null); }
});
