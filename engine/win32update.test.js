'use strict';
/**
 * win32-update-stage (updater slice S2): `prepare()` downloads, verifies and stages a Windows
 * build, and never swaps it in.
 *
 * Every case runs in a sandbox: a Kosmos folder (ROOT) with a person's own `Projects` inside it,
 * an anchor folder with its `engine-path` and `node.exe`, and sandboxed store, projects and
 * workers roots. The network is an injected fetch serving zips built in the test, and the
 * staged `node.exe` is a stub, except in the cases that run a real interpreter. Nothing here
 * reaches the release host. Every test carries a timeout, so a reverted guard fails instead of
 * hanging.
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
const worlds = require('./worlds');
const { buildZip } = require('../test-support/zipfixture');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const T = { timeout: 10000 };
const REPO = path.join(__dirname, '..');
const ARCH = 'x64';
const INSTALLED = '0.6.55';
const NEXT = '0.6.60';
const SOURCE_SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const NODE_VERSION = 'v24.19.0';
const BASE = 'https://updates.example.test/dist';
const README = '! READ ME FIRST - Windows will warn you.txt';
const PLENTY_OF_DISK = 64 * 1024 * 1024 * 1024;
const ON_WINDOWS = process.platform === 'win32';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const zipName = (version) => `kosmos-${version}-win-${ARCH}.zip`;
const under = (child, parent) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || !(rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel));
};

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
/**
 * Every file and folder under `top` (contents and mtime), except the folders in `skip`. A folder
 * that HOLDS a skipped one (ROOT, which holds WORK) is recorded without its mtime: creating or
 * removing WORK is what changes it. recordWrites catches anything else written there.
 */
function snapshot(top, skip) {
  const seen = {};
  const skipped = skip.map((s) => path.resolve(s));
  const holders = skipped.map((s) => path.dirname(s));
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (skipped.includes(path.resolve(full))) continue;
      const rel = path.relative(top, full);
      if (e.isSymbolicLink()) { seen[rel] = 'link ' + fs.readlinkSync(full); continue; }
      if (e.isDirectory()) {
        seen[rel + path.sep] = holders.includes(path.resolve(full)) ? 'folder holding WORK' : 'folder ' + fs.statSync(full).mtimeMs;
        walk(full);
        continue;
      }
      seen[rel] = sha256(fs.readFileSync(full)) + ' ' + fs.statSync(full).mtimeMs;
    }
  })(top);
  return seen;
}
/**
 * Every path the file system is asked to WRITE while `run` is pending: created, written, moved,
 * linked or removed, temporary files included. Reads are not recorded.
 */
async function recordWrites(run) {
  const written = [];
  const note = (p) => { if (p !== undefined && p !== null && typeof p !== 'number') written.push(path.resolve(String(p))); };
  const spies = {
    openSync: (p, flags) => { if (flags !== undefined && flags !== 'r' && flags !== 'rs' && flags !== 0) note(p); },
    writeFileSync: (p) => note(p),
    appendFileSync: (p) => note(p),
    mkdirSync: (p) => note(p),
    rmSync: (p) => note(p),
    rmdirSync: (p) => note(p),
    unlinkSync: (p) => note(p),
    renameSync: (a, b) => { note(a); note(b); },
    linkSync: (a, b) => note(b),
    symlinkSync: (a, b) => note(b),
    copyFileSync: (a, b) => note(b),
    cpSync: (a, b) => note(b),
    utimesSync: (p) => note(p),
    truncateSync: (p) => note(p),
  };
  const real = {};
  for (const [name, spy] of Object.entries(spies)) {
    real[name] = fs[name];
    fs[name] = function recorded(...args) { spy(...args); return real[name].apply(this, args); };
  }
  try { await run(); } finally { for (const name of Object.keys(spies)) fs[name] = real[name]; }
  return written;
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

/* ─── the happy path and the path guard ───────────────────────────────────────────────────── */

test('the happy path: downloaded, checked and staged, with the identity the new board will answer with', T, async () => {
  const c = freshCase();
  const zip = bundleZip();
  /* An alias that names some other file, so a read of `artifact` would show up in the URLs. */
  const s = site(zip, { pointer: pointerBody(zip, { artifact: 'kosmos-something-else.zip' }) });
  const before = snapshot(SANDBOX, [c.work]);
  let r;
  const written = await recordWrites(async () => { r = await win32update.prepare(prepareOpts(c, s)); });
  assert.deepEqual(r, {
    ok: true, version: NEXT, sha256: sha256(zip), stagedDir: path.join(c.work, 'staged'),
    runtimeChanged: true, expectedIdentity: `${NEXT}+${SOURCE_SHA.slice(0, 12)}@default`,
  });
  for (const entry of win32update.REQUIRED_ENTRIES) {
    assert.ok(fs.statSync(path.join(r.stagedDir, ...entry.split('/'))).isFile(), `${entry} is staged`);
  }
  assert.equal(fs.readFileSync(path.join(r.stagedDir, 'app', 'server.js'), 'utf8'), '// the new server\n'.repeat(40));
  assert.deepEqual(c.nodeRuns, [path.join(r.stagedDir, 'runtime', 'node.exe')], 'the STAGED interpreter is the one run');
  assert.deepEqual(workHolds(c), ['prepare-status.json', 'staged'], 'the download, the lock and its draft are gone');
  assert.equal(readJson(path.join(c.work, 'prepare-status.json')).expectedIdentity, r.expectedIdentity);
  assert.deepEqual(s.urls, [
    `${BASE}/latest-win.json`,
    `${BASE}/${zipName(NEXT)}.sha256`,
    `${BASE}/${zipName(NEXT)}?v=${NEXT}`,
  ], 'the pointer, the sidecar, then the versioned zip with its cache-buster; never the alias');
  /* 🛑 THE PATH GUARD, twice. Every path the file system was asked to write -- temporary files
     included -- is WORK or inside it; and everything outside WORK is byte-for-byte and
     mtime-for-mtime unchanged, folders included. */
  assert.ok(written.length > 10, 'the control: the writes were recorded');
  assert.deepEqual(written.filter((p) => !under(p, c.work)), [], 'written outside WORK');
  assert.ok(written.some((p) => p === path.join(c.work, 'download.part')), 'the control: the temporary download is among the writes');
  assert.deepEqual(snapshot(SANDBOX, [c.work]), before);
});

test('the path guard holds on a failure too: a damaged entry, cleaned up without a write outside WORK', T, async () => {
  const c = freshCase();
  const before = snapshot(SANDBOX, [c.work]);
  const written = await recordWrites(() => refusedWith(c, site(bundleZip({ entryOver: { 'bin/kosmos-cli.js': { crc: 1 } } })), /"bin\/kosmos-cli\.js" is damaged/));
  assertCleanedUp(c, /damaged/);
  assert.ok(written.length > 5);
  assert.deepEqual(written.filter((p) => !under(p, c.work)), []);
  assert.deepEqual(snapshot(SANDBOX, [c.work]), before);
});

test('workGuard: only paths strictly inside WORK', T, () => {
  const work = path.join(SANDBOX, 'guard', 'Kosmos', '.kosmos-update');
  const guard = win32update.workGuard(work);
  assert.equal(guard(path.join(work, 'download.part')), path.join(work, 'download.part'));
  assert.equal(guard(path.join(work, 'staged', 'app', 'x.js')), path.join(work, 'staged', 'app', 'x.js'));
  for (const outside of [work, path.join(work, '..', 'download.part'), path.join(path.dirname(work), 'app'), work + 'x', path.parse(work).root]) {
    assert.throws(() => guard(outside), /which is outside/, outside);
  }
});

test('the staging channel reads the staging pointer, and never falls back to prod', T, async () => {
  const c = freshCase();
  const s = site(bundleZip());
  const r = await win32update.prepare(prepareOpts(c, s, { channel: 'staging' }));
  assert.equal(r.ok, false);
  assert.deepEqual(s.urls, [`${BASE}/latest-win-staging.json`]);
  assert.match(r.because, /answered 404 for the update pointer/);
});

test('runtimeChanged: the same interpreter is unchanged; the same size with other bytes is changed', T, async () => {
  const same = 'the one node.exe, byte for byte';
  const c1 = freshCase({ anchoredNode: same });
  assert.equal((await win32update.prepare(prepareOpts(c1, site(bundleZip({ nodeBytes: same }))))).runtimeChanged, false);
  const c2 = freshCase({ anchoredNode: 'A'.repeat(32) });
  assert.equal((await win32update.prepare(prepareOpts(c2, site(bundleZip({ nodeBytes: 'B'.repeat(32) }))))).runtimeChanged, true, 'equal sizes fall through to the hash');
  const c3 = freshCase();
  fs.rmSync(path.join(c3.anchor, win32anchor.NODE_NAME));
  assert.equal((await win32update.prepare(prepareOpts(c3, site(bundleZip())))).runtimeChanged, true, 'no anchored interpreter at all');
});

test('runtimeChanged starts from the anchor\'s own size rule: whenever the anchor would copy, the update says changed', T, () => {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'sizes-'));
  const file = (name, bytes) => { const p = path.join(dir, name); fs.writeFileSync(p, bytes); return p; };
  const pairs = [
    [file('a1', 'AAAA'), file('b1', 'AAAA')],
    [file('a2', 'AAAA'), file('b2', 'BBBB')],
    [file('a3', 'AAAA'), file('b3', 'AAAAAA')],
    [file('a4', 'AAAA'), path.join(dir, 'missing')],
  ];
  const expected = [false, false, true, true];
  pairs.forEach(([src, at], i) => assert.equal(win32anchor.interpreterSizeDiffers(src, at), expected[i], `pair ${i}`));
  const source = fs.readFileSync(path.join(__dirname, 'win32update.js'), 'utf8');
  assert.match(source, /function interpreterDiffers\(stagedNode, anchoredNode\) \{\s*if \(win32anchor\.interpreterSizeDiffers\(stagedNode, anchoredNode\)\) return true;/,
    'runtimeChanged must start from the anchor\'s size rule, not a second copy of it');
  const anchorSource = fs.readFileSync(path.join(__dirname, 'win32anchor.js'), 'utf8');
  assert.match(anchorSource, /if \(interpreterSizeDiffers\(srcNode, nodeAt\)\) win32swap\.replaceInterpreter\(srcNode, nodeAt, clock\);/,
    'ensureAnchored must decide with the same exported rule');
});

