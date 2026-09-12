'use strict';
/**
 * win32-update-stage (updater slice S2): `prepare()` downloads, verifies and stages a Windows
 * build, and never swaps it in.
 *
 * Every case runs in a sandbox: a Kosmos folder (ROOT) with a person's own `Projects` inside it,
 * an anchor folder with its `engine-path` and `node.exe`, and sandboxed store, projects and
 * workers roots. The network is an injected fetch serving zips built in the test, and the
 * staged `node.exe` is a stub, except in the two cases that run a real interpreter. Nothing here
 * reaches the release host.
 *
 *   node --test engine/win32update.test.js
 *   KOSMOS_WIN_ZIP_SAMPLE=<a real kosmos-win-x64.zip> node --test engine/win32update.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandbox every root before requiring anything that reads one.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-w32stage-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const store = require('./store');
const win32anchor = require('./win32anchor');
const win32update = require('./win32update');
const win32zip = require('./win32zip');
const { buildZip } = require('../test-support/zipfixture');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const REPO = path.join(__dirname, '..');
const ARCH = 'x64';
const INSTALLED = '0.6.55';
const NEXT = '0.6.60';
const SOURCE_SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const NODE_VERSION = 'v24.19.0';
const BASE = 'https://updates.example.test/dist';
const README = '! READ ME FIRST - Windows will warn you.txt';
const PLENTY_OF_DISK = 64 * 1024 * 1024 * 1024;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const zipName = (version) => `kosmos-${version}-win-${ARCH}.zip`;

/* ─── the sandbox ─────────────────────────────────────────────────────────────────────────── */

