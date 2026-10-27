'use strict';
/**
 * kosmos#7281: the Linux x86_64 bundle builder (tools/build-kosmos-linux.sh), and the ways it can go wrong silently.
 *
 *   node --test tools.build-linux-7281.test.js
 *
 * The builder runs here end to end, OFFLINE: a hand-made ELF x86-64 header stands in for nodejs.org's node and for
 * kosmos-relay's Linux kosmos-tunnel (`file` identifies both by their headers, which is all the builder checks), and
 * KOSMOS_NODE_UNCHECKED=1 skips the SHASUMS256 fetch, as its header says a test build may. Running the bundle's own
 * node on a stock Linux box is the CI job's work (kosmos#7281 slice E), not this file's.
 */
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = __dirname;
const LINUX = fs.readFileSync(path.join(ROOT, 'tools', 'build-kosmos-linux.sh'), 'utf8');
const MAC = fs.readFileSync(path.join(ROOT, 'tools', 'build-kosmos-bundle.sh'), 'utf8');
const WIN = fs.readFileSync(path.join(ROOT, 'tools', 'build-kosmos-windows.sh'), 'utf8');

/* Every repo file a builder stages into the app, keyed on the DESTINATION (tools.build-windows-570.test.js says why:
   a copy into $STAGE/app ships; a read of a repo file does not). */
function staged(src) {
  const out = new Set();
  for (const line of src.split('\n')) {
    if (!/^\s*cp /.test(line)) continue;
    if (!/"\$STAGE\/(app|bin)/.test(line)) continue;
    for (const m of line.matchAll(/"\$REPO\/([^"]+)"/g)) out.add(m[1]);
  }
  if (/for f in "\$REPO"\/engine\/\*\.js/.test(src)) out.add('engine/*.js');
  return out;
}

/* Files the Mac bundle stages and the Linux one deliberately does not, each with its reason (an explicit list, not a
   pattern, for the Windows test's reason: an absence must cost somebody a sentence). */
const DELIBERATELY_MAC_ONLY = {
  'assets/Kosmos.icns': 'a macOS icon format; a Linux board is a headless server with no app icon',
  'bin/board-watchdog.sh': 'the #2955 board watchdog is a macOS launchd LaunchAgent; a Linux board runs under systemd (engine/linuxboard.js)',
  'tools/macos-floor': 'a build input of the Mac native app, which a Linux bundle does not carry',
};

test('the Linux builder stages the same app as the Mac one, or a Linux install silently ships less (#731 class)', () => {
  const l = staged(LINUX);
  const m = staged(MAC);
  assert.ok(l.size >= 8, 'the Linux builder stages almost nothing; the scan is broken, not the build');
  assert.ok(m.size >= 8, 'the Mac builder stages almost nothing; the scan is broken, not the build');
  const missing = [...m].filter((f) => !l.has(f) && !(f in DELIBERATELY_MAC_ONLY));
  assert.deepEqual(missing, [], 'the Mac bundle stages files the Linux one does not, and no reason is recorded for them');
  // A reason for a difference that does not exist misleads the next reader: each one must still be a difference.
  for (const f of Object.keys(DELIBERATELY_MAC_ONLY)) {
    if (f === 'tools/macos-floor') continue;   // read by the Mac build, never staged: not an app difference to check
    assert.ok(m.has(f) && !l.has(f), `the recorded reason for ${f} describes a difference that no longer exists`);
  }
});

test('one node version for the Mac, Windows and Linux bundles (two runtimes drifting apart is a bug nobody sees)', () => {
  const v = (src) => (src.match(/NODE_VERSION="\$\{KOSMOS_NODE_VERSION:-([0-9.]+)\}"/) || [])[1];
  assert.ok(v(MAC), 'the Mac default moved');
  assert.equal(v(LINUX), v(MAC));
  assert.equal(v(WIN), v(MAC));
});

/* ---- the builder, run ---------------------------------------------------------------------------------------- */

/* An ELF x86-64 executable `file` reads as such: a header, an optional PT_INTERP naming `interp` (the loader a dynamic
   binary asks for), one PT_LOAD, then `extra` bytes (GLIBC_ version names, a build path). `osabi` 9 is FreeBSD. */
function elf(extra = '', { interp = '/lib64/ld-linux-x86-64.so.2', osabi = 0 } = {}) {
  const hdr = Buffer.alloc(64);
  hdr.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, osabi], 0);
  hdr.writeUInt16LE(2, 16); hdr.writeUInt16LE(0x3e, 18); hdr.writeUInt32LE(1, 20);
  hdr.writeBigUInt64LE(0x400000n, 24); hdr.writeBigUInt64LE(64n, 32); hdr.writeUInt16LE(64, 52); hdr.writeUInt16LE(56, 54);
  const str = interp ? Buffer.from(interp + '\0') : Buffer.alloc(0);
  const n = interp ? 2 : 1; hdr.writeUInt16LE(n, 56);
  const dataOff = 64 + 56 * n;
  const phs = [];
  if (interp) {
    const ph = Buffer.alloc(56); ph.writeUInt32LE(3, 0); ph.writeUInt32LE(4, 4);
    for (const [at, v] of [[8, dataOff], [16, 0x400000 + dataOff], [24, 0x400000 + dataOff], [32, str.length], [40, str.length], [48, 1]]) ph.writeBigUInt64LE(BigInt(v), at);
    phs.push(ph);
  }
  const load = Buffer.alloc(56); load.writeUInt32LE(1, 0); load.writeUInt32LE(5, 4);
  for (const [at, v] of [[8, 0], [16, 0x400000], [24, 0x400000], [32, dataOff + str.length], [40, dataOff + str.length], [48, 0x1000]]) load.writeBigUInt64LE(BigInt(v), at);
  phs.push(load);
  return Buffer.concat([hdr, ...phs, str, Buffer.from(extra)]);
}
const sha = (buf) => require('node:crypto').createHash('sha256').update(buf).digest('hex');
/* A connector with the sidecars kosmos-relay's build writes (tools/lib/connector-provenance.sh checks them). */
function connector(dir, name, bytes, { commit = 'a'.repeat(40), sidecars = true } = {}) {
  const f = path.join(dir, name);
  fs.writeFileSync(f, bytes, { mode: 0o755 });
  if (sidecars) {
    fs.writeFileSync(f + '.commit', commit + '\n');
    fs.writeFileSync(f + '.sha256', sha(bytes) + '  ' + name + '\n');
  }
  return f;
}
function macho() {   // "Mach-O 64-bit executable x86_64": what the Mac build ships as its connector
  const b = Buffer.alloc(32);
  b.writeUInt32LE(0xfeedfacf, 0); b.writeUInt32LE(0x01000007, 4); b.writeUInt32LE(3, 8); b.writeUInt32LE(2, 12);
  return b;
}
const VER = (MAC.match(/NODE_VERSION="\$\{KOSMOS_NODE_VERSION:-([0-9.]+)\}"/) || [])[1];