/* ─── B1 ──────────────────────────────────────────────────────────────────────────────────── */

test('B1: an unreadable pointer, or one for another arch, is refused', T, async () => {
  const zip = bundleZip();
  await refusedWith(freshCase(), site(zip, { pointer: 'not json at all' }), /does not name a Windows build for this computer \(x64\)/);
  const other = site(zip, { pointer: pointerBody(zip, { versioned: `kosmos-${NEXT}-win-arm64.zip` }) });
  await refusedWith(freshCase(), other, /does not name a Windows build/);
  assert.deepEqual(other.urls, [`${BASE}/latest-win.json`], 'nothing past the pointer');
});

test('B1: a version that is not newer than the installed one is refused', T, async () => {
  const zip = bundleZip({ version: INSTALLED });
  const s = site(zip, { pointer: pointerBody(zip, { version: INSTALLED }) });
  await refusedWith(freshCase(), s, /this Kosmos is 0\.6\.55 and the site offers 0\.6\.55, so there is nothing newer/);
  assert.equal(s.urls.length, 1);
});

test('B1: a pointer that moved since the offer the person accepted is refused', T, async () => {
  const s = site(bundleZip());
  await refusedWith(freshCase(), s, /now offers 0\.6\.60, not the 0\.6\.58 that was on offer/, { expectVersion: '0.6.58' });
  assert.equal(s.urls.length, 1);
});

/* ─── B2 ──────────────────────────────────────────────────────────────────────────────────── */

test('B2: a sidecar that disagrees with the pointer is refused before the zip is fetched', T, async () => {
  const c = freshCase();
  const zip = bundleZip();
  const s = site(zip, { sidecar: `${'ab'.repeat(32)}  ${zipName(NEXT)}\n` });
  await refusedWith(c, s, /checksum file and its update pointer disagree/);
  assert.equal(s.urls.some((u) => u.includes('.zip?v=')), false, 'the 37 MB download never started');
  assertCleanedUp(c, /disagree/);
});

test('B2: a download that does not hash to the published sha is refused, and the part file removed', T, async () => {
  const c = freshCase();
  const zip = bundleZip();
  const s = site(zip, { pointer: pointerBody(zip, { sha256: 'cd'.repeat(32) }) });
  await refusedWith(c, s, /does not match the checksum the site published/);
  assert.ok(s.urls.some((u) => u.includes('.zip?v=')), 'the control: the zip really was downloaded');
  assertCleanedUp(c, /does not match/);
});

test('B2: a sidecar that names a different file is refused', T, async () => {
  const zip = bundleZip();
  await refusedWith(freshCase(), site(zip, { sidecar: `${sha256(zip)}  kosmos-0.6.1-win-x64.zip\n` }), /names kosmos-0\.6\.1-win-x64\.zip, not kosmos-0\.6\.60-win-x64\.zip/);
  await refusedWith(freshCase(), site(zip, { sidecar: 'not a checksum' }), /could not be read/);
});