let caseCount = 0;
/** A Kosmos folder at 0.6.55, its anchor pointing at it, and a person's project inside it. */
function freshCase(o = {}) {
  caseCount += 1;
  const dir = path.join(SANDBOX, 'cases', String(caseCount));
  const root = o.root || path.join(dir, 'Kosmos');
  const env = { AGENT_WORKFORCE_DATA: path.join(dir, 'machine') };
  const anchor = win32anchor.anchorDir(process.platform, os.homedir(), env);
  if (o.layout !== false) {
    fs.mkdirSync(path.join(root, 'runtime'), { recursive: true });
    fs.mkdirSync(path.join(root, 'app', 'engine'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Projects', 'garden'), { recursive: true });
    fs.writeFileSync(path.join(root, 'runtime', 'node.exe'), 'the installed node.exe');
    fs.writeFileSync(path.join(root, 'app', 'server.js'), '// the installed server');
    fs.writeFileSync(path.join(root, 'app', 'package.json'), JSON.stringify({ version: INSTALLED }));
    fs.writeFileSync(path.join(root, 'Projects', 'garden', 'notes.txt'), "a person's own work");
  }
  fs.mkdirSync(anchor, { recursive: true });
  fs.writeFileSync(path.join(anchor, win32anchor.NODE_NAME), o.anchoredNode !== undefined ? o.anchoredNode : 'the anchored node.exe of 0.6.55');
  if (o.pointer !== null) fs.writeFileSync(path.join(anchor, win32anchor.POINTER_NAME), o.pointer || path.join(root, 'app', 'engine'));
  return { dir, root, env, anchor, work: path.join(root, '.kosmos-update'), log: [], nodeRuns: [] };
}

/** The files of a Kosmos build, in the shape tools/build-kosmos-windows.sh stages. */
function bundleFiles(o = {}) {
  const version = o.version || NEXT;
  const files = {
    'Kosmos.exe': 'MZ the launcher',
    'open-board.js': '// the browser opener',
    [README]: 'Windows will warn you',
    'manifest.json': JSON.stringify({
      product: 'kosmos', platform: 'win32', arch: ARCH, version, source_sha: SOURCE_SHA, source_dirty: false,
      signed: false, node: { version: NODE_VERSION, download_sha256: '0'.repeat(64) }, agents_supported: true,
      ...(o.manifest || {}),
    }),
    'runtime/node.exe': o.nodeBytes !== undefined ? o.nodeBytes : `the staged node.exe of ${version}`,
    'runtime/LICENSE': 'MIT',
    'app/server.js': '// the new server\n'.repeat(40),
    'app/package.json': JSON.stringify({ name: 'agent-workforce', version: o.pkgVersion || version }),
    'app/web/index.html': '<!doctype html><title>Kosmos</title>\n'.repeat(40),
    'app/engine/kosmos-report-hook.js': '// the report hook',
    'bin/kosmos-cli.js': '// the kosmos command',
    'bin/kosmos.ps1': '# the PowerShell shim',
    'bin/kosmos': '#!/bin/sh',
  };
  for (const name of o.omit || []) delete files[name];
  return Object.assign(files, o.extra || {});
}
function bundleZip(o = {}) {
  const entries = [{ name: 'app/' }, { name: 'app/engine/' }, { name: 'bin/' }, { name: 'runtime/' }];
  Object.entries(bundleFiles(o)).forEach(([name, data], i) => {
    entries.push({ name, data, method: i % 2 ? 0 : 8, ...((o.entryOver && o.entryOver[name]) || {}) });
  });
  return buildZip(entries);
}
/** A Windows pointer in the exact shape publish-kosmos-windows.sh writes. */
function pointerBody(zip, over = {}) {
  const version = over.version || NEXT;
  return { version, sha256: sha256(zip), artifact: `kosmos-win-${ARCH}.zip`, versioned: zipName(version), arch: ARCH, ...over };
}
/** The release host, as an injected fetch. Records every URL asked for. */
function site(zip, o = {}) {
  const pointer = o.pointer || pointerBody(zip);
  const urls = [];
  const fetch = async (url, init) => {
    urls.push(url);
    const file = decodeURIComponent(new URL(url).pathname.split('/').pop());
    if (file === 'latest-win.json') return new Response(typeof pointer === 'string' ? pointer : JSON.stringify(pointer));
    if (file === `${pointer.versioned}.sha256`) return new Response(o.sidecar !== undefined ? o.sidecar : `${pointer.sha256}  ${pointer.versioned}\n`);
    if (file === pointer.versioned) {
      return o.zipResponse ? o.zipResponse(zip, init) : new Response(zip, { headers: { 'content-length': String(zip.length) } });
    }
    return new Response('not here', { status: 404 });
  };
  return { fetch, urls, pointer };
}
function prepareOpts(c, s, over) {
  return {
    root: c.root, platform: 'win32', arch: ARCH, base: BASE, channel: 'prod', env: c.env, world: 'default',
    fetch: s ? s.fetch : async () => { throw new Error('this case must not reach the network'); },
    freeBytes: () => PLENTY_OF_DISK,
    runStagedNode: (exe) => { c.nodeRuns.push(exe); return NODE_VERSION + '\n'; },
    liveExecutionAllowed: () => true,
    log: (line) => c.log.push(line),
    ...(over || {}),
  };
}
/** Every file and folder under `top` (contents and mtime), except the folders in `skip`. */
function snapshot(top, skip) {
  const seen = {};
  const skipped = skip.map((s) => path.resolve(s));
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (skipped.includes(path.resolve(full))) continue;
      const rel = path.relative(top, full);
      if (e.isSymbolicLink()) { seen[rel] = 'link ' + fs.readlinkSync(full); continue; }
      if (e.isDirectory()) { seen[rel + path.sep] = 'folder'; walk(full); continue; }
      seen[rel] = sha256(fs.readFileSync(full)) + ' ' + fs.statSync(full).mtimeMs;
    }
  })(top);
  return seen;
}
function workHolds(c) { return fs.existsSync(c.work) ? fs.readdirSync(c.work).sort() : null; }
async function refusedWith(c, s, pattern, over) {
  const r = await win32update.prepare(prepareOpts(c, s, over));
  assert.equal(r.ok, false, 'expected a refusal, got ' + JSON.stringify(r));
  assert.match(r.because, pattern);
  return r;
}
/** A failure after the lock: the part file and the staged tree are gone, and the reason is recorded. */
function assertCleanedUp(c, pattern) {
  assert.deepEqual(workHolds(c), ['prepare-status.json'], 'only the recorded outcome is left in WORK');
  const status = readJson(path.join(c.work, 'prepare-status.json'));
  assert.equal(status.ok, false);
  assert.match(status.because, pattern);
}

/* ─── the happy path ──────────────────────────────────────────────────────────────────────── */

