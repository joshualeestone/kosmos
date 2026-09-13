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
 * too. The arms that need a real resolved file (openFile does its own folder gates
 * against the real filesystem first) run only where that file has a Windows path.
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

const q = (p) => '"' + p + '"';
const NEEDS_A_WINDOWS_PATH = process.platform !== 'win32'
  && 'openFile resolves a real folder first, so its Windows hand-off needs a Windows path on disk';

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
    assert.deepEqual(calls[0][1], [q(folder)], 'the folder did not arrive as exactly one quoted argument');
    assert.equal(macCalls.length, 0, 'the Mac opener ran on Windows');
  });
});

test('revealFolder on Windows refuses a switch-shaped, relative or network "folder" before any launch', () => {
  onWindowsWith({}, (calls) => {
    for (const bad of ['/select,C:\\Windows\\notepad.exe', 'Projects\\Launch plan', '', '\\\\attacker\\share\\Projects']) {
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

function withRealDocs(names, body) {
  const dir = path.join(SANDBOX, 'docs-' + Math.random().toString(36).slice(2));
  fs.mkdirSync(dir, { recursive: true });
  for (const n of names) fs.writeFileSync(path.join(dir, n), 'x');
  projects.setRevealPlatform('win32');
  const calls = [];
  explorer.setRunner((exe, args) => { calls.push(args); return { ok: true }; });
  try {
    return body(dir, calls);
  } finally {
    projects.setRevealPlatform(null);
    explorer.setRunner(null);
  }
}

test('openFile on Windows hands a document to File Explorer as one quoted path, after its own gates', { skip: NEEDS_A_WINDOWS_PATH }, () => {
  withRealDocs(['notes.docx'], (dir, calls) => {
    assert.deepEqual(projects.openFile(dir, 'notes.docx'), { ok: true });
    assert.deepEqual(calls, [[q(fs.realpathSync.native(path.join(dir, 'notes.docx')))]]);
    /* The name gates are platform-free and still run first. */
    assert.equal(projects.openFile(dir, '..\\secret.txt').ok, false);
    assert.equal(calls.length, 1, 'a refused name reached Explorer');
  });
});

/**
 * NIT 3 (review round 2): a project on a MAPPED drive. `Z:\proj` resolves to
 * `\\server\share\proj`, which no test machine can reach, so the filesystem the project is
 * read through is the seam (realpath, stat and access together) and Explorer's existence
 * check is its own seam. The record path is what the drive-letter rule judges; the
 * resolved target is what the type is judged on.
 */
function mappedDriveWorld(recordFolder, uncFolder, names) {
  const FILE = { isFile: () => true, isDirectory: () => false };
  const DIR = { isFile: () => false, isDirectory: () => true };
  const files = new Set(names);
  const toUnc = (p) => (p.startsWith(recordFolder) ? uncFolder + p.slice(recordFolder.length) : p);
  projects.setFsWorldForTests({
    realpath: (p) => {
      const unc = toUnc(p);
      if (unc === uncFolder || files.has(unc.slice(uncFolder.length + 1))) return unc;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    stat: (p) => (p === uncFolder ? DIR : FILE),
    access: () => {},
  });
  explorer.setStatForTests((p) => (/\.\w+$/.test(p) ? FILE : DIR));
}

test('NIT 3: a document in a project on a mapped drive (Z:\\ resolving to \\\\server\\share) OPENS, handed to Explorer by its Z:\\ name', () => {
  const calls = [];
  projects.setRevealPlatform('win32');
  explorer.setRunner((exe, args) => { calls.push(args); return { ok: true }; });
  mappedDriveWorld('Z:\\proj', '\\\\server\\share\\proj', ['a.pdf', 'b.bat']);
  try {
    assert.deepEqual(projects.openFile('Z:\\proj', 'a.pdf'), { ok: true }, 'a mapped-drive document was refused');
    /* The type is still judged on the resolved target, so the drive letter buys no way around the allow-list. */
    assert.equal(projects.openFile('Z:\\proj', 'b.bat').revealedInstead, true, 'a mapped-drive .bat was opened');
    assert.deepEqual(calls, [['"Z:\\proj\\a.pdf"'], ['/select,"Z:\\proj\\b.bat"']],
      'Explorer was not handed the drive-letter path the project record names');
    /* And the folder button agrees: the same Z:\ folder opens. */
    assert.deepEqual(projects.revealFolder('Z:\\proj'), { ok: true });
  } finally {
    projects.setFsWorldForTests(null);
    projects.setRevealPlatform(null);
    explorer.setRunner(null);
    explorer.setStatForTests(null);
  }
});

test('NIT 3: a project record that names a UNC path ITSELF is still refused, for its documents and its folder', () => {
  const calls = [];
  projects.setRevealPlatform('win32');
  explorer.setRunner((exe, args) => { calls.push(args); return { ok: true }; });
  mappedDriveWorld('\\\\server\\share\\proj', '\\\\server\\share\\proj', ['a.pdf']);
  try {
    const doc = projects.openFile('\\\\server\\share\\proj', 'a.pdf');
    assert.equal(doc.ok, false, 'a literal UNC record opened a document');
    assert.match(doc.because, /not network shares or device paths/);
    assert.equal(projects.revealFolder('\\\\server\\share\\proj').ok, false, 'a literal UNC record opened its folder');
    assert.equal(calls.length, 0, 'a UNC record reached Explorer');
  } finally {
    projects.setFsWorldForTests(null);
    projects.setRevealPlatform(null);
    explorer.setRunner(null);
    explorer.setStatForTests(null);
  }
});

test('SAFETY 1 through the project route: an agent-written .bat is SHOWN, never run, and the answer says why', { skip: NEEDS_A_WINDOWS_PATH }, () => {
  withRealDocs(['Q3 report.pdf.bat'], (dir, calls) => {
    const out = projects.openFile(dir, 'Q3 report.pdf.bat');
    assert.deepEqual(out, { ok: true, revealedInstead: true, say: explorer.REVEALED_INSTEAD_SENTENCE });
    assert.deepEqual(calls, [['/select,' + q(fs.realpathSync.native(path.join(dir, 'Q3 report.pdf.bat')))]]);
  });
});