test('B2: a truncated download is refused, with or without a Content-Length', T, async () => {
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

test('B2: more bytes than the Content-Length announced is refused, and not called stopping early', T, async () => {
  const c = freshCase();
  const zip = bundleZip();
  const longer = Buffer.concat([zip, Buffer.from('trailing bytes')]);
  const r = await refusedWith(c, site(zip, { zipResponse: () => new Response(longer, { headers: { 'content-length': String(zip.length) } }) }),
    new RegExp(`sent ${longer.length} bytes after announcing ${zip.length}`));
  assert.doesNotMatch(r.because, /stopped early/);
  assertCleanedUp(c, /after announcing/);
});

test('B2: the size cap, announced by Content-Length or discovered while streaming', T, async () => {
  const zip = bundleZip();
  const limits = { maxDownloadBytes: 1000 };
  /* Announced: refused from the header, in the header's own words (it names the size), before
     the body is read -- the streaming cap below would otherwise catch the same download later. */
  const c1 = freshCase();
  await refusedWith(c1, site(zip), new RegExp(`the update is ${zip.length} bytes, larger than the 1000 bytes this updater will download`), { limits });
  assertCleanedUp(c1, /larger than/);
  const chunked = (z) => new Response(new ReadableStream({
    start(ctl) { for (let at = 0; at < z.length; at += 400) ctl.enqueue(z.subarray(at, at + 400)); ctl.close(); },
  }));
  const c2 = freshCase();
  await refusedWith(c2, site(zip, { zipResponse: chunked }), /the update is larger than the 1000 bytes/, { limits });
  assertCleanedUp(c2, /larger than/);
  /* The control: the same chunked stream under the real cap stages fine. */
  assert.equal((await win32update.prepare(prepareOpts(freshCase(), site(zip, { zipResponse: chunked })))).ok, true);
});

test('B2: the time cap ends a download that stops sending, even when the transport ignores the abort', T, async () => {
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

test('B2: a release host that answers 404 is refused, and the log names the URL and the status', T, async () => {
  const c = freshCase();
  await refusedWith(c, site(bundleZip(), { zipResponse: () => new Response('gone', { status: 404 }) }), /answered 404 for the update/);
  assert.ok(c.log.includes(`GET failed url=${BASE}/${zipName(NEXT)}?v=${NEXT} status=404`), c.log.join('\n'));
});

test('B2: too little free disk is refused before a byte is written', T, async () => {
  const c = freshCase();
  const zip = bundleZip();
  await refusedWith(c, site(zip), new RegExp(`needs about ${4 * zip.length} bytes free and there is 1000 bytes`), { freeBytes: () => 1000 });
  assertCleanedUp(c, /not enough free disk space/);
});

/* ─── B3 ──────────────────────────────────────────────────────────────────────────────────── */

test('B3: what is unpacked is the bytes that were hashed, not whatever download.part holds afterwards', T, async () => {
  const c = freshCase();
  const zip = bundleZip();
  const swapped = bundleZip({ extra: { 'evil.txt': 'arrived after the hash' } });
  let rewritten = false;
  const r = await win32update.prepare(prepareOpts(c, site(zip), {
    /* "downloaded ..." is logged once the hash is done and before B3 starts: the moment for
       something else to rewrite the file on disk, ahead of any read B3 could make. */
    log: (line) => {
      c.log.push(line);
      if (line.startsWith('downloaded ')) { fs.writeFileSync(path.join(c.work, 'download.part'), swapped); rewritten = true; }
    },
  }));
  assert.equal(rewritten, true, 'the control: the file really was rewritten between the hash and the unpack');
  assert.equal(r.ok, true, r.because);
  assert.equal(fs.existsSync(path.join(r.stagedDir, 'evil.txt')), false);
});

test('B3: too little free disk for the unpacked tree is refused before unpacking', T, async () => {
  const c = freshCase();
  let asked = 0;
  await refusedWith(c, site(bundleZip()), /the update unpacks to \d+ bytes and there is 10 bytes free/, {
    freeBytes: () => { asked += 1; return asked === 1 ? PLENTY_OF_DISK : 10; },
  });
  assertCleanedUp(c, /unpacks to/);
});

test('B3: a stray top-level entry is refused, and nothing is left staged', T, async () => {
  const c = freshCase();
  const before = snapshot(SANDBOX, [c.work]);
  await refusedWith(c, site(bundleZip({ extra: { 'evil.txt': 'not part of a build' } })), /"evil\.txt" is not part of a Kosmos build/);
  assertCleanedUp(c, /not part of a Kosmos build/);
  assert.deepEqual(snapshot(SANDBOX, [c.work]), before);
});

test('B3: a zip-slip inside a correctly signed download writes nothing outside WORK', T, async () => {
  const c = freshCase();
  const before = snapshot(SANDBOX, [c.work]);
  await refusedWith(c, site(bundleZip({ extra: { 'app/../../../escaped.txt': 'out' } })), /climbs out of its folder/);
  assertCleanedUp(c, /climbs out/);
  assert.deepEqual(snapshot(SANDBOX, [c.work]), before, 'nothing escaped');
});

/* ─── B4 ──────────────────────────────────────────────────────────────────────────────────── */

test('B4: a manifest.json for another version, platform or arch is refused', T, async () => {
  const c1 = freshCase();
  await refusedWith(c1, site(bundleZip({ manifest: { version: '0.6.59' } })), /manifest\.json says "0\.6\.59", but the site published it as 0\.6\.60/);
  assertCleanedUp(c1, /manifest\.json says/);
  await refusedWith(freshCase(), site(bundleZip({ manifest: { platform: 'darwin' } })), /manifest\.json is for "darwin", not Windows/);
  await refusedWith(freshCase(), site(bundleZip({ manifest: { arch: 'arm64' } })), /manifest\.json is for "arm64", not this computer \(x64\)/);
  await refusedWith(freshCase(), site(bundleZip({ omit: ['manifest.json'] })), /no readable manifest\.json/);
});

test('B4: an app whose package.json disagrees with the manifest is refused', T, async () => {
  const c = freshCase();
  await refusedWith(c, site(bundleZip({ pkgVersion: '0.6.59' })), /app says it is "0\.6\.59", but the site published it as 0\.6\.60/);
  assertCleanedUp(c, /app says/);
});

test('B4: a build missing a required entry is refused', T, async () => {
  const c = freshCase();
  await refusedWith(c, site(bundleZip({ omit: ['bin/kosmos.ps1'] })), /the update is missing bin\\kosmos\.ps1/);
  assertCleanedUp(c, /missing/);
  await refusedWith(freshCase(), site(bundleZip({ omit: ['runtime/node.exe'] })), /missing runtime\\node\.exe/);
});

test('B4: a staged node.exe that does not run, times out, or reports the wrong version is refused', T, async () => {
  const c1 = freshCase();
  await refusedWith(c1, site(bundleZip()), /did not run \(spawn UNKNOWN\)/, { runStagedNode: () => { throw new Error('spawn UNKNOWN'); } });
  assertCleanedUp(c1, /did not run/);
  const timeout = () => { throw Object.assign(new Error('spawnSync node.exe ETIMEDOUT'), { code: 'ETIMEDOUT' }); };
  await refusedWith(freshCase(), site(bundleZip()), /did not answer within 20 seconds/, { runStagedNode: timeout });
  await refusedWith(freshCase(), site(bundleZip()), /is v22\.1\.0, but its manifest\.json names v24\.19\.0/, { runStagedNode: () => 'v22.1.0' });
  await refusedWith(freshCase(), site(bundleZip()), /did not report a version \(it printed "hello"\)/, { runStagedNode: () => 'hello' });
});

test('B4: the staged interpreter runs from its own folder, with a timeout, no window, and none of the board\'s environment', T, () => {
  const saved = { NODE_OPTIONS: process.env.NODE_OPTIONS, KOSMOS_PROBE_SECRET: process.env.KOSMOS_PROBE_SECRET };
  process.env.NODE_OPTIONS = '--require ./this-file-does-not-exist.js';
  process.env.KOSMOS_PROBE_SECRET = 'a credential the board happens to hold';
  try {
    const nodeExe = path.join(SANDBOX, 'staged-runtime', 'node.exe');
    const launch = win32update.stagedNodeLaunch(nodeExe, 1234);
    assert.equal(launch.file, nodeExe);
    assert.deepEqual(launch.args, ['-p', 'process.version']);
    assert.equal(launch.options.cwd, path.dirname(nodeExe));
    assert.equal(launch.options.timeout, 1234);
    assert.equal(launch.options.windowsHide, true);
    assert.deepEqual(Object.keys(launch.options.env).filter((k) => !win32update.STAGED_NODE_ENV_KEYS.includes(k)), []);
    assert.equal('NODE_OPTIONS' in launch.options.env, false);
    assert.equal('KOSMOS_PROBE_SECRET' in launch.options.env, false);
    /* And for real: with that NODE_OPTIONS in this process, a leaked environment would stop the
       child from starting at all. */
    assert.equal(win32update.runStagedNode(process.execPath, 20000), process.version);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
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

test('B0: only Windows, and only a Windows bundle', T, async () => {
  const c = freshCase();
  await refusedBeforeStarting(c, /this is not Windows/, { platform: 'darwin' });
  await refusedBeforeStarting(freshCase({ layout: false }), /is not a Kosmos for Windows folder/);
  assert.equal(fs.existsSync(c.work), false);
});

test('B0: the anchor must point at this folder', T, async () => {
  await refusedBeforeStarting(freshCase({ pointer: null }), /no record of which folder it starts from/);
  const elsewhere = path.join(SANDBOX, 'elsewhere', 'app', 'engine');
  const c = freshCase({ pointer: elsewhere });
  await refusedBeforeStarting(c, new RegExp(`starts from ${elsewhere.replace(/\\/g, '\\\\')}, not from`));
  assert.equal(fs.existsSync(c.work), false);
});

test('B0: never the top of a drive', T, async () => {
  const c = freshCase();
  await refusedBeforeStarting(c, /is the top of a drive/, { root: path.parse(c.root).root });
});

test('B0: never inside the data, projects, workers or anchor folders', T, async () => {
  await refusedBeforeStarting(freshCase({ root: path.join(store.ROOT, 'Kosmos') }), /inside the Kosmos data folder/);
  await refusedBeforeStarting(freshCase({ root: path.join(process.env.AGENT_WORKFORCE_PROJECTS, 'Kosmos') }), /inside the projects folder/);
  await refusedBeforeStarting(freshCase({ root: path.join(process.env.AGENT_WORKFORCE_WORKERS, 'Kosmos') }), /inside the agents' folders/);
  const c = freshCase();
  await refusedBeforeStarting(c, /inside the folder Kosmos starts from at logon/, { root: path.join(c.anchor, 'Kosmos') });
});

test('B0: a protected folder inside one of the entries an update replaces is refused; Projects beside them is fine', T, async () => {
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

test('B0: a junction cannot hide a protected folder inside an entry, or ROOT inside a protected folder',
  { ...T, skip: !ON_WINDOWS && 'junctions are a Windows feature' }, async () => {
    const saved = process.env.AGENT_WORKFORCE_PROJECTS;
    try {
      /* J leads to ROOT\app, so J\Projects is really ROOT\app\Projects, which the swap would move. */
      const c1 = freshCase();
      const toApp = path.join(c1.dir, 'J');
      fs.symlinkSync(path.join(c1.root, 'app'), toApp, 'junction');
      fs.mkdirSync(path.join(c1.root, 'app', 'Projects'));
      process.env.AGENT_WORKFORCE_PROJECTS = path.join(toApp, 'Projects');
      await refusedBeforeStarting(c1, /the projects folder .* is inside .*app, which an update replaces/);
      /* The same through a junction to a projects folder that does not exist yet. */
      process.env.AGENT_WORKFORCE_PROJECTS = path.join(toApp, 'NotYet', 'Projects');
      await refusedBeforeStarting(c1, /is inside .*app, which an update replaces/);
      /* J leads to the folder holding ROOT, so the projects folder really contains ROOT. */
      const c2 = freshCase();
      const toCase = path.join(SANDBOX, 'J2-' + caseCount);
      fs.symlinkSync(c2.dir, toCase, 'junction');
      process.env.AGENT_WORKFORCE_PROJECTS = toCase;
      await refusedBeforeStarting(c2, /is inside the projects folder/);
      /* The control: the same projects folder, reached without a junction, beside ROOT, is fine. */
      process.env.AGENT_WORKFORCE_PROJECTS = path.join(c2.root, 'Projects');
      assert.equal((await win32update.prepare(prepareOpts(c2, site(bundleZip())))).ok, true);
    } finally {
      process.env.AGENT_WORKFORCE_PROJECTS = saved;
    }
  });

test('B0: a WORK folder that is a link or a file is refused, and nothing is written through it', T, async () => {
  const c1 = freshCase();
  const outside = path.join(c1.dir, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, c1.work, ON_WINDOWS ? 'junction' : 'dir');
  await refusedBeforeStarting(c1, /is a link to somewhere else/);
  assert.deepEqual(fs.readdirSync(outside), []);
  const c2 = freshCase();
  fs.writeFileSync(c2.work, 'a file where the folder goes');
  await refusedBeforeStarting(c2, /is a file, not a folder/);
});

test('B0: a second prepare while one is in flight is refused', T, async () => {
  const c = freshCase();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const held = (z) => new Response(new ReadableStream({ async pull(ctl) { await gate; ctl.enqueue(z); ctl.close(); } }),
    { headers: { 'content-length': String(z.length) } });
  const s = site(bundleZip(), { zipResponse: held });
  const first = win32update.prepare(prepareOpts(c, s));
  try {
    /* Bounded, so a first prepare that fails before its download cannot leave this polling
       forever after the test's own timeout (which would keep the whole file from exiting). */
    const giveUpAt = Date.now() + 5000;
    while (!s.urls.some((u) => u.includes('.zip?v='))) {
      if (Date.now() > giveUpAt) assert.fail('the first prepare never reached its download: ' + JSON.stringify(await Promise.race([first, 'still pending'])));
      await new Promise((r) => setTimeout(r, 5));
    }
    await refusedBeforeStarting(freshCase(), /an update is already being prepared/);
  } finally {
    release();
  }
  assert.equal((await first).ok, true, 'the first one finishes');
  assert.equal((await win32update.prepare(prepareOpts(freshCase(), site(bundleZip())))).ok, true, 'and the flag is released after it');
});

test('B0: leftovers of an earlier attempt are cleared before a new one', T, async () => {
  const c = freshCase();
  fs.mkdirSync(path.join(c.work, 'staged', 'app'), { recursive: true });
  fs.writeFileSync(path.join(c.work, 'staged', 'app', 'old.js'), 'from last time');
  fs.writeFileSync(path.join(c.work, 'download.part'), 'half of last time');
  const r = await win32update.prepare(prepareOpts(c, site(bundleZip())));
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(path.join(r.stagedDir, 'app', 'old.js')), false);
});

/* ─── the lock ────────────────────────────────────────────────────────────────────────────── */

function lockDir() { const d = fs.mkdtempSync(path.join(SANDBOX, 'lock-')); return { d, lock: path.join(d, 'prepare.lock') }; }
const deadPid = () => cp.spawnSync(process.execPath, ['-e', '']).pid;

const hoursAgo = (hours) => Date.now() - hours * 60 * 60 * 1000;
function seedLock(c, body) {
  fs.mkdirSync(c.work, { recursive: true });
  fs.writeFileSync(path.join(c.work, 'prepare.lock'), JSON.stringify(body));
}

test('the lock: a running owner holds it whatever its age; a gone owner does not, whatever its age', T, async () => {
  const c1 = freshCase();
  seedLock(c1, { pid: process.pid, at: Date.now() });
  await refusedWith(c1, null, new RegExp(`another update is already being prepared \\(process ${process.pid}\\)`));
  assert.deepEqual(workHolds(c1), ['prepare.lock'], "another prepare's lock is not ours to clear, and no status is written over its work");

  /* Three hours old, far past STALE_LOCK_MS, and its owner still runs: still held. */
  const c2 = freshCase();
  seedLock(c2, { pid: process.pid, at: hoursAgo(3) });
  await refusedWith(c2, null, new RegExp(`another update is already being prepared \\(process ${process.pid}\\)`));
  assert.deepEqual(workHolds(c2), ['prepare.lock'], 'a running owner\'s lock is never moved or removed');

  for (const at of [Date.now(), hoursAgo(3)]) {
    const c = freshCase();
    seedLock(c, { pid: deadPid(), at });
    assert.equal((await win32update.prepare(prepareOpts(c, site(bundleZip())))).ok, true);
    assert.ok(c.log.some((l) => /cleared a stale prepare lock \(process \d+, no longer running\)/.test(l)), c.log.join('\n'));
  }
});

test('the lock: an owner that cannot be verified falls to the age rule', T, () => {
  const win32orphan = require('./win32orphan');
  const realState = win32orphan.pidState;
  win32orphan.pidState = () => 'unknown';
  try {
    const { lock } = lockDir();
    fs.writeFileSync(lock, JSON.stringify({ pid: 4242, at: Date.now() }));
    assert.throws(() => win32update.takeLock(lock, () => {}), /already being prepared \(process 4242\)/, 'recent: held');
    fs.writeFileSync(lock, JSON.stringify({ pid: 4242, at: hoursAgo(3) }));
    const log = [];
    const text = win32update.takeLock(lock, (l) => log.push(l));
    assert.equal(fs.readFileSync(lock, 'utf8'), text, 'old: cleared and taken');
    assert.ok(log.some((l) => /cleared a stale prepare lock \(process 4242, old, and its owner cannot be checked\)/.test(l)), log.join('\n'));
  } finally {
    win32orphan.pidState = realState;
  }
  /* No pid at all is the same case, judged by its `at`. */
  const { lock } = lockDir();
  fs.writeFileSync(lock, JSON.stringify({ at: Date.now() }));
  assert.throws(() => win32update.takeLock(lock, () => {}), /already being prepared \(its lock is recent, and its owner cannot be checked\)/);
  fs.writeFileSync(lock, JSON.stringify({ at: hoursAgo(3) }));
  assert.doesNotThrow(() => win32update.takeLock(lock, () => {}));
});

test('the lock: pidState keeps the doubt that pidAlive resolves toward alive', T, () => {
  const win32orphan = require('./win32orphan');
  const throwing = (code) => () => { throw Object.assign(new Error(code), { code }); };
  assert.equal(win32orphan.pidState(1, throwing('ESRCH')), 'gone');
  assert.equal(win32orphan.pidState(1, throwing('EPERM')), 'alive');
  assert.equal(win32orphan.pidState(1, throwing('EWHATEVER')), 'unknown');
  assert.equal(win32orphan.pidState(1, () => true), 'alive');
  assert.equal(win32orphan.pidAlive(1, throwing('EWHATEVER')), true, 'pidAlive is unchanged');
  assert.equal(win32orphan.pidAlive(1, throwing('ESRCH')), false);
});

test('the lock: a drive without hard links is refused in words, and only the error code is logged', T, async () => {
  const c = freshCase();
  const realLink = fs.linkSync;
  fs.linkSync = (from, to) => {
    throw Object.assign(new Error(`EPERM: operation not permitted, link '${from}' -> '${to}'`), { code: 'EPERM' });
  };
  let r;
  try { r = await win32update.prepare(prepareOpts(c, site(bundleZip()))); } finally { fs.linkSync = realLink; }
  assert.equal(r.ok, false);
  assert.match(r.because, /^Kosmos could not take its update lock: this drive can't make the hard links the updater needs \(common on FAT32 or exFAT drives\), so update by hand, or keep Kosmos on an NTFS drive$/);
  assert.doesNotMatch(r.because, /EPERM|draft|prepare\.lock|kosmos-update/, 'no raw error and no internal path');
  assert.ok(c.log.includes('could not take the prepare lock: link failed with code=EPERM'), c.log.join('\n'));
  assert.equal(c.log.some((l) => l.includes('.draft')), false, 'the log names the code, not the paths');
  assert.deepEqual(workHolds(c), [], 'nothing left behind: no draft, no lock, and no status over work it never held');
});

test('the lock: once held, the leftovers of attempts that died mid-lock are swept', T, async () => {
  const c = freshCase();
  fs.mkdirSync(c.work);
  const strays = [
    'prepare.lock.123-1700000000000-abcd1234.draft',
    'prepare.lock.0123456789abcdef.clearing',
    'prepare.lock.456-1700000000000-ef567890.cleared',
  ];
  for (const name of strays) fs.writeFileSync(path.join(c.work, name), JSON.stringify({ pid: deadPid(), at: Date.now() }));
  assert.equal((await win32update.prepare(prepareOpts(c, site(bundleZip())))).ok, true);
  assert.deepEqual(workHolds(c), ['prepare-status.json', 'staged'], 'only the outcome and the staged build remain');
});

test('the lock: a clear claim left by a clearer that died is stepped past, never deleted by a clearer', T, () => {
  const { lock } = lockDir();
  const stale = JSON.stringify({ pid: deadPid(), at: Date.now() });
  fs.writeFileSync(lock, stale);
  const deadClaim = `${lock}.${sha256(stale).slice(0, 16)}.clearing`;
  fs.writeFileSync(deadClaim, JSON.stringify({ pid: deadPid(), at: Date.now() }));
  const text = win32update.takeLock(lock, () => {});
  assert.equal(fs.readFileSync(lock, 'utf8'), text);
  assert.ok(fs.existsSync(deadClaim), "the dead claim is left for the holder's sweep");
});

test('the lock: a third prepare arriving while a stale lock is being removed cannot become a second holder', T, () => {
  const { d, lock } = lockDir();
  fs.writeFileSync(lock, JSON.stringify({ pid: deadPid(), at: Date.now() }));
  let third = null;
  const mine = win32update.takeLock(lock, () => {}, {
    /* After this prepare has read the stale lock again and before it removes it: the moment a
       clearer without the claim would remove whatever lock had just replaced the stale one. */
    beforeRemove: () => {
      try { win32update.takeLock(lock, () => {}); third = 'took the lock'; } catch (e) { third = e.message; }
    },
  });
  assert.match(third, /already being prepared \(process \d+ is clearing an old lock\)/);
  assert.equal(fs.readFileSync(lock, 'utf8'), mine, 'exactly one holder');
  assert.deepEqual(fs.readdirSync(d), ['prepare.lock']);
});

test('the lock: an empty lock that was only just written is held; an old empty one is cleared', T, () => {
  const { lock } = lockDir();
  fs.writeFileSync(lock, '');
  assert.throws(() => win32update.takeLock(lock, () => {}), /already being prepared \(its lock is unreadable, and only just written\)/);
  assert.equal(fs.readFileSync(lock, 'utf8'), '', 'left exactly as it was');
  const longAgo = new Date(Date.now() - 60 * 1000);
  fs.utimesSync(lock, longAgo, longAgo);
  const text = win32update.takeLock(lock, () => {});
  assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).pid, process.pid);
  assert.equal(fs.readFileSync(lock, 'utf8'), text);
});

test('the lock is published whole: its name only ever appears as a link to a finished file', T, async () => {
  const { d, lock } = lockDir();
  const opened = [];
  const realOpen = fs.openSync;
  const realWrite = fs.writeFileSync;
  fs.openSync = function spy(p, ...rest) { opened.push(path.resolve(String(p))); return realOpen.call(this, p, ...rest); };
  fs.writeFileSync = function spy(p, ...rest) { if (typeof p !== 'number') opened.push(path.resolve(String(p))); return realWrite.call(this, p, ...rest); };
  try { win32update.takeLock(lock, () => {}); } finally { fs.openSync = realOpen; fs.writeFileSync = realWrite; }
  assert.ok(opened.length > 0, 'the control: the draft was written');
  assert.equal(opened.includes(path.resolve(lock)), false, 'the lock name was opened for writing, so a reader could see it empty');
  assert.deepEqual(fs.readdirSync(d), ['prepare.lock'], 'and the draft is gone');
});

test('the lock: a stale lock another prepare clears and takes first stays that prepare\'s', T, () => {
  const { d, lock } = lockDir();
  fs.writeFileSync(lock, JSON.stringify({ pid: deadPid(), at: Date.now() }));
  let other = null;
  assert.throws(() => win32update.takeLock(lock, () => {}, {
    /* Between this prepare judging the lock stale and claiming it, another prepare clears the
       same lock and takes the name. */
    beforeClear: () => { other = win32update.takeLock(lock, () => {}); },
  }), new RegExp(`already being prepared \\(process ${process.pid}\\)`));
  assert.ok(other, 'the control: the other prepare really did take the lock');
  assert.equal(fs.readFileSync(lock, 'utf8'), other, "the other prepare's lock is untouched");
  assert.deepEqual(fs.readdirSync(d), ['prepare.lock'], 'nothing of either attempt is left behind');
});

test('the lock: a prepare whose draft a holder swept refuses as busy, not as a drive problem', T, () => {
  const { lock } = lockDir();
  const realLink = fs.linkSync;
  /* The holder's sweep removes this prepare's draft just before its link. */
  fs.linkSync = (from) => {
    fs.rmSync(from, { force: true });
    throw Object.assign(new Error('ENOENT: no such file or directory, link'), { code: 'ENOENT' });
  };
  const log = [];
  try {
    assert.throws(() => win32update.takeLock(lock, (l) => log.push(l)), (e) => e.message === 'another update is already being prepared');
  } finally {
    fs.linkSync = realLink;
  }
  assert.equal(log.some((l) => /link failed/.test(l)), false, 'not reported as a drive that cannot link');
});

const codeError = (code, file) => Object.assign(new Error(`${code}, Permission denied: \\\\?\\${file} '\\\\?\\${file}'`), { code });
/** Run `fn` with fs[name] replaced by `stub(real, ...args)`, and put it back whatever happens. */
function withStub(name, stub, fn) {
  const real = fs[name];
  fs[name] = function stubbed(...args) { return stub.call(this, real.bind(fs), ...args); };
  try { return fn(); } finally { fs[name] = real; }
}
async function withStubAsync(name, stub, fn) {
  const real = fs[name];
  fs[name] = function stubbed(...args) { return stub.call(this, real.bind(fs), ...args); };
  try { return await fn(); } finally { fs[name] = real; }
}

test('the lock: a swept draft is busy whatever code the link fails with, EPERM included', T, () => {
  /* Windows answers a link whose source is being deleted with EPERM about as often as ENOENT. */
  for (const code of ['ENOENT', 'EPERM']) {
    const { lock } = lockDir();
    const log = [];
    let links = 0;
    withStub('linkSync', (real, from) => { links += 1; fs.rmSync(from, { force: true }); throw codeError(code, from); }, () => {
      assert.throws(() => win32update.takeLock(lock, (l) => log.push(l)), (e) => e.message === 'another update is already being prepared', code);
    });
    assert.equal(log.some((l) => /link failed/.test(l)), false, `${code}: not reported as a drive that cannot link`);
    assert.equal(links, 1, `${code}: a draft already gone is busy at once, without probing the drive`);
  }
  /* The draft is swept while the drive is being probed: still busy, not a drive problem. */
  const { lock } = lockDir();
  let calls = 0;
  withStub('linkSync', (real, from) => {
    calls += 1;
    if (calls === 2) fs.rmSync(from, { force: true });
    throw codeError('EPERM', from);
  }, () => {
    assert.throws(() => win32update.takeLock(lock, () => {}), (e) => e.message === 'another update is already being prepared');
  });
  assert.equal(calls, 2, 'the control: the probe ran');
});

test('the lock: a link that fails on a drive that can link looks again instead of blaming the drive', T, () => {
  const { d, lock } = lockDir();
  const log = [];
  let calls = 0;
  /* The first link over the lock's name fails (a lock whose delete is pending cannot be linked over). */
  const text = withStub('linkSync', (real, from, to) => {
    calls += 1;
    if (calls === 1) throw codeError('EPERM', to);
    return real(from, to);
  }, () => win32update.takeLock(lock, (l) => log.push(l)));
  assert.equal(fs.readFileSync(lock, 'utf8'), text, 'taken on the next look');
  assert.ok(log.some((l) => /link failed with code=EPERM on a drive that can link; looking again/.test(l)), log.join('\n'));
  assert.equal(log.some((l) => /could not take the prepare lock/.test(l)), false);
  assert.deepEqual(fs.readdirSync(d), ['prepare.lock'], 'the probe and the draft are gone');
});

test('the lock: a draft that cannot be removed never turns a refusal into a raw error', T, () => {
  const { d, lock } = lockDir();
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }));
  const log = [];
  withStub('rmSync', (real, p, o) => {
    if (String(p).endsWith('.draft')) throw codeError('EPERM', p);
    return real(p, o);
  }, () => {
    assert.throws(() => win32update.takeLock(lock, (l) => log.push(l)), (e) => e.message === `another update is already being prepared (process ${process.pid})`);
  });
  assert.ok(log.some((l) => /^could not remove its lock draft \(code=EPERM\)/.test(l)), log.join('\n'));
  assert.equal(log.some((l) => l.includes(d) || l.includes('.draft')), false, 'the log names the code, not the path');
});

test('the lock: a draft that cannot be removed after the lock was taken leaves it taken, held and released', T, async () => {
  const { lock } = lockDir();
  let tripped = false;
  const text = withStub('rmSync', (real, p, o) => {
    if (!tripped && String(p).endsWith('.draft')) { tripped = true; throw codeError('EPERM', p); }
    return real(p, o);
  }, () => win32update.takeLock(lock, () => {}));
  assert.ok(tripped, 'the control: the removal failed');
  assert.equal(fs.readFileSync(lock, 'utf8'), text, 'the lock is this caller\'s');

  /* The whole prepare: it stages, and it lets go of the lock, so the board is not wedged. */
  const c = freshCase();
  let trippedInPrepare = false;
  const r = await withStubAsync('rmSync', (real, p, o) => {
    if (!trippedInPrepare && String(p).endsWith('.draft')) { trippedInPrepare = true; throw codeError('EPERM', p); }
    return real(p, o);
  }, () => win32update.prepare(prepareOpts(c, site(bundleZip()))));
  assert.ok(trippedInPrepare, 'the control: the removal failed');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(workHolds(c), ['prepare-status.json', 'staged'], 'the lock was released and the draft swept');
  assert.ok(c.log.some((l) => /^could not remove its lock draft \(code=EPERM\)/.test(l)), c.log.join('\n'));
  assert.equal((await win32update.prepare(prepareOpts(freshCase(), site(bundleZip())))).ok, true, 'and the next prepare runs');
});

test('the lock: a clear claim that cannot be removed leaves the lock taken', T, () => {
  const { lock } = lockDir();
  fs.writeFileSync(lock, JSON.stringify({ pid: deadPid(), at: Date.now() }));
  let tripped = false;
  const log = [];
  const text = withStub('rmSync', (real, p, o) => {
    if (!tripped && String(p).endsWith('.clearing')) { tripped = true; throw codeError('EPERM', p); }
    return real(p, o);
  }, () => win32update.takeLock(lock, (l) => log.push(l)));
  assert.ok(tripped, 'the control: the removal failed');
  assert.equal(fs.readFileSync(lock, 'utf8'), text);
  assert.ok(log.some((l) => /^could not remove its clear claim \(code=EPERM\)/.test(l)), log.join('\n'));
});

test('the lock: the holder\'s sweep leaves an entry something else is removing, and the prepare goes on', T, async () => {
  const c = freshCase();
  fs.mkdirSync(c.work);
  const busy = 'prepare.lock.123-1700000000000-abcd1234.draft';
  const gone = 'prepare.lock.0123456789abcdef.clearing';
  for (const name of [busy, gone]) fs.writeFileSync(path.join(c.work, name), JSON.stringify({ pid: deadPid(), at: Date.now() }));
  const r = await withStubAsync('rmSync', (real, p, o) => {
    if (path.basename(String(p)) === busy) throw codeError('EPERM', p);
    return real(p, o);
  }, () => win32update.prepare(prepareOpts(c, site(bundleZip()))));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(workHolds(c), [busy, 'prepare-status.json', 'staged'].sort(), 'the busy entry is left for later, the other swept');
  assert.ok(c.log.includes(`left a leftover beside the prepare lock for later (code=EPERM entry=${busy})`), c.log.join('\n'));
  assert.equal(c.log.filter((l) => l.startsWith('left a leftover')).some((l) => l.includes(c.work)), false, 'the sweep names the entry, never its full path');
});

test('the holder\'s sweep is best-effort for every error: EIO and a stray folder are logged, left, and the prepare goes on', T, async () => {
  const c = freshCase();
  fs.mkdirSync(c.work);
  const failing = 'prepare.lock.789-1700000000000-0badc0de.draft';
  const folder = 'prepare.lock.not-a-file';
  fs.writeFileSync(path.join(c.work, failing), '');
  fs.mkdirSync(path.join(c.work, folder));
  fs.writeFileSync(path.join(c.work, folder, 'inside.txt'), 'kept');
  const r = await withStubAsync('rmSync', (real, p, o) => {
    if (path.basename(String(p)) === failing) throw codeError('EIO', p);
    return real(p, o);
  }, () => win32update.prepare(prepareOpts(c, site(bundleZip()))));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(workHolds(c), [folder, failing, 'prepare-status.json', 'staged'].sort(), 'both entries are left as they were');
  assert.ok(fs.existsSync(path.join(c.work, folder, 'inside.txt')), 'the folder is never removed with its contents');
  assert.ok(c.log.includes(`left a leftover beside the prepare lock for later (code=EIO entry=${failing})`), c.log.join('\n'));
  assert.ok(c.log.some((l) => l.startsWith('left a leftover beside the prepare lock for later (code=') && l.endsWith(` entry=${folder})`)), c.log.join('\n'));
  const sweepLines = c.log.filter((l) => l.startsWith('left a leftover'));
  assert.equal(sweepLines.length, 2, sweepLines.join('\n'));
  assert.equal(sweepLines.some((l) => l.includes(c.work)), false, 'the sweep names entries, never full paths');
});

const OWN_IMAGE = path.basename(process.execPath).toLowerCase();
const heldByThisProcess = new RegExp(`^another update is already being prepared \\(process ${process.pid}\\)$`);

test('the lock: a live pid that now belongs to another program is dead, and is cleared through the claim', T, () => {
  /* process.pid is running: the stand-in for a service that Windows handed a dead prepare's pid. */
  const { d, lock } = lockDir();
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now(), exe: 'node.exe' }));
  const asked = [];
  const log = [];
  let claimHeldAtRemoval = false;
  const text = win32update.takeLock(lock, (l) => log.push(l), {
    processImage: (pid) => { asked.push(pid); return 'svchost.exe'; },
    beforeRemove: () => { claimHeldAtRemoval = fs.readdirSync(d).some((n) => n.endsWith('.clearing')); },
  });
  assert.equal(fs.readFileSync(lock, 'utf8'), text);
  assert.equal(asked[0], process.pid, 'the live pid was looked up');
  assert.ok(claimHeldAtRemoval, 'removed only under its claim');
  assert.ok(log.includes(`cleared a stale prepare lock (process ${process.pid}, its process id now belongs to another program (svchost.exe))`), log.join('\n'));
  assert.deepEqual(fs.readdirSync(d), ['prepare.lock']);
});

test('the lock: a live pid of the same program, a lookup that fails or cannot be read, or a lock with no exe, all hold', T, () => {
  const cases = [
    { name: 'the same program, in other letters', exe: 'node.exe', lookup: () => 'NODE.EXE' },
    { name: 'a lookup that times out', exe: 'node.exe', lookup: () => { throw Object.assign(new Error('spawnSync tasklist.exe ETIMEDOUT'), { code: 'ETIMEDOUT' }); }, logs: `could not check which program process ${process.pid} is (code=ETIMEDOUT); holding its lock` },
    { name: 'an answer that cannot be read', exe: 'node.exe', lookup: () => null, logs: `could not check which program process ${process.pid} is (code=unparsed); holding its lock` },
    { name: 'a lock with no exe', lookup: () => { throw new Error('a lock with no exe must not be looked up'); } },
  ];
  for (const k of cases) {
    const { lock } = lockDir();
    const seeded = JSON.stringify({ pid: process.pid, at: Date.now(), ...(k.exe ? { exe: k.exe } : {}) });
    fs.writeFileSync(lock, seeded);
    const log = [];
    assert.throws(() => win32update.takeLock(lock, (l) => log.push(l), { processImage: k.lookup }), (e) => heldByThisProcess.test(e.message), k.name);
    assert.equal(fs.readFileSync(lock, 'utf8'), seeded, `${k.name}: untouched`);
    if (k.logs) assert.ok(log.includes(k.logs), `${k.name}\n${log.join('\n')}`);
  }
});

test('the lock: a wall clock stepped forward never takes a live owner\'s lock', T, () => {
  /* Round 4 SAFETY 1: the owner took the lock a minute after the computer started (a logon
     auto-install), then time sync stepped the clock forward. Its process is still running. */
  const { lock } = lockDir();
  const sameProgram = () => OWN_IMAGE;
  /* The uptime is pinned where the round-3 rule read it (os.uptime), so uptime arithmetic brought
     back makes this red whatever this machine's real uptime is. */
  const realUptime = os.uptime;
  try {
    os.uptime = () => 60;
    const mine = win32update.takeLock(lock, () => {}, { clock: { now: () => Date.now() }, processImage: sameProgram });
    os.uptime = () => 61;
    for (const stepMs of [3 * 60 * 1000, 2 * 60 * 60 * 1000]) {
      const stepped = { now: () => Date.now() + stepMs };
      assert.throws(() => win32update.takeLock(lock, () => {}, { clock: stepped, processImage: sameProgram }), (e) => heldByThisProcess.test(e.message), `a step of ${stepMs} ms`);
      assert.equal(fs.readFileSync(lock, 'utf8'), mine, 'the live owner keeps it');
    }
  } finally {
    os.uptime = realUptime;
  }
});

test('the lock names the program that took it, and tasklist\'s answer is read for exactly that pid', T, () => {
  const body = JSON.parse(win32update.takeLock(lockDir().lock, () => {}));
  const stamp = win32update.processImageStamp(process.execPath, fs.realpathSync.native);
  assert.equal(body.exe, stamp === null ? undefined : stamp, 'the stamp processImageStamp gives this process, or none');
  assert.equal(body.pid, process.pid);
  assert.equal('boot' in body, false, 'no wall-clock stamp decides anything');
  const read = win32update.processImageFromTasklist;
  assert.equal(read('"node.exe","1234","Console","1","45,000 K"\r\n', 1234), 'node.exe');
  assert.equal(read('"svchost.exe","12340","Services","0","9,000 K"\r\n', 1234), null, 'another pid');
  assert.equal(read('INFO: No tasks are running which match the specified criteria.\r\n', 1234), null);
  assert.equal(read('', 1234), null);
});

test('the lock: on Windows the real lookup tells a different program apart; elsewhere the plain pid rule holds', T, () => {
  const { lock } = lockDir();
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now(), exe: 'not-this-program.exe' }));
  const log = [];
  if (ON_WINDOWS) {
    win32update.takeLock(lock, (l) => log.push(l));
    assert.ok(log.includes(`cleared a stale prepare lock (process ${process.pid}, its process id now belongs to another program (${OWN_IMAGE}))`), log.join('\n'));
  } else {
    assert.throws(() => win32update.takeLock(lock, (l) => log.push(l)), (e) => heldByThisProcess.test(e.message));
  }
});

