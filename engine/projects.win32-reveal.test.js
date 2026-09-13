'use strict';
/**
 * win32-board-copy (parity P0-6, installer audit W-19): a project's folder and files
 * open in File Explorer on Windows.
 *
 * 🛑 THEY USED TO CALL /usr/bin/open, WHICH IS NOT THERE. "Open this folder in Finder"
 * answered "Finder did not open" on every Windows board, and the Documents list could
 * open nothing at all.
 *
 * ⚠️ NO REAL EXPLORER. The launcher's runner seam stands in for the spawn, and the
 * folder is a Windows path with an injected existence check, so a Mac asserts this arm
 * too. The one arm that needs a real resolved file (openFile does its own folder gates
 * against the real filesystem first) runs only where that file has a Windows path.
 *
 *   node --test engine/projects.win32-reveal.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-w32reveal-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.on('exit', () => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');
const explorer = require('./win32explorer');

function onWindowsWith(seams, body) {
  const calls = [];
  const macCalls = [];
  projects.setRevealPlatform('win32');
  projects.setRevealRunner((bin, args) => { macCalls.push([bin, args]); return { ok: true }; });
  explorer.setRunner((exe, args) => { calls.push([exe, args]); return seams.result || { ok: true }; });
  explorer.setStatForTests(seams.stat || (() => ({ isDirectory: () => true, isFile: () => false })));
  try {
    return body(calls, macCalls);
  } finally {
    projects.setRevealPlatform(null);
    projects.setRevealRunner(null);
    explorer.setRunner(null);
    explorer.setStatForTests(null);
  }
}

test('revealFolder on Windows opens the folder in File Explorer, never /usr/bin/open', () => {
  const folder = 'C:\\Users\\someone\\Kosmos\\Projects\\Launch plan';
  onWindowsWith({}, (calls, macCalls) => {
    assert.deepEqual(projects.revealFolder(folder), { ok: true });
    assert.equal(calls.length, 1);
    assert.match(calls[0][0], /\\explorer\.exe$/i);
    assert.deepEqual(calls[0][1], [folder], 'the folder did not arrive as exactly one argument');
    assert.equal(macCalls.length, 0, 'the Mac opener ran on Windows');
  });
});

test('revealFolder on Windows refuses a switch-shaped or relative "folder" before any launch', () => {
  onWindowsWith({}, (calls) => {
    for (const bad of ['/select,C:\\Windows\\notepad.exe', 'Projects\\Launch plan', '']) {
      const out = projects.revealFolder(bad);
      assert.equal(out.ok, false, `accepted ${JSON.stringify(bad)}`);
    }
    assert.equal(calls.length, 0, 'a refused folder reached Explorer');
  });
});

test('a failed launch on Windows names File Explorer, not Finder', () => {
  onWindowsWith({ result: { ok: false, because: explorer.EXPLORER_DID_NOT_OPEN } }, () => {
    const out = projects.revealFolder('C:\\Users\\someone\\Kosmos');
    assert.equal(out.ok, false);
    assert.equal(out.because, 'File Explorer did not open');
    assert.doesNotMatch(out.because, /Finder/);
  });
});

test('CONTROL: with the platform stated as darwin the Mac opener still runs, unchanged', () => {
  const calls = [];
  projects.setRevealPlatform('darwin');
  projects.setRevealRunner((bin, args) => { calls.push([bin, args]); return { ok: true }; });
  explorer.setRunner(() => { throw new Error('Explorer must not be reached on the Mac arm'); });
  try {
    assert.deepEqual(projects.revealFolder('/Users/someone/Kosmos/Projects/Launch plan'), { ok: true });
    assert.deepEqual(calls, [['/usr/bin/open', ['/Users/someone/Kosmos/Projects/Launch plan']]]);
  } finally {
    projects.setRevealPlatform(null);
    projects.setRevealRunner(null);
    explorer.setRunner(null);
  }
});

test('openFile on Windows hands the resolved file to File Explorer after its own gates', {
  skip: process.platform !== 'win32' && 'openFile resolves a real folder first, so its Windows hand-off needs a Windows path on disk',
}, () => {
  const dir = path.join(SANDBOX, 'docs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'notes.docx'), 'x');
  projects.setRevealPlatform('win32');
  const calls = [];
  explorer.setRunner((exe, args) => { calls.push(args); return { ok: true }; });
  try {
    assert.deepEqual(projects.openFile(dir, 'notes.docx'), { ok: true });
    assert.deepEqual(calls, [[fs.realpathSync(path.join(dir, 'notes.docx'))]]);
    /* The name gates are platform-free and still run first. */
    assert.equal(projects.openFile(dir, '..\\secret.txt').ok, false);
    assert.equal(calls.length, 1, 'a refused name reached Explorer');
  } finally {
    projects.setRevealPlatform(null);
    explorer.setRunner(null);
  }
});