test('the happy path: downloaded, checked and staged, with the identity the new board will answer with', async () => {
  const c = freshCase();
  const zip = bundleZip();
  /* An alias that names some other file, so a read of `artifact` would show up in the URLs. */
  const s = site(zip, { pointer: pointerBody(zip, { artifact: 'kosmos-something-else.zip' }) });
  const before = snapshot(SANDBOX, [c.work]);
  const r = await win32update.prepare(prepareOpts(c, s));
  assert.deepEqual(r, {
    ok: true, version: NEXT, sha256: sha256(zip), stagedDir: path.join(c.work, 'staged'),
    runtimeChanged: true, expectedIdentity: `${NEXT}+${SOURCE_SHA.slice(0, 12)}@default`,
  });
  for (const entry of win32update.REQUIRED_ENTRIES) {
    assert.ok(fs.statSync(path.join(r.stagedDir, ...entry.split('/'))).isFile(), `${entry} is staged`);
  }
  assert.equal(fs.readFileSync(path.join(r.stagedDir, 'app', 'server.js'), 'utf8'), '// the new server\n'.repeat(40));
  assert.deepEqual(c.nodeRuns, [path.join(r.stagedDir, 'runtime', 'node.exe')], 'the STAGED interpreter is the one run');
  assert.deepEqual(workHolds(c), ['prepare-status.json', 'staged'], 'the download and the lock are gone');
  assert.equal(readJson(path.join(c.work, 'prepare-status.json')).expectedIdentity, r.expectedIdentity);
  assert.deepEqual(s.urls, [
    `${BASE}/latest-win.json`,
    `${BASE}/${zipName(NEXT)}.sha256`,
    `${BASE}/${zipName(NEXT)}?v=${NEXT}`,
  ], 'the pointer, the sidecar, then the versioned zip with its cache-buster; never the alias');
  /* 🛑 THE PATH GUARD: everything outside WORK -- ROOT's app, runtime and Projects, the anchor,
     the store, projects and workers roots -- is byte-for-byte and mtime-for-mtime unchanged. */
  assert.deepEqual(snapshot(SANDBOX, [c.work]), before);
});

test('the staging channel reads the staging pointer, and never falls back to prod', async () => {
  const c = freshCase();
  const zip = bundleZip();
  const s = site(zip);
  const r = await win32update.prepare(prepareOpts(c, s, { channel: 'staging' }));
  assert.equal(r.ok, false);
  assert.deepEqual(s.urls, [`${BASE}/latest-win-staging.json`]);
  assert.match(r.because, /answered 404 for the update pointer/);
});

test('runtimeChanged: the same interpreter is unchanged; the same size with other bytes is changed', async () => {
  const same = 'the one node.exe, byte for byte';
  const c1 = freshCase({ anchoredNode: same });
  const zip1 = bundleZip({ nodeBytes: same });
  assert.equal((await win32update.prepare(prepareOpts(c1, site(zip1)))).runtimeChanged, false);
  const c2 = freshCase({ anchoredNode: 'A'.repeat(32) });
  const zip2 = bundleZip({ nodeBytes: 'B'.repeat(32) });
  assert.equal((await win32update.prepare(prepareOpts(c2, site(zip2)))).runtimeChanged, true, 'equal sizes fall through to the hash');
  const c3 = freshCase();
  fs.rmSync(path.join(c3.anchor, win32anchor.NODE_NAME));
  assert.equal((await win32update.prepare(prepareOpts(c3, site(bundleZip())))).runtimeChanged, true, 'no anchored interpreter at all');
});

/* ─── B1 ──────────────────────────────────────────────────────────────────────────────────── */

test('B1: an unreadable pointer, or one for another arch, is refused', async () => {
  const zip = bundleZip();
  await refusedWith(freshCase(), site(zip, { pointer: 'not json at all' }), /does not name a Windows build for this computer \(x64\)/);
  const other = site(zip, { pointer: pointerBody(zip, { versioned: `kosmos-${NEXT}-win-arm64.zip` }) });
  await refusedWith(freshCase(), other, /does not name a Windows build/);
  assert.deepEqual(other.urls, [`${BASE}/latest-win.json`], 'nothing past the pointer');
});

test('B1: a version that is not newer than the installed one is refused', async () => {
  const zip = bundleZip({ version: INSTALLED });
  const s = site(zip, { pointer: pointerBody(zip, { version: INSTALLED }) });
  await refusedWith(freshCase(), s, /this Kosmos is 0\.6\.55 and the site offers 0\.6\.55, so there is nothing newer/);
  assert.equal(s.urls.length, 1);
});

test('B1: a pointer that moved since the offer the person accepted is refused', async () => {
  const s = site(bundleZip());
  await refusedWith(freshCase(), s, /now offers 0\.6\.60, not the 0\.6\.58 that was on offer/, { expectVersion: '0.6.58' });
  assert.equal(s.urls.length, 1);
});

/* ─── B2 ──────────────────────────────────────────────────────────────────────────────────── */

