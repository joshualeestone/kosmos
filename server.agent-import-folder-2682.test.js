'use strict';

/* #2682: POST /api/agent-import-folder reads <dir>/CLAUDE.md and returns its
 * TEXT, the server-side sibling of the client "Choose a file" reader. Unlike
 * /api/agent-import-file it has NO scan-membership gate (the whole point is a
 * folder OUTSIDE any scan), so the read is bounded by: an absolute directory,
 * a CLAUDE.md-only read, and the same hardened symlink-safe / TOCTOU-closing
 * open the file import uses. Parse / validate / create stay downstream in the
 * import textarea's "Bring it in", so this route neither parses nor creates.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-imp-folder-home-'));
process.env.HOME = FAKE_HOME;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-imp-folder-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-imp-folder-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-imp-folder-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-imp-folder-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(FAKE_HOME, 'claude.json');

const { start, server } = require('./server');

let base;
test('boot the board on the loopback bind', async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

const post = async (p, body) => {
  const res = await fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
};

/** A fresh temp directory holding a CLAUDE.md with the given body. */
function folderWithClaudeMd(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-imp-folder-src-'));
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), body);
  return dir;
}

test('a folder with a CLAUDE.md returns its text verbatim for the import box', async () => {
  const body = '# You are Casey Jones\n\nYou answer one question well.\n';
  const dir = folderWithClaudeMd(body);
  const { status, json } = await post('/api/agent-import-folder', { dir });
  assert.equal(status, 200);
  assert.equal(json.ok, true, json.because);
  assert.equal(json.text, body, 'the CLAUDE.md text is returned verbatim so the import box loads it');
  assert.equal(json.dir, dir, 'the folder is echoed back');
});

test('agent-ness is NOT decided here: a plain project CLAUDE.md still returns its text (importLoad refuses it later)', async () => {
  // The endpoint is a safe read, not a parser. A CLAUDE.md that introduces
  // nobody comes back as text, exactly as pasting that text would; the refusal
  // happens downstream at "Bring it in", the same as the paste/choose path.
  const body = '# Just a project doc\n\nno agent identity here\n';
  const dir = folderWithClaudeMd(body);
  const { json } = await post('/api/agent-import-folder', { dir });
  assert.equal(json.ok, true, json.because);
  assert.equal(json.text, body);
});

test('a folder with no CLAUDE.md is refused, naming CLAUDE.md', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-imp-folder-empty-'));
  const { json } = await post('/api/agent-import-folder', { dir });
  assert.equal(json.ok, false);
  assert.match(json.because, /CLAUDE\.md/, 'the refusal says what was missing');
});

test('an empty CLAUDE.md is refused rather than loading a blank box', async () => {
  const dir = folderWithClaudeMd('   \n\t\n');
  const { json } = await post('/api/agent-import-folder', { dir });
  assert.equal(json.ok, false);
  assert.match(json.because, /empty/);
});

test('a symlinked CLAUDE.md is refused (the O_NOFOLLOW / lstat hardening arm)', async () => {
  // The security arm: a CLAUDE.md that is a symlink to a file outside the folder
  // (here, a secret) must never be followed, or the folder read becomes an
  // arbitrary-file read. Mirrors the #1652 file-import TOCTOU test.
  const secret = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-imp-folder-secret-')), 'secret.txt');
  fs.writeFileSync(secret, 'TOP SECRET, must never be read through a symlink\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-imp-folder-link-'));
  fs.symlinkSync(secret, path.join(dir, 'CLAUDE.md'));
  const { json } = await post('/api/agent-import-folder', { dir });
  assert.equal(json.ok, false, 'a symlinked CLAUDE.md must be refused');
  assert.doesNotMatch(String(json.text || ''), /TOP SECRET/, 'the symlink target is never read out');
});

test('a relative path is refused: it would resolve against the board, not the operator', async () => {
  const { json } = await post('/api/agent-import-folder', { dir: 'some/relative/agent' });
  assert.equal(json.ok, false);
  assert.match(json.because, /full path/);
});

test('a path with no folder is refused', async () => {
  const { json } = await post('/api/agent-import-folder', { dir: path.join(os.tmpdir(), 'aw-imp-folder-does-not-exist-zzz') });
  assert.equal(json.ok, false);
  assert.match(json.because, /no folder|not a folder/);
});

test('an empty body names no folder', async () => {
  const { json } = await post('/api/agent-import-folder', {});
  assert.equal(json.ok, false);
  assert.match(json.because, /no folder was named/);
});

test('a path that is a FILE, not a directory, is refused', async () => {
  const f = folderWithClaudeMd('# You are X\n\nbody\n');
  const filePath = path.join(f, 'CLAUDE.md');
  const { json } = await post('/api/agent-import-folder', { dir: filePath });
  assert.equal(json.ok, false);
  assert.match(json.because, /not a folder/);
});

test('closes the board', async () => {
  await new Promise((res) => server.close(res));
});
