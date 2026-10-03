'use strict';
/**
 * #5165 on a WINDOWS board. Over Kosmos+ a file click downloads, and the download routes
 * (/api/project/:id/file-download, /api/agent/:name/files/download) hand out the file
 * projects.fileInFolder resolves. This file tests that gate on Windows; it does not boot the
 * server, so the routes' own glue is covered by server.file-download-5165.test.js on a Mac. The user who found it was on Windows
 * (Josh, 2026-10-03 12:48), so the gate must hold where the board runs on Windows. "win32" in
 * this name puts it in the windows CI job (tools/windows-tests.js), on a real Windows runner;
 * on a Mac it runs too, with the reveal platform set to win32 where that matters.
 *   W1  the name listFiles gives for a file in a subfolder (what the page sends) resolves to that
 *       file and reads back its exact bytes (on Windows the folder is backslashed and the names
 *       are not, so this is where a separator slip would show);
 *   W2  a name in Windows form (backslashes, a drive letter, a UNC path, the folder's own
 *       absolute path) is refused by the gate the routes use;
 *   W3  the gate itself asks neither File Explorer nor /usr/bin/open for anything;
 *   W4  at the computer, openFile on a Windows board still hands the same file to File Explorer
 *       (needs a real Windows path, so the Windows runner only).
 *
 *   node --test engine/projects.download.win32-5165.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-w32dl-'));
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

const DECK = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x0d, 0x0a, 0x00, 0xff, 0x5c]);   // a CRLF and a backslash byte inside

function deckFolder() {
  const folder = fs.mkdtempSync(path.join(SANDBOX, 'deck-'));
  fs.mkdirSync(path.join(folder, 'decks'));
  fs.writeFileSync(path.join(folder, 'decks', 'Q3 deck.pptx'), DECK);
  return folder;
}

function onWindowsBoard(body) {
  const explorerCalls = [];
  const openCalls = [];
  projects.setRevealPlatform('win32');
  projects.setRevealRunner((bin, args) => { openCalls.push([bin, args]); return { ok: true }; });
  explorer.setRunner((exe, args) => { explorerCalls.push([exe, args]); return { ok: true }; });
  try {
    return body(explorerCalls, openCalls);
  } finally {
    projects.setRevealPlatform(null);
    projects.setRevealRunner(null);
    explorer.setRunner(null);
  }
}

test('W1 + W3: the list\u2019s own name for a file in a subfolder resolves to it and reads back its exact bytes; nothing opens', () => {
  const folder = deckFolder();
  onWindowsBoard((explorerCalls, openCalls) => {
    const listed = projects.listFiles(folder, 50);
    const entry = (listed.files || []).find((f) => /Q3 deck\.pptx$/.test(f.name));
    assert.ok(entry, 'the list did not show the deck: ' + JSON.stringify(listed));
    const found = projects.fileInFolder(folder, entry.name);
    assert.equal(found.ok, true, 'the list\u2019s own name ' + JSON.stringify(entry.name) + ' was refused: ' + found.because);
    assert.equal(found.st.size, DECK.length);
    assert.equal(path.basename(found.given), 'Q3 deck.pptx', 'the download would be named something else');
    assert.deepEqual(fs.readFileSync(found.target), DECK, 'the bytes changed (a text-mode read would turn the CRLF)');
    assert.equal(explorerCalls.length + openCalls.length, 0, 'resolving a download asked this computer to open or show something');
  });
});

test('W2: a name in Windows form is refused, so the download route reads nothing', () => {
  const folder = deckFolder();
  const outside = fs.mkdtempSync(path.join(SANDBOX, 'outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'not yours');
  for (const name of [
    'decks\\Q3 deck.pptx',
    '..\\' + path.basename(outside) + '\\secret.txt',
    path.join(outside, 'secret.txt'),
    'C:\\Windows\\win.ini',
    'C:/Windows/win.ini',
    '\\\\server\\share\\secret.txt',
    path.join(folder, 'decks', 'Q3 deck.pptx'),
  ]) {
    const found = projects.fileInFolder(folder, name);
    assert.equal(found.ok, false, 'accepted ' + JSON.stringify(name));
    assert.match(found.because, /not a file in this project/, JSON.stringify(name));
  }
});

test('W4: at the computer, opening the same file on a Windows board still goes to File Explorer, never /usr/bin/open', {
  skip: process.platform !== 'win32' && 'openFile resolves a real folder first, so its File Explorer hand-off needs a Windows path on disk',
}, () => {
  const folder = deckFolder();
  onWindowsBoard((explorerCalls, openCalls) => {
    const out = projects.openFile(folder, 'decks/Q3 deck.pptx');
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(explorerCalls.length, 1, 'File Explorer was not asked to open it');
    assert.equal(openCalls.length, 0, '/usr/bin/open was asked on a Windows board');
  });
});
