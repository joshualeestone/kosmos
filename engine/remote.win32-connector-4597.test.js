'use strict';
/**
 * kosmos#4597: the Plus connector on Windows.
 *
 * The Windows app ships the connector as app\bin\kosmos-tunnel.exe. remote.js looked for the
 * extensionless Mac name, found nothing, fell back to a bare name on a PATH that holds no
 * connector, and Settings > Kosmos Plus said "the Plus connector is not installed on this
 * computer yet" on every Windows install.
 *
 * The first two tests run on every host (a Windows app laid out in a temp dir; the spawn options
 * through the setupRun seam). The third spawns a REAL Windows .exe through remote.js's own
 * spawn, from a folder with spaces in its name, so it runs on Windows only: a copy of this
 * node.exe named kosmos-tunnel.exe, told by NODE_OPTIONS to preload a stand-in that records
 * its argv and answers like the connector. Nothing reaches a network.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-remote-4597-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
// Every connector call in this file goes to a stand-in, never the real bundled tunnel.
process.env.AGENT_WORKFORCE_TUNNEL_BIN = path.join(SANDBOX, 'no-such-kosmos-tunnel');
process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'http://127.0.0.1:9';
const remote = require('./remote');

test.after(() => {
  remote.resetForTests();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

test('a Windows app keeps its connector at bin\\kosmos-tunnel.exe, and that is where it is looked for', () => {
  const win = fs.mkdtempSync(path.join(SANDBOX, 'win-app-'));
  fs.mkdirSync(path.join(win, 'bin'));
  fs.writeFileSync(path.join(win, 'bin', 'kosmos-tunnel.exe'), 'MZ');
  assert.equal(remote.bundledConnector(win, 'win32'), path.join(win, 'bin', 'kosmos-tunnel.exe'));
  // The Mac name is not what a Windows app ships; a Mac app carries no .exe.
  assert.equal(remote.bundledConnector(win, 'darwin'), null, 'a Mac looked for the Windows file');

  const mac = fs.mkdtempSync(path.join(SANDBOX, 'mac-app-'));
  fs.mkdirSync(path.join(mac, 'bin'));
  fs.writeFileSync(path.join(mac, 'bin', 'kosmos-tunnel'), '#!');
  assert.equal(remote.bundledConnector(mac, 'darwin'), path.join(mac, 'bin', 'kosmos-tunnel'), 'the Mac lookup moved');
  // The bug itself: on Windows the extensionless file is not the connector.
  assert.equal(remote.bundledConnector(mac, 'win32'), null);
});

test('every Plus verb starts the connector hidden (no console window flashes up on Windows) and never through a shell', async () => {
  const seen = [];
  remote.setSetupSpawnForTests((bin, args, opts) => {
    seen.push({ bin, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => { child.emit('exit', 0); child.emit('close', 0); });
    return child;
  });
  try {
    const r = await remote.setupStart('delivered@resend.dev');
    assert.equal(r.ok, true, JSON.stringify(r));
  } finally {
    remote.resetForTests();
  }
  assert.equal(seen.length, 1);
  assert.equal(seen[0].opts.windowsHide, true, 'the connector would open a console window on Windows');
  assert.ok(!seen[0].opts.shell, 'the connector must not go through a shell');
});

test('on Windows a real kosmos-tunnel.exe in a folder with spaces is spawned with its arguments intact', { skip: process.platform !== 'win32' && 'spawns a Windows .exe' }, async () => {
  const appBin = path.join(SANDBOX, 'Program Files x', 'Kosmos', 'bin');
  fs.mkdirSync(appBin, { recursive: true });
  const exe = path.join(appBin, 'kosmos-tunnel.exe');
  fs.copyFileSync(process.execPath, exe);
  const record = path.join(SANDBOX, 'argv.json');
  const standIn = path.join(SANDBOX, 'standin.js');
  fs.writeFileSync(standIn, `
    const fs = require('node:fs');
    // node resolves its first argument as a script path; the name is what the connector would see.
    const argv = process.argv.slice(1).map((a, i) => (i === 0 ? require('node:path').basename(a) : a));
    fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify(argv));
    process.stdout.write('if the address is reachable, a code is on its way\\n');
    process.exit(0);
  `);
  const saved = { bin: process.env.AGENT_WORKFORCE_TUNNEL_BIN, opts: process.env.NODE_OPTIONS };
  process.env.AGENT_WORKFORCE_TUNNEL_BIN = exe;
  // NODE_OPTIONS reads backslashes as escapes, so the path goes with forward slashes.
  process.env.NODE_OPTIONS = `--require "${standIn.split(path.sep).join('/')}"`;
  let r;
  try {
    r = await remote.setupStart('delivered@resend.dev');
  } finally {
    for (const [k, v] of [['AGENT_WORKFORCE_TUNNEL_BIN', saved.bin], ['NODE_OPTIONS', saved.opts]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
  assert.equal(r.ok, true, 'the .exe did not run: ' + JSON.stringify(r));
  const argv = JSON.parse(fs.readFileSync(record, 'utf8'));
  assert.deepEqual(argv.slice(0, 2), ['setup', 'start'], JSON.stringify(argv));
  assert.equal(argv[argv.indexOf('--email') + 1], 'delivered@resend.dev');
  assert.equal(argv[argv.indexOf('--coordinator') + 1], 'http://127.0.0.1:9');
});
