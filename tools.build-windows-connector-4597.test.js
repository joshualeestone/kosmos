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

/* #6679: the launcher is a C# AnyCPU build, a PE32 with machine i386, so the connector's x86-64 check refuses it
   whatever its signature. pe_signature_present reads the certificate table for either format. */
function pe32({ certAddr = 0, certSize = 0 } = {}) {
  const b = pe({ machine: 0x14c, magic: 0x10b });
  b.writeUInt32LE(certAddr, 64 + 24 + 128);
  b.writeUInt32LE(certSize, 64 + 24 + 132);
  return b;
}

test('#6679: pe_signature_present sees a signature on a 32-bit or a 64-bit PE, and refuses one without', () => {
  assert.equal(check('pe_signature_present', pe32({ certAddr: 400, certSize: 100 })).code, 0);
  assert.equal(check('pe_signature_present', pe({ certAddr: 400, certSize: 100 })).code, 0);
  /* The control: the connector's own check refuses that same signed PE32, which is why the launcher needs this one. */
  assert.match(check('connector_pe_signed', pe32({ certAddr: 400, certSize: 100 })).err, /not an x86-64 program/);
  /* A PE32 whose PE32+ offsets happen to be non-zero is still unsigned: the right table is read. */
  const offByFormat = pe32();
  offByFormat.writeUInt32LE(400, 64 + 24 + 144); offByFormat.writeUInt32LE(100, 64 + 24 + 148);
  const wrongTable = check('pe_signature_present', offByFormat);
  assert.equal(wrongTable.code, 1);
  assert.match(wrongTable.err, /carries no signature/);
  for (const bytes of [pe32(), pe()]) assert.match(check('pe_signature_present', bytes).err, /carries no signature/);
  assert.match(check('pe_signature_present', pe({ magic: 0x107 })).err, /unknown optional header/);
  const macho = Buffer.alloc(64); macho.writeUInt32BE(0xcafebabe, 0);
  assert.match(check('pe_signature_present', macho).err, /not a Windows program/);
  /* And the committed launcher itself, which the zip's read-me says is signed. */
  assert.equal(check('pe_signature_present', fs.readFileSync('tools/windows/Kosmos.exe')).code, 0, 'the committed Kosmos.exe carries no signature');
});

/* #6679: the build's own launcher step, run as written (lifted out of the script), not only its pieces. On Windows
   it asks pe_authenticode, stubbed here so a Mac can run it: the stub prints the signer the step asked for. */
function launcherStep(bytes, { onWindows = false, authenticode = 'ok' } = {}) {
  const at = WIN.indexOf('_launcher_why="$(pe_signature_present "$LAUNCHER"');
  const end = WIN.indexOf('\nfi\n', WIN.indexOf('  _launcher_sig="Valid"', at));
  assert.ok(at > -1 && end > at, 'the launcher signature step moved; this runs nothing');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-6679-'));
  const f = path.join(dir, 'Kosmos.exe');
  fs.writeFileSync(f, bytes);
  const stub = authenticode === 'ok'
    ? 'pe_authenticode() { echo "asked-signer=$KOSMOS_WIN_SIGNER" > "$ASKED"; return 0; }'
    : 'pe_authenticode() { echo "pe_authenticode: Windows reports the signature of $2 as \'HashMismatch\', not Valid" >&2; return 1; }';
  const script = '. "$LIB"; ' + stub + '; LAUNCHER="$F"; _on_windows=' + (onWindows ? 1 : 0) + '; ' + WIN.slice(at, end + 4) + '\necho "sig=$_launcher_sig"';
  const asked = path.join(dir, 'asked');
  const r = spawnSync('bash', ['-c', script], {
    env: { ...process.env, KOSMOS_WIN_SIGNER: 'Somebody Else Ltd', LIB: LIB.split(path.sep).join('/'), F: f.split(path.sep).join('/'), ASKED: asked.split(path.sep).join('/') },
    encoding: 'utf8',
  });
  /* The step keeps the check's stderr only on failure, so the stub records what it was asked in a file. */
  const askedSigner = fs.existsSync(asked) ? fs.readFileSync(asked, 'utf8') : '';
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || ''), askedSigner };
}

test('#6679: the build refuses an unsigned Kosmos.exe, records what it checked, and holds Windows to the read-me\'s publisher', () => {
  const signed = pe32({ certAddr: 400, certSize: 100 });
  const off = launcherStep(signed);
  assert.equal(off.code, 0, off.err);
  assert.match(off.out, /sig=present \(not verified: this build did not run on Windows\)/);

  const unsigned = launcherStep(pe32());
  assert.equal(unsigned.code, 1, 'an unsigned Kosmos.exe got through the build');
  assert.match(unsigned.err, /tools\/windows\/Kosmos\.exe is not signed, and the zip's read-me tells people it is \(#6679\): .*carries no signature/);
  assert.doesNotMatch(unsigned.out, /sig=/);

  const win = launcherStep(signed, { onWindows: true });
  assert.equal(win.code, 0, win.err);
  assert.match(win.out, /sig=Valid/);
  /* KOSMOS_WIN_SIGNER says someone else; the step still asks for the publisher the read-me names. */
  assert.match(win.askedSigner, /^asked-signer=Kosmos Agent Manager, Inc\.$/m);

  const bad = launcherStep(signed, { onWindows: true, authenticode: 'fail' });
  assert.equal(bad.code, 1);
  assert.match(bad.err, /Windows does not accept tools\/windows\/Kosmos\.exe's signature \(#6679\): Windows reports the signature of Kosmos\.exe as 'HashMismatch'/);
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