test('the lock records a program name only when tasklist will name the process the same way', T, () => {
  const stamp = win32update.processImageStamp;
  const dir = path.join(SANDBOX, 'images');
  const at = (name) => path.join(dir, name);
  const itself = (p) => p;
  assert.equal(stamp(at('node.exe'), itself), 'node.exe');
  assert.equal(stamp(at('NODE.EXE'), () => at('node.exe')), 'node.exe', 'case is not a difference');
  assert.equal(stamp(at('node with space.exe'), itself), 'node with space.exe');
  assert.equal(stamp(at('symlinked-name.exe'), () => at('node.exe')), null, 'launched through a symlink');
  assert.equal(stamp(at('LONGER~1.EXE'), () => at('longer-node-runtime-name.exe')), null, 'an 8.3 short name');
  assert.equal(stamp(at('nodeé-тест.exe'), itself), null, 'non-ASCII, which tasklist garbles');
  assert.equal(stamp(at('node?.exe'), itself), null);
  assert.equal(stamp(at('node.exe'), () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); }), null, 'a real path that cannot be read');
});

test('the lock: a tasklist answer that lost letters to its encoding holds', T, () => {
  for (const garbled of ['node�-????.exe', 'node?.exe', 'nodeé.exe']) {
    const { lock } = lockDir();
    const seeded = JSON.stringify({ pid: process.pid, at: Date.now(), exe: 'node.exe' });
    fs.writeFileSync(lock, seeded);
    const log = [];
    assert.throws(() => win32update.takeLock(lock, (l) => log.push(l), { processImage: () => garbled }), (e) => heldByThisProcess.test(e.message), garbled);
    assert.equal(fs.readFileSync(lock, 'utf8'), seeded);
    assert.ok(log.includes(`could not check which program process ${process.pid} is (code=unparsed); holding its lock`), `${garbled}\n${log.join('\n')}`);
  }
});

