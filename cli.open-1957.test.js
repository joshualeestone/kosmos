'use strict';
/**
 * kosmos#1957. `kosmos open` with no argument was SILENCE PLUS EXIT 0. cmd_open
 * ran `exec /usr/bin/open "$URL"`, which prints nothing on success and, on a Mac
 * with no display, exits 0 while nothing visibly opens. From the CLI it was
 * indistinguishable from a command that worked, and the reporter (no screen)
 * could not tell whether the product was broken.
 *
 * The fix: SAY what it is doing, with the URL (a person with no browser can go
 * there themselves), and CHECK the opener's result via the KOSMOS_OPEN_BIN seam
 * instead of exec-ing it, so a real failure is named and exits non-zero.
 *
 * Each arm starts a fake board (a page whose body contains "Kosmos") so
 * healthy() passes and cmd_open skips cmd_start, and stubs the browser opener so
 * nothing real is launched. The last test is the load-bearing control: it pins
 * that neither arm reproduces the silent-exit-0 the card is about.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');

/* healthy() curls URL/ and passes if the body contains "Kosmos" or
   "Agent Workforce"; this fake board answers every request with such a page, so
   cmd_open sees a healthy board and does not try to start one. */
function fakeBoard() {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><title>Kosmos</title><body>Agent Workforce</body></html>');
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* A stub browser-opener: records the args it was handed and exits with a chosen
   code, so we can drive both the success and the failure path with no real
   /usr/bin/open and no real browser. */
function stubOpen(exitCode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-open-1957-'));
  const bin = path.join(dir, 'fake-open');
  const marker = path.join(dir, 'called-with');
  fs.writeFileSync(bin, `#!/bin/bash\nprintf '%s\\n' "$@" > "${marker}"\nexit ${exitCode}\n`, { mode: 0o755 });
  return { bin, marker, dir };
}

function runOpen(env) {
  return new Promise((resolve) => {
    execFile('bash', [CLI, 'open'], { env, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, out: stdout, err: stderr });
    });
  });
}

test('#1957: `kosmos open` announces the dashboard and exits 0 when the browser opens', async () => {
  const { server, port } = await fakeBoard();
  const { bin, marker, dir } = stubOpen(0);
  try {
    const r = await runOpen({ ...process.env, KOSMOS_PORT: String(port), KOSMOS_OPEN_BIN: bin });
    assert.equal(r.code, 0, 'a successful open should exit 0');
    assert.match(r.out, /Opening the dashboard at http:\/\/127\.0\.0\.1:/,
      'it must SAY what it is doing (the #1957 defect was silence)');
    assert.match(fs.readFileSync(marker, 'utf8'), /^http:\/\/127\.0\.0\.1:/m,
      'the opener was not actually handed the board URL');
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#1957: `kosmos open` names the failure and exits non-zero when the browser cannot open', async () => {
  const { server, port } = await fakeBoard();
  const { bin, dir } = stubOpen(3);
  try {
    const r = await runOpen({ ...process.env, KOSMOS_PORT: String(port), KOSMOS_OPEN_BIN: bin });
    assert.notEqual(r.code, 0, 'a failed open must NOT exit 0 (that is the #1957 defect)');
    assert.match(r.err, /Could not open a browser/, 'it must name the failure');
    assert.match(r.err, /http:\/\/127\.0\.0\.1:/, 'it must give the URL to open manually');
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#1957 CONTROL: `kosmos open` is never silent-plus-exit-0, whichever way open goes', async () => {
  for (const exitCode of [0, 3]) {
    const { server, port } = await fakeBoard();
    const { bin, dir } = stubOpen(exitCode);
    try {
      const r = await runOpen({ ...process.env, KOSMOS_PORT: String(port), KOSMOS_OPEN_BIN: bin });
      const silent = r.out.trim() === '' && r.err.trim() === '';
      assert.equal(silent && r.code === 0, false,
        `open exit ${exitCode}: reproduced the silent-exit-0 defect the card is about`);
    } finally {
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});