test('B2: a sidecar that disagrees with the pointer is refused before the zip is fetched', async () => {
  const c = freshCase();
  const zip = bundleZip();
  const s = site(zip, { sidecar: `${'ab'.repeat(32)}  ${zipName(NEXT)}\n` });
  await refusedWith(c, s, /checksum file and its update pointer disagree/);
  assert.equal(s.urls.some((u) => u.includes('.zip?v=')), false, 'the 37 MB download never started');
  assertCleanedUp(c, /disagree/);
});

test('B2: a download that does not hash to the published sha is refused, and the part file removed', async () => {
  const c = freshCase();
  const zip = bundleZip();
  const s = site(zip, { pointer: pointerBody(zip, { sha256: 'cd'.repeat(32) }) });
  await refusedWith(c, s, /does not match the checksum the site published/);
  assert.ok(s.urls.some((u) => u.includes('.zip?v=')), 'the control: the zip really was downloaded');
  assertCleanedUp(c, /does not match/);
});

test('B2: a sidecar that names a different file is refused', async () => {
  const zip = bundleZip();
  await refusedWith(freshCase(), site(zip, { sidecar: `${sha256(zip)}  kosmos-0.6.1-win-x64.zip\n` }), /names kosmos-0\.6\.1-win-x64\.zip, not kosmos-0\.6\.60-win-x64\.zip/);
  await refusedWith(freshCase(), site(zip, { sidecar: 'not a checksum' }), /could not be read/);
});

test('B2: a truncated download is refused, with or without a Content-Length', async () => {
  const zip = bundleZip();
  const c1 = freshCase();
  await refusedWith(c1, site(zip, { zipResponse: (z) => new Response(z.subarray(0, z.length - 100), { headers: { 'content-length': String(z.length) } }) }),
    new RegExp(`stopped early: ${zip.length - 100} of ${zip.length} bytes`));
  assertCleanedUp(c1, /stopped early/);
  const c2 = freshCase();
  await refusedWith(c2, site(zip, { zipResponse: (z) => new Response(z.subarray(0, z.length - 100)) }), /does not match the checksum/);
  const c3 = freshCase();
  const broken = (z) => new Response(new ReadableStream({ start(ctl) { ctl.enqueue(z.subarray(0, 1000)); ctl.error(new Error('connection reset')); } }));
  await refusedWith(c3, site(zip, { zipResponse: broken }), /interrupted \(connection reset\)/);
  assertCleanedUp(c3, /interrupted/);
});

test('B2: the size cap, announced by Content-Length or discovered while streaming', async () => {
  const zip = bundleZip();
  const limits = { maxDownloadBytes: 1000 };
  const c1 = freshCase();
  await refusedWith(c1, site(zip), /larger than the 1000 bytes this updater will download/, { limits });
  assertCleanedUp(c1, /larger than/);
  const chunked = (z) => new Response(new ReadableStream({
    start(ctl) { for (let at = 0; at < z.length; at += 400) ctl.enqueue(z.subarray(at, at + 400)); ctl.close(); },
  }));
  const c2 = freshCase();
  await refusedWith(c2, site(zip, { zipResponse: chunked }), /larger than the 1000 bytes/, { limits });
  assertCleanedUp(c2, /larger than/);
  /* The control: the same chunked stream under the real cap stages fine. */
  assert.equal((await win32update.prepare(prepareOpts(freshCase(), site(zip, { zipResponse: chunked })))).ok, true);
});

test('B2: the time cap ends a download that stops sending, even when the transport ignores the abort', async () => {
  const c = freshCase();
  const stalls = (z) => new Response(new ReadableStream({
    start(ctl) { ctl.enqueue(z.subarray(0, 1000)); },
    pull() { return new Promise(() => {}); },
  }));
  const startedAt = Date.now();
  await refusedWith(c, site(bundleZip(), { zipResponse: stalls }), /took longer than/, { limits: { maxDownloadMs: 300 } });
  assert.ok(Date.now() - startedAt < 5000, 'it gave up at the cap rather than waiting on the stream');
  assertCleanedUp(c, /took longer/);
});

test('B2: a release host that answers 404 is refused, and the log names the URL and the status', async () => {
  const c = freshCase();
  await refusedWith(c, site(bundleZip(), { zipResponse: () => new Response('gone', { status: 404 }) }), /answered 404 for the update/);
  assert.ok(c.log.includes(`GET failed url=${BASE}/${zipName(NEXT)}?v=${NEXT} status=404`), c.log.join('\n'));
});

