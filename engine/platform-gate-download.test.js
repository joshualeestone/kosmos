'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandbox the data root so nothing touches a real store when these modules load.
process.env.AGENT_WORKFORCE_DATA = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dlgate-')), 'data');

const connect = require('./connect');
const runners = require('./runners');

/* kosmos: the provider-binary DOWNLOAD gates. #3159 split them: Claude Code now
 * publishes real Windows builds, so connect.download reads `canDownloadClaude` (darwin
 * + win32) and win32 passes the gate; the Codex runner (runners.install) is still a
 * single `codex-...-darwin-arm64` tgz, so it reads `canDownloadRunner` (darwin only) and
 * win32 is refused there. On a platform with NO published build either gate refuses
 * before any bytes move. Each entry takes the platform as a seam (default
 * process.platform) so both the refusal and the pass-through are testable on this Mac. */

test('connect.download REFUSES a platform with no published Claude build, before any bytes move', async () => {
  // win32 is deliberately NOT here anymore -- Claude publishes a Windows build (the
  // #3159 test below proves win32 passes the gate). Two genuinely-unpublished platforms,
  // each refused with ITS OWN name -> the gate reads the platform parameter and throws at
  // the top before any network fetch. darwin is not exercised (it would proceed into a
  // real download service call); canDownloadClaude('darwin') === true is pinned in
  // platform.test.js, so on macOS the gate is provably skipped.
  await assert.rejects(
    connect.download(() => {}, undefined, 'linux'),
    (e) => /no published Claude Code build/.test(e.message) && /linux/.test(e.message),
    'linux must refuse -- no Claude build is published for it');
  await assert.rejects(
    connect.download(() => {}, undefined, 'aix'),
    (e) => /no published Claude Code build/.test(e.message) && /aix/.test(e.message),
    'aix too, naming itself -- proving the gate reads the param, not a hardcoded platform');
});

test('#3159 connect.download PASSES win32 THROUGH the gate now (Claude publishes a Windows build)', async () => {
  // If win32 were still refused, download() would throw at the gate BEFORE fetching
  // /latest. Point the base at a fake that answers /latest with a non-version, and
  // assert win32 REACHES the version check (and fails there) -- which it can only do by
  // getting past the gate that used to stop it. Deterministic; no real network.
  const http = require('node:http');
  const server = http.createServer((req, res) => { res.writeHead(200); res.end('not-a-version'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const prev = process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE;
  process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(
      connect.download(() => {}, undefined, 'win32'),
      (e) => /did not answer with a version/.test(e.message)
        && !/no published Claude Code build/.test(e.message),
      'win32 reaches the download service (past the gate), then fails on the bad version');
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE;
    else process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE = prev;
    server.close();
  }
});

test('runners.install REFUSES on a non-macOS platform, in the job shape the screen reads', () => {
  const job = runners.install('claude', { platform: 'win32' });
  assert.equal(job.phase, 'failed', 'an unsupported platform must fail the job, not start a download');
  assert.match(job.because, /not supported/);
  assert.match(job.because, /win32/, 'the refusal names the platform, so it is the gate, not a coincidental failure');
});

test('runners.install CONTROL: the platform gate fires BEFORE other checks, and not on macOS', () => {
  // On win32 the platform refusal wins even for an unknown provider (it is checked
  // first). On darwin the SAME unknown provider gets the unknown-provider refusal
  // instead -- proving the platform gate does not fire on a supported OS, with no
  // download in either arm.
  const win = runners.install('nonesuch', { platform: 'win32' });
  assert.match(win.because, /not supported/, 'win32 hits the platform gate first');

  const mac = runners.install('nonesuch', { platform: 'darwin' });
  assert.equal(mac.phase, 'failed');
  assert.match(mac.because, /do not know how to install/, 'darwin falls through to the unknown-provider refusal');
  assert.doesNotMatch(mac.because, /not supported/, 'the platform gate must NOT fire on macOS');
});