function fixtures() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-linuxbundle-7281-'));
  const nodeDir = path.join(d, `node-v${VER}-linux-x64`);
  fs.mkdirSync(path.join(nodeDir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(nodeDir, 'bin', 'node'), elf(), { mode: 0o755 });
  fs.writeFileSync(path.join(nodeDir, 'LICENSE'), 'node licence\n');
  const nodeTar = path.join(d, `node-v${VER}-linux-x64.tar.gz`);
  const t = spawnSync('tar', ['-czf', nodeTar, '-C', d, `node-v${VER}-linux-x64`], { encoding: 'utf8' });
  assert.equal(t.status, 0, t.stderr);
  connector(d, 'tunnel-elf', elf('\0GLIBC_2.17\0GLIBC_2.34\0'));
  connector(d, 'tunnel-new-glibc', elf('\0GLIBC_2.17\0GLIBC_2.39\0'));
  connector(d, 'tunnel-bare', elf(), { sidecars: false });
  connector(d, 'tunnel-freebsd', elf('', { interp: null, osabi: 9 }));
  connector(d, 'tunnel-musl', elf('', { interp: '/lib/ld-musl-x86_64.so.1' }));
  connector(d, 'tunnel-cargo-path', elf('\0/home/runner/.cargo/registry/src/x.rs\0'));
  connector(d, 'tunnel-docker-cargo', elf('\0/usr/local/cargo/registry/src/x.rs\0'));
  connector(d, 'tunnel-static', elf('\0GLIBC_2.99 in a message, not a symbol\0', { interp: null }));
  connector(d, 'tunnel-dirty', elf(), { commit: 'a'.repeat(40) + '-dirty' });
  connector(d, 'tunnel-macho', macho());
  return { d, nodeTar };
}
function build(f, tunnel, out) {
  return spawnSync('bash', [path.join(ROOT, 'tools', 'build-kosmos-linux.sh'), out], {
    encoding: 'utf8',
    env: { ...process.env, KOSMOS_ALLOW_DIRTY: '1', KOSMOS_NODE_UNCHECKED: '1', NODE_LINUX_SOURCE: f.nodeTar,
      KOSMOS_TUNNEL_LINUX_BIN: tunnel, KOSMOS_NODE_CACHE: path.join(f.d, 'cache') },
    timeout: 120000,
  });
}