test('B2: too little free disk is refused before a byte is written', async () => {
  const c = freshCase();
  const zip = bundleZip();
  await refusedWith(c, site(zip), new RegExp(`needs about ${4 * zip.length} bytes free and there is 1000 bytes`), { freeBytes: () => 1000 });
  assertCleanedUp(c, /not enough free disk space/);
});

/* ─── B3 ──────────────────────────────────────────────────────────────────────────────────── */

test('B3: too little free disk for the unpacked tree is refused before unpacking', async () => {
  const c = freshCase();
  let asked = 0;
  await refusedWith(c, site(bundleZip()), /the update unpacks to \d+ bytes and there is 10 bytes free/, {
    freeBytes: () => { asked += 1; return asked === 1 ? PLENTY_OF_DISK : 10; },
  });
  assertCleanedUp(c, /unpacks to/);
});

test('B3: a stray top-level entry is refused, and nothing is left staged', async () => {
  const c = freshCase();
  const before = snapshot(SANDBOX, [c.work]);
  await refusedWith(c, site(bundleZip({ extra: { 'evil.txt': 'not part of a build' } })), /"evil\.txt" is not part of a Kosmos build/);
  assertCleanedUp(c, /not part of a Kosmos build/);
  assert.deepEqual(snapshot(SANDBOX, [c.work]), before);
});

test('B3: a zip-slip inside a correctly signed download writes nothing outside WORK', async () => {
  const c = freshCase();
  const before = snapshot(SANDBOX, [c.work]);
  await refusedWith(c, site(bundleZip({ extra: { 'app/../../../escaped.txt': 'out' } })), /climbs out of its folder/);
  assertCleanedUp(c, /climbs out/);
  assert.deepEqual(snapshot(SANDBOX, [c.work]), before, 'nothing escaped');
});

test('B3: an entry damaged inside a correctly signed download is refused, and the half-staged tree removed', async () => {
  const c = freshCase();
  const before = snapshot(SANDBOX, [c.work]);
  await refusedWith(c, site(bundleZip({ entryOver: { 'bin/kosmos-cli.js': { crc: 1 } } })), /"bin\/kosmos-cli\.js" is damaged/);
  assertCleanedUp(c, /damaged/);
  assert.deepEqual(snapshot(SANDBOX, [c.work]), before);
});

/* ─── B4 ──────────────────────────────────────────────────────────────────────────────────── */

test('B4: a manifest.json for another version, platform or arch is refused', async () => {
  const c1 = freshCase();
  await refusedWith(c1, site(bundleZip({ manifest: { version: '0.6.59' } })), /manifest\.json says "0\.6\.59", but the site published it as 0\.6\.60/);
  assertCleanedUp(c1, /manifest\.json says/);
  await refusedWith(freshCase(), site(bundleZip({ manifest: { platform: 'darwin' } })), /manifest\.json is for "darwin", not Windows/);
  await refusedWith(freshCase(), site(bundleZip({ manifest: { arch: 'arm64' } })), /manifest\.json is for "arm64", not this computer \(x64\)/);
  await refusedWith(freshCase(), site(bundleZip({ omit: ['manifest.json'] })), /no readable manifest\.json/);
});

test('B4: an app whose package.json disagrees with the manifest is refused', async () => {
  const c = freshCase();
  await refusedWith(c, site(bundleZip({ pkgVersion: '0.6.59' })), /app says it is "0\.6\.59", but the site published it as 0\.6\.60/);
  assertCleanedUp(c, /app says/);
});

test('B4: a build missing a required entry is refused', async () => {
  const c = freshCase();
  await refusedWith(c, site(bundleZip({ omit: ['bin/kosmos.ps1'] })), /the update is missing bin\\kosmos\.ps1/);
  assertCleanedUp(c, /missing/);
  await refusedWith(freshCase(), site(bundleZip({ omit: ['runtime/node.exe'] })), /missing runtime\\node\.exe/);
});

test('B4: a staged node.exe that does not run, times out, or reports the wrong version is refused', async () => {
  const c1 = freshCase();
  await refusedWith(c1, site(bundleZip()), /did not run \(spawn UNKNOWN\)/, { runStagedNode: () => { throw new Error('spawn UNKNOWN'); } });
  assertCleanedUp(c1, /did not run/);
  const timeout = () => { throw Object.assign(new Error('spawnSync node.exe ETIMEDOUT'), { code: 'ETIMEDOUT' }); };
  await refusedWith(freshCase(), site(bundleZip()), /did not answer within 20 seconds/, { runStagedNode: timeout });
  await refusedWith(freshCase(), site(bundleZip()), /is v22\.1\.0, but its manifest\.json names v24\.19\.0/, { runStagedNode: () => 'v22.1.0' });
  await refusedWith(freshCase(), site(bundleZip()), /did not report a version \(it printed "hello"\)/, { runStagedNode: () => 'hello' });
});