test('the lock: an owner launched through a file symlink keeps its lock against a real challenger', { ...T, timeout: 30000 }, async (t) => {
  if (!ON_WINDOWS) { t.skip('the tasklist lookup runs on Windows only'); return; }
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'symlinked-'));
  const link = path.join(dir, 'symlinked-name.exe');
  try { fs.symlinkSync(process.execPath, link, 'file'); } catch (e) {
    t.skip(`this computer cannot make a file symlink without admin (code=${e && e.code})`);
    return;
  }
  const lock = path.join(dir, 'prepare.lock');
  const script = [
    `const w = require(${JSON.stringify(path.join(__dirname, 'win32update.js'))});`,
    `try { process.stdout.write('HELD ' + w.takeLock(${JSON.stringify(lock)}, () => {}) + '\\n'); } catch (e) { process.stdout.write('REFUSED ' + e.message + '\\n'); }`,
    'setTimeout(() => {}, 15000);',
  ].join('\n');
  const owner = cp.spawn(link, ['-e', script], { env: process.env, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  try {
    const line = await new Promise((resolve, reject) => {
      let out = '';
      owner.stdout.on('data', (b) => { out += b; if (out.includes('\n')) resolve(out.trim()); });
      owner.on('exit', () => reject(new Error('the owner exited: ' + out)));
    });
    assert.match(line, /^HELD /, line);
    const body = JSON.parse(line.slice('HELD '.length));
    assert.equal(body.pid, owner.pid);
    assert.equal('exe' in body, false, 'a symlink-launched owner records no program name');
    const log = [];
    assert.throws(() => win32update.takeLock(lock, (l) => log.push(l)), (e) => e.message === `another update is already being prepared (process ${owner.pid})`, log.join('\n'));
    assert.equal(fs.readFileSync(lock, 'utf8'), line.slice('HELD '.length), 'still the owner\'s');
  } finally {
    /* Waited for, so the sandbox's removal cannot race the owner's image handle. */
    const exited = owner.exitCode !== null || owner.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => owner.once('exit', resolve));
    owner.kill();
    await exited;
  }
});

