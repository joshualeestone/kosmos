'use strict';
/**
 * kosmos#4597: the Windows build ships the Plus connector, signed, where the board looks for it.
 *
 * Before this the Windows zip carried no connector at all, and Settings > Kosmos Plus said "the
 * Plus connector is not installed on this computer yet" on every Windows install. The build now
 * takes kosmos-relay's kosmos-tunnel.exe as an input (KOSMOS_TUNNEL_BIN, with its provenance
 * sidecars), refuses one that is missing, mismatched, not a Windows x86-64 program, or unsigned,
 * and stages it at app/bin/kosmos-tunnel.exe.
 *
 * The file checks (tools/lib/connector-windows.sh) are driven here against PE headers built in a
 * temp dir, so they run on any host with bash. The whole build was run on the Windows PC with a
 * real signed connector (the PR says what it printed); it downloads a Node runtime, so no suite
 * runs it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const WIN = fs.readFileSync('tools/build-kosmos-windows.sh', 'utf8');
const LIB = path.resolve('tools/lib/connector-windows.sh');

/* A minimal PE32+ header: enough for the checks, which read only the header fields. */
function pe({ machine = 0x8664, magic = 0x20b, certAddr = 0, certSize = 0 } = {}) {
  const b = Buffer.alloc(512);
  b.write('MZ', 0, 'latin1');
  b.writeUInt32LE(64, 60);
  b.write('PE\0\0', 64, 'latin1');
  b.writeUInt16LE(machine, 68);
  b.writeUInt16LE(magic, 64 + 24);
  b.writeUInt32LE(certAddr, 64 + 24 + 144);
  b.writeUInt32LE(certSize, 64 + 24 + 148);
  return b;
}

function check(fn, bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conn-win-4597-'));
  const f = path.join(dir, 'kosmos-tunnel.exe');
  fs.writeFileSync(f, bytes);
  // Paths go to bash through the environment, never interpolated into the script.
  const r = spawnSync('bash', ['-c', '. "$LIB" && ' + fn + ' "$F"'], {
    env: { ...process.env, LIB: LIB.split(path.sep).join('/'), F: f.split(path.sep).join('/') },
    encoding: 'utf8',
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: r.status, err: String(r.stderr || '') };
}

test('a signed x86-64 Windows connector passes; unsigned, 32-bit and Mac connectors are refused, each saying why', () => {
  assert.equal(check('connector_pe_signed', pe({ certAddr: 400, certSize: 100 })).code, 0);

  const unsigned = check('connector_pe_signed', pe());
  assert.equal(unsigned.code, 1);
  assert.match(unsigned.err, /carries no signature/);

  const x86 = check('connector_pe_signed', pe({ machine: 0x14c, certAddr: 400, certSize: 100 }));
  assert.equal(x86.code, 1);
  assert.match(x86.err, /not an x86-64 program/);

  const pe32 = check('connector_pe_x64', pe({ magic: 0x10b }));
  assert.equal(pe32.code, 1);
  assert.match(pe32.err, /not PE32\+/);

  // The Mac connector (a universal Mach-O) handed to the Windows build by mistake.
  const macho = Buffer.alloc(64); macho.writeUInt32BE(0xcafebabe, 0);
  const mac = check('connector_pe_x64', macho);
  assert.equal(mac.code, 1);
  assert.match(mac.err, /not a Windows program/);
});

test('the Windows build takes the connector as a checked input and stages it where the board looks', () => {
  assert.match(WIN, /TUNNEL_BIN="\$\{KOSMOS_TUNNEL_BIN:-/, 'the connector is not an input');
  assert.match(WIN, /\[ -f "\$TUNNEL_BIN" \] \|\| \{[^\n]*exit 1; \}/, 'a missing connector does not stop the build');
  assert.match(WIN, /_connector_provenance_check "\$TUNNEL_BIN" \|\| exit 1/, 'the sidecars are not checked');
  assert.match(WIN, /connector_pe_signed "\$TUNNEL_BIN" \|\| exit 1/, 'an unsigned connector is not refused');
  assert.match(WIN, /connector_authenticode "\$TUNNEL_BIN" \|\| exit 1/, 'Windows is never asked about the signature');
  assert.match(WIN, /cp "\$TUNNEL_BIN" "\$STAGE\/app\/bin\/kosmos-tunnel\.exe"/, 'the connector is not staged at app/bin/kosmos-tunnel.exe');
  assert.match(WIN, /\*" app\/bin\/kosmos-tunnel\.exe"\$'\\n'\*\) ;;/, 'the zip check does not require the connector');
  // Signed before it is an input, like the launcher: the build itself never signs.
  assert.doesNotMatch(WIN, /signtool|sign\.ps1/i, 'the build signs something; the connector must arrive signed');

  // The place the build stages it is the place remote.js looks on Windows.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conn-app-4597-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin', 'kosmos-tunnel.exe'), 'MZ');
  process.env.AGENT_WORKFORCE_DATA = dir;   // remote.js reads its data root at require
  const remote = require('./engine/remote');
  assert.equal(remote.bundledConnector(dir, 'win32'), path.join(dir, 'bin', 'kosmos-tunnel.exe'));
  fs.rmSync(dir, { recursive: true, force: true });
});