test('the builder refuses a connector that is not ELF x86-64 (the Mac\'s Mach-O is the defect this ends), before any download', () => {
  const f = fixtures();
  const out = path.join(f.d, 'out-macho');
  // Review 1 (N4): no local node and a version nodejs.org has never published, so a refusal that came AFTER the
  // node fetch would fail with a download error instead of the connector's own words.
  const r = spawnSync('bash', [path.join(ROOT, 'tools', 'build-kosmos-linux.sh'), out], {
    encoding: 'utf8',
    env: { ...process.env, KOSMOS_ALLOW_DIRTY: '1', KOSMOS_NODE_VERSION: '0.0.0', KOSMOS_TUNNEL_LINUX_BIN: path.join(f.d, 'tunnel-macho') },
    timeout: 60000,
  });
  assert.notEqual(r.status, 0, 'a Mach-O connector was packed into the Linux bundle');
  assert.match(r.stderr, /must be an ELF 64-bit x86-64 executable/);
  assert.equal(fs.existsSync(path.join(out, 'kosmos-linux-x64.tar.gz')), false);
  const none = spawnSync('bash', [path.join(ROOT, 'tools', 'build-kosmos-linux.sh'), out], {
    encoding: 'utf8', env: { ...process.env, KOSMOS_TUNNEL_LINUX_BIN: '' }, timeout: 60000 });
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /KOSMOS_TUNNEL_LINUX_BIN is not set/, 'a bundle without a connector was not refused');
});

test('review 1: a connector without its provenance, from a dirty tree, or needing a newer glibc than the floor is refused', () => {
  const f = fixtures();
  const cases = [
    ['tunnel-bare', /connector_provenance: no .*\.commit beside the connector/],
    ['tunnel-dirty', /built from a DIRTY tree/],
    ['tunnel-new-glibc', /needs glibc 2\.39, newer than the supported floor 2\.35/],
    // Review 2: an ELF for another system, one that needs a loader Ubuntu lacks, one that leaks a build home.
    ['tunnel-freebsd', /is not built for Linux/],
    ['tunnel-musl', /needs a loader a stock Ubuntu does not have/],
    ['tunnel-cargo-path', /names a build machine's cargo or rustup home/],
    ['tunnel-docker-cargo', /names a build machine's cargo or rustup home/],
  ];
  for (const [name, why] of cases) {
    const r = build(f, path.join(f.d, name), path.join(f.d, 'out-' + name));
    assert.notEqual(r.status, 0, name + ' was packed');
    assert.match(r.stderr, why, name + ': ' + r.stderr);
  }
});

test('review 1 and 2: an unchecked node, and a different glibc floor, are test builds only', () => {
  const f = fixtures();
  // Review 2 (N3): on a clean tree (CI) the refusal must be the gate itself, not the dirty-tree one before it.
  const clean = spawnSync('git', ['-C', ROOT, 'diff', '--quiet', 'HEAD', '--', '.']).status === 0;
  const want = (gate) => (clean ? gate : new RegExp('refusing to package a -dirty tree|' + gate.source));
  const run = (extra) => {
    const env = { ...process.env, KOSMOS_TUNNEL_LINUX_BIN: path.join(f.d, 'tunnel-elf'), ...extra };
    delete env.KOSMOS_ALLOW_DIRTY;
    return spawnSync('bash', [path.join(ROOT, 'tools', 'build-kosmos-linux.sh'), path.join(f.d, 'out-gated')], { encoding: 'utf8', env, timeout: 60000 });
  };
  const unchecked = run({ KOSMOS_NODE_UNCHECKED: '1', NODE_LINUX_SOURCE: f.nodeTar });
  assert.notEqual(unchecked.status, 0);
  assert.match(unchecked.stderr, want(/an unchecked node is for a test build only/));
  const floor = run({ KOSMOS_LINUX_GLIBC_FLOOR: '2.99', NODE_LINUX_SOURCE: f.nodeTar });   // review 3: never the network
  assert.notEqual(floor.status, 0);
  assert.match(floor.stderr, want(/KOSMOS_LINUX_GLIBC_FLOOR=2\.99 is for a test build only/));
});

test('review 2: a static connector needs no glibc (a GLIBC_ text in it is not a symbol version)', () => {
  const f = fixtures();
  const r = build(f, path.join(f.d, 'tunnel-static'), path.join(f.d, 'out-static'));
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(fs.readFileSync(path.join(f.d, 'out-static', 'kosmos-linux-x64.manifest.json'), 'utf8'));
  assert.equal(m.connector.glibc, '', 'a static connector was recorded as needing glibc');
});

test('review 2 (W4): the owner gate refuses a tarball that records the build account, on this host\'s own tar', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ownergate-7281-'));
  fs.writeFileSync(path.join(d, 'f'), 'x');
  const me = require('node:os').userInfo().username;
  const bsd = /bsdtar/i.test(spawnSync('tar', ['--version'], { encoding: 'utf8' }).stdout);
  const owner = bsd ? ['--uname', me, '--gname', me] : ['--owner=' + me + ':0', '--group=' + me + ':0'];
  const tgz = path.join(d, 'mine.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', tgz, ...owner, '-C', d, 'f']).status, 0);
  const gate = (file) => spawnSync('bash', ['-c', '. "$1"; tar_owner_gate "$2" "$3"', '_', path.join(ROOT, 'tools', 'lib', 'tar-owner-gate.sh'), file, me], { encoding: 'utf8' });
  const r = gate(tgz);
  assert.notEqual(r.status, 0, 'the owner gate passed a tarball recording the build account (' + (bsd ? 'bsdtar' : 'GNU tar') + ' listing)');
  const neutral = path.join(d, 'neutral.tar.gz');
  const nOwner = bsd ? ['--uname', 'kosmos', '--gname', 'kosmos'] : ['--owner=kosmos:0', '--group=kosmos:0'];
  assert.equal(spawnSync('tar', ['-czf', neutral, ...nOwner, '-C', d, 'f']).status, 0);
  assert.equal(gate(neutral).status, 0, 'CONTROL: a neutral owner was refused');
});