test('B4: the default runner really runs an interpreter, with a timeout', () => {
  assert.equal(win32update.runStagedNode(process.execPath, 20000), process.version);
});

/* ─── B0 ──────────────────────────────────────────────────────────────────────────────────── */

async function refusedBeforeStarting(c, pattern, over) {
  let fetched = 0;
  const r = await win32update.prepare(prepareOpts(c, { fetch: async () => { fetched += 1; throw new Error('reached the network'); } }, over));
  assert.equal(r.ok, false);
  assert.match(r.because, pattern);
  assert.equal(fetched, 0, 'a B0 refusal never reaches the network');
  return r;
}

test('B0: only Windows, and only a Windows bundle', async () => {
  const c = freshCase();
  await refusedBeforeStarting(c, /this is not Windows/, { platform: 'darwin' });
  await refusedBeforeStarting(freshCase({ layout: false }), /is not a Kosmos for Windows folder/);
  assert.equal(fs.existsSync(c.work), false);
});

test('B0: the anchor must point at this folder', async () => {
  await refusedBeforeStarting(freshCase({ pointer: null }), /no record of which folder it starts from/);
  const elsewhere = path.join(SANDBOX, 'elsewhere', 'app', 'engine');
  const c = freshCase({ pointer: elsewhere });
  await refusedBeforeStarting(c, new RegExp(`starts from ${elsewhere.replace(/\\/g, '\\\\')}, not from`));
  assert.equal(fs.existsSync(c.work), false);
});

test('B0: never the top of a drive', async () => {
  const c = freshCase();
  await refusedBeforeStarting(c, /is the top of a drive/, { root: path.parse(c.root).root });
});