test('the lock: a stale lock a scanner still holds refuses in words, and a later prepare recovers it', T, async () => {
  const c = freshCase();
  const isLock = (p) => path.basename(String(p)) === 'prepare.lock';
  const r1 = await withStubAsync('rmSync', (real, p, o) => {
    if (isLock(p)) throw codeError('EPERM', p);
    return real(p, o);
  }, () => win32update.prepare(prepareOpts(c, site(bundleZip()))));
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.ok(fs.existsSync(path.join(c.work, 'prepare.lock')), 'the control: the release left the lock behind');

  c.log.length = 0;
  const r2 = await withStubAsync('unlinkSync', (real, p) => {
    if (isLock(p)) throw codeError('EPERM', p);
    return real(p);
  }, () => win32update.prepare(prepareOpts(c, site(bundleZip()))));
  assert.equal(r2.ok, false);
  assert.equal(r2.because, 'another update is already being prepared (an old lock could not be removed yet)');
  assert.ok(c.log.includes('could not remove a stale prepare lock yet (code=EPERM)'), c.log.join('\n'));
  assert.equal(c.log.filter((l) => /prepare lock/.test(l)).some((l) => l.includes(c.work)), false, 'logged by code, not path');

  c.log.length = 0;
  const r3 = await win32update.prepare(prepareOpts(c, site(bundleZip())));
  assert.equal(r3.ok, true, JSON.stringify(r3));
  assert.ok(c.log.some((l) => /^cleared a stale prepare lock \(process \d+, left behind by an earlier prepare in this board that could not remove it\)$/.test(l)), c.log.join('\n'));
});