test('review 1: the odd-names check is the Mac builder\'s, word for word (the signed manifest\'s rule, #6468)', () => {
  const body = (src) => { const i = src.indexOf('kosmos_bundle_odd_names() {'); return src.slice(i, src.indexOf('\n}\n', i)); };
  assert.ok(body(MAC).length > 200, 'the Mac function moved');
  assert.equal(body(LINUX), body(MAC));
});

test('CONTROL: with an ELF connector it packs the bundle, and its manifest lists exactly the tarball\'s files', () => {
  const f = fixtures();
  const out = path.join(f.d, 'out');
  const r = build(f, path.join(f.d, 'tunnel-elf'), out);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const tarball = path.join(out, 'kosmos-linux-x64.tar.gz');
  const list = spawnSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).stdout.split('\n').filter((x) => x && !x.endsWith('/'));
  for (const want of ['runtime/bin/node', 'runtime/LICENSE', 'app/bin/kosmos-tunnel', 'bin/kosmos', 'app/server.js',
    'app/engine/manifest-verify.js', 'app/bin/kosmos-report-hook.sh', 'app/bin/agent-supervisor.sh', 'VERSION']) {
    assert.ok(list.includes(want), want + ' is missing from the Linux bundle');
  }
  assert.equal(list.some((x) => /(^|\/)\._/.test(x)), false, 'macOS ._ metadata reached the tarball');
  assert.equal(list.some((x) => /Kosmos\.app|kosmos-app$|board-watchdog/.test(x)), false, 'a Mac-only part reached the Linux bundle');
  const m = JSON.parse(fs.readFileSync(path.join(out, 'kosmos-linux-x64.manifest.json'), 'utf8'));
  assert.equal(m.platform, 'linux');
  assert.equal(m.arch, 'x64');
  assert.equal(m.artifact, 'kosmos-linux-x64.tar.gz');
  assert.equal(m.node.version, 'v' + VER);
  assert.match(m.node.download_sha256, /^unchecked:[0-9a-f]{64}$/, 'a test build\'s node was recorded as a checked download');
  assert.equal(m.connector.commit, 'a'.repeat(40), 'the connector\'s commit sidecar was not recorded');
  assert.equal(m.connector.glibc, '2.34', 'the glibc the connector needs was not recorded');
  assert.equal(m.connector.glibc_floor, '2.35', 'the floor it was held to was not recorded');
  assert.equal(m.connector.signed_sha256, m.connector.input_sha256);
  assert.ok(m.pinned_keys.length >= 1, 'no pinned keys: the next cut would refuse its own key');
  assert.deepEqual(m.files.map((x) => x.path).sort(), list.sort(), 'the manifest does not describe the tarball file for file');
  const sidecar = fs.readFileSync(tarball + '.sha256', 'utf8').trim().split(/\s+/);
  assert.equal(sidecar[1], 'kosmos-linux-x64.tar.gz');
  assert.equal(m.sha256, sidecar[0], 'the manifest and the sidecar disagree about the tarball');
});