test('B0: never inside the data, projects, workers or anchor folders', async () => {
  await refusedBeforeStarting(freshCase({ root: path.join(store.ROOT, 'Kosmos') }), /inside the Kosmos data folder/);
  await refusedBeforeStarting(freshCase({ root: path.join(process.env.AGENT_WORKFORCE_PROJECTS, 'Kosmos') }), /inside the projects folder/);
  await refusedBeforeStarting(freshCase({ root: path.join(process.env.AGENT_WORKFORCE_WORKERS, 'Kosmos') }), /inside the agents' folders/);
  const c = freshCase();
  await refusedBeforeStarting(c, /inside the folder Kosmos starts from at logon/, { root: path.join(c.anchor, 'Kosmos') });
});

test('B0: a protected folder inside one of the entries an update replaces is refused; Projects beside them is fine', async () => {
  const saved = process.env.AGENT_WORKFORCE_PROJECTS;
  const c = freshCase();
  try {
    process.env.AGENT_WORKFORCE_PROJECTS = path.join(c.root, 'app', 'Projects');
    await refusedBeforeStarting(c, /the projects folder .* is inside .*app, which an update replaces/);
    /* The control: the README's own layout, Projects inside the Kosmos folder beside app. */
    process.env.AGENT_WORKFORCE_PROJECTS = path.join(c.root, 'Projects');
    assert.equal((await win32update.prepare(prepareOpts(c, site(bundleZip())))).ok, true);
  } finally {
    process.env.AGENT_WORKFORCE_PROJECTS = saved;
  }
});

test('B0: a WORK folder that is a link or a file is refused, and nothing is written through it', async () => {
  const c1 = freshCase();
  const outside = path.join(c1.dir, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, c1.work, process.platform === 'win32' ? 'junction' : 'dir');
  await refusedBeforeStarting(c1, /is a link to somewhere else/);
  assert.deepEqual(fs.readdirSync(outside), []);
  const c2 = freshCase();
  fs.writeFileSync(c2.work, 'a file where the folder goes');
  await refusedBeforeStarting(c2, /is a file, not a folder/);
});

test('B0: a second prepare while one is in flight is refused', async () => {
  const c = freshCase();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const held = (z) => new Response(new ReadableStream({ async pull(ctl) { await gate; ctl.enqueue(z); ctl.close(); } }),
    { headers: { 'content-length': String(z.length) } });
  const s = site(bundleZip(), { zipResponse: held });
  const first = win32update.prepare(prepareOpts(c, s));
  while (!s.urls.some((u) => u.includes('.zip?v='))) await new Promise((r) => setTimeout(r, 5));
  await refusedBeforeStarting(freshCase(), /an update is already being prepared/);
  release();
  assert.equal((await first).ok, true, 'the first one finishes');
  assert.equal((await win32update.prepare(prepareOpts(freshCase(), site(bundleZip())))).ok, true, 'and the flag is released after it');
});

test('B0: a lock held by a live process refuses; a dead or stale one is cleared', async () => {
  const c1 = freshCase();
  fs.mkdirSync(c1.work);
  fs.writeFileSync(path.join(c1.work, 'prepare.lock'), JSON.stringify({ pid: process.pid, at: Date.now() }));
  await refusedWith(c1, null, new RegExp(`another update is already being prepared \\(process ${process.pid}\\)`));
  assert.deepEqual(workHolds(c1), ['prepare.lock'], "another prepare's lock is not ours to clear, and no status is written over its work");

  const gone = cp.spawnSync(process.execPath, ['-e', '']).pid;
  const c2 = freshCase();
  fs.mkdirSync(c2.work);
  fs.writeFileSync(path.join(c2.work, 'prepare.lock'), JSON.stringify({ pid: gone, at: Date.now() }));
  assert.equal((await win32update.prepare(prepareOpts(c2, site(bundleZip())))).ok, true);
  assert.ok(c2.log.some((l) => /clearing a stale prepare lock .*no longer running/.test(l)));

  const c3 = freshCase();
  fs.mkdirSync(c3.work);
  fs.writeFileSync(path.join(c3.work, 'prepare.lock'), JSON.stringify({ pid: process.pid, at: Date.now() - 3 * 60 * 60 * 1000 }));
  assert.equal((await win32update.prepare(prepareOpts(c3, site(bundleZip())))).ok, true);
  assert.ok(c3.log.some((l) => /clearing a stale prepare lock .*too old/.test(l)));
});

test('B0: leftovers of an earlier attempt are cleared before a new one', async () => {
  const c = freshCase();
  fs.mkdirSync(path.join(c.work, 'staged', 'app'), { recursive: true });
  fs.writeFileSync(path.join(c.work, 'staged', 'app', 'old.js'), 'from last time');
  fs.writeFileSync(path.join(c.work, 'download.part'), 'half of last time');
  const r = await win32update.prepare(prepareOpts(c, site(bundleZip())));
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(path.join(r.stagedDir, 'app', 'old.js')), false);
});

/* ─── live execution (convention 3) ───────────────────────────────────────────────────────── */

test('live execution: in a test process with no seam, prepare throws before touching anything', async () => {
  const c = freshCase();
  const s = site(bundleZip());
  const o = prepareOpts(c, s);
  delete o.liveExecutionAllowed;
  await assert.rejects(win32update.prepare(o), /engine\/win32update\.js tried to execute "prepare --root .*" for real inside a test process/);
  assert.deepEqual(s.urls, []);
  assert.equal(fs.existsSync(c.work), false);
});

test('live execution: in a production process that never armed it, prepare warns and refuses', () => {
  const c = freshCase();
  const script = [
    `const w = require(${JSON.stringify(path.join(__dirname, 'win32update.js'))});`,
    `w.prepare({ root: ${JSON.stringify(c.root)}, platform: 'win32', arch: 'x64', base: 'https://unreachable.example.test/dist',`,
    `  env: ${JSON.stringify(c.env)}, fetch: async () => { throw new Error('the network was reached'); } })`,
    '  .then((r) => process.stdout.write(JSON.stringify(r)));',
  ].join('\n');
  const out = cp.spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: process.env });
  const r = JSON.parse(out.stdout);
  assert.equal(r.ok, false);
  assert.match(r.because, /live execution is off/);
  assert.match(out.stderr, /\[live-execution\] engine\/win32update\.js: not authorized to run live/);
  assert.equal(fs.existsSync(c.work), false);
});

/* ─── the live-check CLI ──────────────────────────────────────────────────────────────────── */