test('the lock: a verified stale lock that vanishes before its claim removes it is cleared, and the prepare stages', T, async () => {
  const c = freshCase();
  seedLock(c, { pid: deadPid(), at: Date.now() });
  let vanished = 0;
  const r = await withStubAsync('unlinkSync', (real, p) => {
    if (path.basename(String(p)) === 'prepare.lock' && vanished === 0) {
      vanished += 1;
      real(p); /* something else removed it first */
      throw codeError('ENOENT', p);
    }
    return real(p);
  }, () => win32update.prepare(prepareOpts(c, site(bundleZip()))));
  assert.equal(vanished, 1, 'the control: the unlink found it gone');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(c.log.includes('the stale prepare lock was already gone when its claim came to remove it (code=ENOENT)'), c.log.join('\n'));
  assert.ok(c.log.some((l) => /^cleared a stale prepare lock \(process \d+, no longer running\)$/.test(l)), c.log.join('\n'));
  assert.equal(c.log.some((l) => /could not be removed yet|could not remove a stale prepare lock yet/.test(l)), false);
  assert.deepEqual(workHolds(c), ['prepare-status.json', 'staged']);
});

test('the lock: a stale lock that vanishes and is replaced by another prepare\'s before the link leaves that lock its owner\'s', T, () => {
  const { d, lock } = lockDir();
  fs.writeFileSync(lock, JSON.stringify({ pid: deadPid(), at: Date.now() }));
  const others = JSON.stringify({ pid: process.pid, at: Date.now(), token: 'another-prepare' });
  let replaced = false;
  withStub('unlinkSync', (real, p) => {
    if (!replaced && path.resolve(String(p)) === path.resolve(lock)) {
      replaced = true;
      real(p);
      fs.writeFileSync(lock, others); /* another prepare took the free name */
      throw codeError('ENOENT', p);
    }
    return real(p);
  }, () => {
    assert.throws(() => win32update.takeLock(lock, () => {}), (e) => heldByThisProcess.test(e.message));
  });
  assert.ok(replaced, 'the control: the race ran');
  assert.equal(fs.readFileSync(lock, 'utf8'), others, "the other prepare's lock is untouched");
  assert.deepEqual(fs.readdirSync(d), ['prepare.lock'], 'no draft or claim left');
});

test('the lock: a lock the release could not remove is released on a retry, or cleared by the next prepare in this board', T, async () => {
  const isLock = (p) => path.basename(String(p)) === 'prepare.lock';
  /* Held by a scanner for a moment: the second try removes it. */
  const once = freshCase();
  let failures = 0;
  const r1 = await withStubAsync('rmSync', (real, p, o) => {
    if (isLock(p) && failures < 1) { failures += 1; throw codeError('EPERM', p); }
    return real(p, o);
  }, () => win32update.prepare(prepareOpts(once, site(bundleZip()))));
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(failures, 1, 'the control: the first removal failed');
  assert.deepEqual(workHolds(once), ['prepare-status.json', 'staged'], 'released on the retry');
  assert.ok(once.log.includes('could not remove the prepare lock (code=EPERM, try 1 of 3)'), once.log.join('\n'));

  /* Held for longer: the lock is left naming this live board, and the next prepare here stages. */
  const c = freshCase();
  const r2 = await withStubAsync('rmSync', (real, p, o) => {
    if (isLock(p)) throw codeError('EPERM', p);
    return real(p, o);
  }, () => win32update.prepare(prepareOpts(c, site(bundleZip()))));
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(JSON.parse(fs.readFileSync(path.join(c.work, 'prepare.lock'), 'utf8')).pid, process.pid, 'the control: the lock was left behind');
  assert.ok(c.log.includes('left the prepare lock behind; the next prepare in this board clears it'), c.log.join('\n'));
  assert.equal(c.log.filter((l) => /prepare lock/.test(l)).some((l) => l.includes(c.work)), false, 'failures are logged by code, not path');
  c.log.length = 0;
  const r3 = await win32update.prepare(prepareOpts(c, site(bundleZip())));
  assert.equal(r3.ok, true, JSON.stringify(r3));
  assert.ok(c.log.some((l) => /^cleared a stale prepare lock \(process \d+, left behind by an earlier prepare in this board that could not remove it\)$/.test(l)), c.log.join('\n'));
  assert.deepEqual(workHolds(c), ['prepare-status.json', 'staged']);
});

test('the lock: a release that cannot read the lock logs the code, and the next prepare in this board still stages', T, async () => {
  const c = freshCase();
  const lockInWork = path.resolve(path.join(c.work, 'prepare.lock'));
  const r1 = await withStubAsync('readFileSync', (real, p, o) => {
    if (path.resolve(String(p)) === lockInWork) throw codeError('EPERM', p);
    return real(p, o);
  }, () => win32update.prepare(prepareOpts(c, site(bundleZip()))));
  assert.equal(r1.ok, true, JSON.stringify(r1));
  for (const n of [1, 2, 3]) assert.ok(c.log.includes(`could not read the prepare lock to release it (code=EPERM, try ${n} of 3)`), c.log.join('\n'));
  assert.equal(c.log.filter((l) => /prepare lock/.test(l)).some((l) => l.includes(c.work)), false, 'logged by code, not path');
  assert.equal((await win32update.prepare(prepareOpts(c, site(bundleZip())))).ok, true, 'not wedged');
});

test('the lock: a name that stays busy on a drive that can link gives up within its bounds and leaves no probe', T, () => {
  const count = (target, busy) => {
    const tally = { links: 0, probes: 0 };
    const stub = (real, from, to) => {
      tally.links += 1;
      if (String(to).endsWith('.probe')) { tally.probes += 1; return real(from, to); }
      if (busy(String(to))) throw codeError('EPERM', to);
      return real(from, to);
    };
    return { tally, stub, target };
  };
  /* The lock's own name: MAX_LOCK_ATTEMPTS (3) looks, one probe each. */
  const a = lockDir();
  const onLock = count(a.lock, (to) => path.resolve(to) === path.resolve(a.lock));
  withStub('linkSync', onLock.stub, () => {
    assert.throws(() => win32update.takeLock(a.lock, () => {}), (e) => e.message === 'another update is already being prepared');
  });
  assert.deepEqual(onLock.tally, { links: 6, probes: 3 });
  assert.deepEqual(fs.readdirSync(a.d), [], 'no draft and no probe left');

  /* A clear claim's name: MAX_CLEAR_CLAIM_STEPS (8) steps, one probe each. */
  const b = lockDir();
  fs.writeFileSync(b.lock, JSON.stringify({ pid: deadPid(), at: Date.now() }));
  const onClaim = count(b.lock, (to) => to.endsWith('.clearing'));
  withStub('linkSync', onClaim.stub, () => {
    assert.throws(() => win32update.takeLock(b.lock, () => {}), (e) => e.message === 'another update is already being prepared (an old lock could not be cleared)');
  });
  assert.deepEqual(onClaim.tally, { links: 17, probes: 8 }, 'one link at the lock, then 8 claim links and 8 probes');
  assert.deepEqual(fs.readdirSync(b.d), ['prepare.lock'], 'the stale lock stays, and no probe is left');
});

test('the lock: a lock removed between the look and the read is gone, not unreadable', T, () => {
  const { lock } = lockDir();
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }));
  let tripped = false;
  const text = withStub('readFileSync', (real, p, o) => {
    if (!tripped && path.resolve(String(p)) === path.resolve(lock)) {
      tripped = true;
      fs.rmSync(lock);
      throw codeError('ENOENT', p);
    }
    return real(p, o);
  }, () => win32update.takeLock(lock, () => {}));
  assert.ok(tripped, 'the control: the read raced the removal');
  assert.equal(fs.readFileSync(lock, 'utf8'), text, 'taken on the next look');
});

test('the lock: an owner that cannot be checked is aged from the earlier of its at and its file, so a future at cannot hold forever', T, () => {
  const win32orphan = require('./win32orphan');
  const realState = win32orphan.pidState;
  win32orphan.pidState = () => 'unknown';
  try {
    const { lock } = lockDir();
    fs.writeFileSync(lock, JSON.stringify({ pid: 4242, at: Date.now() + 100 * 365 * 24 * 3600 * 1000 }));
    assert.throws(() => win32update.takeLock(lock, () => {}), /already being prepared \(process 4242\)/, 'a new file: held');
    const threeHoursAgo = new Date(hoursAgo(3));
    fs.utimesSync(lock, threeHoursAgo, threeHoursAgo);
    const log = [];
    const text = win32update.takeLock(lock, (l) => log.push(l));
    assert.equal(fs.readFileSync(lock, 'utf8'), text);
    assert.ok(log.some((l) => /cleared a stale prepare lock \(process 4242, old, and its owner cannot be checked\)/.test(l)), log.join('\n'));
  } finally {
    win32orphan.pidState = realState;
  }
});