test('the CLI is a dry run without --yes, and requiring the module does nothing', () => {
  const c = freshCase();
  const cli = path.join(__dirname, 'win32update.js');
  const dry = cp.spawnSync(process.execPath, [cli, '--prepare', '--root', c.root, '--base', BASE], { encoding: 'utf8' });
  assert.equal(dry.status, 2, dry.stderr);
  const said = JSON.parse(dry.stdout);
  assert.equal(said.dryRun, true);
  assert.equal(said.writesUnder, c.work);
  assert.equal(fs.existsSync(c.work), false);
  const usage = cp.spawnSync(process.execPath, [cli, '--prepare'], { encoding: 'utf8' });
  assert.equal(usage.status, 64);
  assert.match(usage.stdout, /^usage: node engine\/win32update\.js --prepare --root <folder>/);
});

/* ─── pins ────────────────────────────────────────────────────────────────────────────────── */

const BUILD_SCRIPT = fs.readFileSync(path.join(REPO, 'tools', 'build-kosmos-windows.sh'), 'utf8');

test('REQUIRED_ENTRIES is the build script\'s own list of what its zip must contain', () => {
  const loop = /for want in (.+?); do/.exec(BUILD_SCRIPT);
  assert.ok(loop, 'the build script no longer checks its zip with a `for want in` list');
  const wants = [...loop[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(wants.length >= 10, 'the control: the list was read');
  assert.match(BUILD_SCRIPT, /\*" bin\/kosmos"\$'\\n'\*\)/, 'the separate check for the extensionless bin/kosmos');
  assert.deepEqual([...win32update.REQUIRED_ENTRIES].sort(), [...wants, 'bin/kosmos'].sort());
});

test('ENTRIES is every top-level name the build script stages, so the swap can never miss one', () => {
  /* Commands only: the script's comments quote `$STAGE/...` paths in prose. */
  const commands = BUILD_SCRIPT.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  const staged = new Set([...commands.matchAll(/"\$STAGE\/([^"/\n]+)/g)].map((m) => m[1]));
  assert.ok(staged.has('app') && staged.has('manifest.json'), 'the control: the staging writes were read');
  /* `dl` is named only by the guard that asserts it is ABSENT from the staging tree. */
  assert.match(BUILD_SCRIPT, /\[ ! -e "\$STAGE\/dl" \]/);
  staged.delete('dl');
  assert.deepEqual([...staged].sort(), [...win32update.ENTRIES].sort());
  assert.ok(!win32update.ENTRIES.includes('Projects'), "the person's projects are never an entry");
});

/* ─── a real build ────────────────────────────────────────────────────────────────────────── */

const SAMPLE = process.env.KOSMOS_WIN_ZIP_SAMPLE;
test('a real Kosmos build stages end to end under the real caps, and its real node.exe runs',
  { skip: !SAMPLE && 'set KOSMOS_WIN_ZIP_SAMPLE to a real kosmos-win-x64.zip to run this' }, async () => {
    const zip = fs.readFileSync(SAMPLE);
    const L = win32update.DEFAULT_LIMITS;
    const entries = win32zip.readZipDirectory(zip, {
      allowedTopLevel: win32update.ENTRIES, maxEntries: L.maxEntries, maxEntryBytes: L.maxEntryBytes, maxTotalBytes: L.maxUnpackedBytes,
    });
    assert.deepEqual([...new Set(entries.map((e) => e.segments[0]))].sort(), [...win32update.ENTRIES].sort());
    const manifestEntry = entries.find((e) => e.name === 'manifest.json');
    const manifestRaw = zip.subarray(manifestEntry.dataStart, manifestEntry.dataStart + manifestEntry.compressedSize);
    const { version } = JSON.parse((manifestEntry.method === 8 ? require('node:zlib').inflateRawSync(manifestRaw) : manifestRaw).toString('utf8'));
    const c = freshCase();
    /* An installed folder older than the sample, so the sample is the newer build on offer. */
    fs.writeFileSync(path.join(c.root, 'app', 'package.json'), JSON.stringify({ version: '0.0.1' }));
    /* The real free-disk reading, and on Windows the real runner over the real staged node.exe. */
    const opts = prepareOpts(c, site(zip, { pointer: pointerBody(zip, { version }) }), { freeBytes: undefined });
    if (process.platform === 'win32') delete opts.runStagedNode;
    const r = await win32update.prepare(opts);
    assert.equal(r.ok, true, r.because);
    assert.equal(r.version, version);
    assert.match(r.expectedIdentity, new RegExp(`^${version.replace(/\./g, '\\.')}\\+[0-9a-f]{12}@default$`));
    assert.equal(fs.statSync(path.join(r.stagedDir, 'runtime', 'node.exe')).size,
      entries.find((e) => e.name === 'runtime/node.exe').uncompressedSize);
  });