test('the lock: a lock file that is a folder, or stays unreadable, is named as the problem and left alone', T, () => {
  const folder = lockDir();
  fs.mkdirSync(folder.lock);
  const log = [];
  assert.throws(() => win32update.takeLock(folder.lock, (l) => log.push(l)), (e) => e.message === `Kosmos could not take its update lock: the lock file ${folder.lock} is a folder, not a file, so the updater cannot tell whether another update is running. Remove that file by hand, then try again`);
  assert.ok(fs.statSync(folder.lock).isDirectory(), 'never removed automatically');
  assert.deepEqual(fs.readdirSync(folder.d), ['prepare.lock']);

  const denied = lockDir();
  fs.writeFileSync(denied.lock, JSON.stringify({ pid: deadPid(), at: hoursAgo(3) }));
  const deniedLog = [];
  withStub('readFileSync', (real, p, o) => {
    if (path.resolve(String(p)) === path.resolve(denied.lock)) throw codeError('EPERM', p);
    return real(p, o);
  }, () => {
    assert.throws(() => win32update.takeLock(denied.lock, (l) => deniedLog.push(l)), /the lock file .*prepare\.lock cannot be read, so the updater cannot tell whether another update is running\. Remove that file by hand/);
  });
  assert.ok(deniedLog.includes('the prepare lock cannot be read (code=EPERM)'), deniedLog.join('\n'));
  assert.ok(fs.existsSync(denied.lock), 'never removed automatically');

  /* Unreadable for a moment (a lock whose delete is pending): read again, and judged as usual. */
  const blip = lockDir();
  fs.writeFileSync(blip.lock, JSON.stringify({ pid: process.pid, at: Date.now() }));
  let reads = 0;
  withStub('readFileSync', (real, p, o) => {
    if (path.resolve(String(p)) === path.resolve(blip.lock) && (reads += 1) === 1) throw codeError('EPERM', p);
    return real(p, o);
  }, () => {
    assert.throws(() => win32update.takeLock(blip.lock, () => {}), new RegExp(`already being prepared \\(process ${process.pid}\\)`));
  });
  assert.equal(reads, 2, 'the control: read again after the first failure');
});

test('the lock: prepares racing to clear one stale lock, in separate processes, leave exactly one holder', { timeout: 30000 }, async () => {
  const { d, lock } = lockDir();
  fs.writeFileSync(lock, JSON.stringify({ pid: deadPid(), at: Date.now() }));
  const script = [
    `const w = require(${JSON.stringify(path.join(__dirname, 'win32update.js'))});`,
    `try { w.takeLock(${JSON.stringify(lock)}, () => {}); process.stdout.write('won'); setTimeout(() => {}, 3000); }`,
    "catch (e) { process.stdout.write('refused: ' + e.message); }",
  ].join('\n');
  const racers = Array.from({ length: 4 }, () => new Promise((resolve) => {
    const child = cp.spawn(process.execPath, ['-e', script], { env: process.env });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.on('exit', () => resolve(out));
  }));
  const outcomes = await Promise.all(racers);
  assert.equal(outcomes.filter((o) => o === 'won').length, 1, outcomes.join('\n'));
  assert.ok(outcomes.filter((o) => o !== 'won').every((o) => /^refused: another update is already being prepared/.test(o)), outcomes.join('\n'));
  assert.deepEqual(fs.readdirSync(d), ['prepare.lock']);
});

/* ─── live execution (convention 3) ───────────────────────────────────────────────────────── */

test('live execution: in a test process with no seam, prepare throws before touching anything', T, async () => {
  const c = freshCase();
  const s = site(bundleZip());
  const o = prepareOpts(c, s);
  delete o.liveExecutionAllowed;
  await assert.rejects(win32update.prepare(o), /engine\/win32update\.js tried to execute "prepare --root .*" for real inside a test process/);
  assert.deepEqual(s.urls, []);
  assert.equal(fs.existsSync(c.work), false);
});

test('live execution: in a production process that never armed it, prepare warns and refuses', T, () => {
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

const CLI = path.join(__dirname, 'win32update.js');

test('the CLI is a dry run without --yes, and requiring the module does nothing', T, () => {
  const c = freshCase();
  const dry = cp.spawnSync(process.execPath, [CLI, '--prepare', '--root', c.root, '--base', BASE], { encoding: 'utf8' });
  assert.equal(dry.status, 2, dry.stderr);
  const said = JSON.parse(dry.stdout);
  assert.equal(said.dryRun, true);
  assert.equal(said.writesUnder, c.work);
  assert.equal(said.world, 'default');
  assert.equal(fs.existsSync(c.work), false);
  const usage = cp.spawnSync(process.execPath, [CLI, '--prepare'], { encoding: 'utf8' });
  assert.equal(usage.status, 64);
  assert.match(usage.stdout, /^usage: node engine\/win32update\.js --prepare --root <folder>/);
});

/* ─── pins ────────────────────────────────────────────────────────────────────────────────── */

const BUILD_SCRIPT = fs.readFileSync(path.join(REPO, 'tools', 'build-kosmos-windows.sh'), 'utf8');

test('REQUIRED_ENTRIES is the build script\'s own list of what its zip must contain', T, () => {
  const loop = /for want in (.+?); do/.exec(BUILD_SCRIPT);
  assert.ok(loop, 'the build script no longer checks its zip with a `for want in` list');
  const wants = [...loop[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(wants.length >= 10, 'the control: the list was read');
  assert.match(BUILD_SCRIPT, /\*" bin\/kosmos"\$'\\n'\*\)/, 'the separate check for the extensionless bin/kosmos');
  assert.deepEqual([...win32update.REQUIRED_ENTRIES].sort(), [...wants, 'bin/kosmos'].sort());
});

test('ENTRIES is every top-level name the build script stages, so the swap can never miss one', T, () => {
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

test('no name the build stages looks like a Windows short name, so refusing them costs a real build nothing', T, () => {
  const names = [...win32update.REQUIRED_ENTRIES];
  for (const dir of ['engine', 'web', 'bin', path.join('tools', 'windows')]) {
    (function walk(d) {
      for (const e of fs.readdirSync(path.join(REPO, d), { withFileTypes: true })) {
        const rel = path.join(d, e.name);
        names.push(rel);
        if (e.isDirectory()) walk(rel);
      }
    })(dir);
  }
  assert.ok(names.length > 100, 'the control: the staged sources were listed');
  assert.deepEqual(names.filter((n) => /~\d/.test(n)), []);
});

/* ─── a real build ────────────────────────────────────────────────────────────────────────── */

const SAMPLE = process.env.KOSMOS_WIN_ZIP_SAMPLE;
test('a real Kosmos build stages end to end under the real caps, and its real node.exe runs',
  { timeout: 120000, skip: !SAMPLE && 'set KOSMOS_WIN_ZIP_SAMPLE to a real kosmos-win-x64.zip to run this' }, async () => {
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
    if (ON_WINDOWS) delete opts.runStagedNode;
    const r = await win32update.prepare(opts);
    assert.equal(r.ok, true, r.because);
    assert.equal(r.version, version);
    assert.match(r.expectedIdentity, new RegExp(`^${version.replace(/\./g, '\\.')}\\+[0-9a-f]{12}@default$`));
    assert.equal(fs.statSync(path.join(r.stagedDir, 'runtime', 'node.exe')).size,
      entries.find((e) => e.name === 'runtime/node.exe').uncompressedSize);
  });

/* ─── the world in the expected identity (these run last: the second boots a world) ───────── */

test('the world: without one given, the registry\'s active world, in prepare and in the CLI', T, async () => {
  const base = worlds.baseRoot(process.env);
  worlds.createWorld(base, 'Studio');
  const named = worlds.listWorlds(base).find((w) => w.id !== worlds.DEFAULT_ID).id;
  worlds.setActiveWorld(base, named);
  try {
    assert.equal(win32update.resolveWorld(null), named);
    assert.equal(win32update.resolveWorld('explicit'), 'explicit', 'an explicit world wins');
    const c = freshCase();
    const r = await win32update.prepare(prepareOpts(c, site(bundleZip()), { world: undefined }));
    assert.equal(r.expectedIdentity, `${NEXT}+${SOURCE_SHA.slice(0, 12)}@${named}`);
    const dry = cp.spawnSync(process.execPath, [CLI, '--prepare', '--root', c.root], { encoding: 'utf8' });
    assert.equal(JSON.parse(dry.stdout).world, named, 'the CLI takes the registry\'s world, not "default"');
  } finally {
    worlds.setActiveWorld(base, worlds.DEFAULT_ID);
  }
  assert.equal(win32update.resolveWorld(null), worlds.DEFAULT_ID, 'the control: the default world again');
});

test('the world: inside a board, the world that board booted into wins over the registry', T, async () => {
  const base = worlds.baseRoot(process.env);
  const named = worlds.listWorlds(base).find((w) => w.id !== worlds.DEFAULT_ID).id;
  worlds.setActiveWorld(base, named);
  /* Boot the way server.js does, on a copy of the environment so this process keeps its own. */
  require('./worldenv').bootstrapWorldEnv({ ...process.env });
  worlds.setActiveWorld(base, worlds.DEFAULT_ID);
  assert.equal(win32update.resolveWorld(null), named, 'the booted world, although the registry now says default');
  const r = await win32update.prepare(prepareOpts(freshCase(), site(bundleZip()), { world: undefined }));
  assert.equal(r.expectedIdentity, `${NEXT}+${SOURCE_SHA.slice(0, 12)}@${named}`);
});
