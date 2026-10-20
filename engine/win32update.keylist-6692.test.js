'use strict';
/**
 * #6692: the Windows updater takes the release key list (#6609) before it checks a release manifest, when a
 * recovery key is set, and checks the manifest with the LIST's keys. Off (no recovery key, as shipped): nothing more
 * is fetched and the built-in keys decide exactly as before.
 *
 * Throwaway keys throughout, rewritten into a copy of the verifier (engine/manifest-verify.js) that this file loads
 * in place of the real one before loading the updater, as the install.recoverykey-* tests do with an installed copy:
 * RELEASE and DROPPED are both built into the copy's KEYS; the list names only RELEASE.
 *
 *   node --test engine/win32update.keylist-6692.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-w32keylist-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const win32anchor = require('./win32anchor');
const { buildZip } = require('../test-support/zipfixture');
const { SIGNED_KOSMOS } = require('../test-support/signedkosmos');
const { signedRelease } = require('../test-support/winreleasemanifest');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const T = { timeout: 30000 };
const ON_WINDOWS = process.platform === 'win32';
const ARCH = 'x64';
const INSTALLED = '0.6.55';
const NEXT = '0.6.60';
const SOURCE_SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const NODE_VERSION = 'v24.19.0';
const BASE = 'https://updates.example.test/dist';
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const pair = () => { const k = crypto.generateKeyPairSync('ed25519'); return { priv: k.privateKey, pub: k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }; };
const RELEASE = pair();    // built in, and named by the list
const DROPPED = pair();    // built in, and dropped by the list (a revoked key)
const RECOVERY = pair();   // signs the list
const STRANGER = pair();   // signs nothing anyone trusts

/* ─── the verifier copy, and an updater that uses it ──────────────────────────────────────── */

const MV_PATH = require.resolve('./manifest-verify');
const WU_PATH = require.resolve('./win32update');
const VERIFIER = fs.readFileSync(MV_PATH, 'utf8');

/** The verifier with KEYS = [RELEASE, DROPPED], and RECOVERY_KEYS = [RECOVERY] when `on`. */
function verifierSource(on) {
  let v = VERIFIER.replace(/const KEYS = \[[\s\S]*?\];/, `const KEYS = [${JSON.stringify(RELEASE.pub)}, ${JSON.stringify(DROPPED.pub)}];`);
  assert.notEqual(v, VERIFIER, 'the KEYS list moved; this fixture cannot pin its keys');
  if (on) {
    const was = v;
    v = v.replace('const RECOVERY_KEYS = Object.freeze([]);', `const RECOVERY_KEYS = Object.freeze([${JSON.stringify(RECOVERY.pub)}]);`);
    assert.notEqual(v, was, 'the RECOVERY_KEYS line moved; this fixture cannot turn the check on');
  }
  return v;
}
/** A fresh engine/win32update.js bound to a fresh copy of the verifier (`source`), and that copy. */
function loadUpdater(source) {
  const savedMv = require.cache[MV_PATH];
  const savedWu = require.cache[WU_PATH];
  const m = new Module(MV_PATH, module);
  m.filename = MV_PATH;
  m.paths = Module._nodeModulePaths(path.dirname(MV_PATH));
  m._compile(source, MV_PATH);
  m.loaded = true;
  try {
    require.cache[MV_PATH] = m;
    delete require.cache[WU_PATH];
    return { wu: require('./win32update'), mv: m.exports };
  } finally {
    if (savedMv) require.cache[MV_PATH] = savedMv; else delete require.cache[MV_PATH];
    if (savedWu) require.cache[WU_PATH] = savedWu; else delete require.cache[WU_PATH];
  }
}
const ON = loadUpdater(verifierSource(true));
const OFF = loadUpdater(verifierSource(false));
const SHIPPED = loadUpdater(VERIFIER);

/* ─── the sandbox (the shape engine/win32update.test.js uses) ─────────────────────────────── */

let caseCount = 0;
function freshCase() {
  caseCount += 1;
  const dir = path.join(SANDBOX, 'cases', String(caseCount));
  const root = path.join(dir, 'Kosmos');
  const env = { AGENT_WORKFORCE_DATA: path.join(dir, 'machine') };
  const anchor = win32anchor.anchorDir(process.platform, os.homedir(), env);
  fs.mkdirSync(path.join(root, 'runtime'), { recursive: true });
  fs.mkdirSync(path.join(root, 'app', 'engine'), { recursive: true });
  fs.writeFileSync(path.join(root, 'runtime', 'node.exe'), 'the installed node.exe');
  fs.writeFileSync(path.join(root, 'app', 'server.js'), '// the installed server');
  fs.writeFileSync(path.join(root, 'app', 'package.json'), JSON.stringify({ version: INSTALLED }));
  fs.writeFileSync(path.join(root, 'app', 'engine', 'win32apply.js'), '// the installed updater');
  fs.writeFileSync(path.join(root, 'app', 'engine', 'win32update.js'), '// the installed updater entry');
  fs.mkdirSync(anchor, { recursive: true });
  fs.writeFileSync(path.join(anchor, win32anchor.NODE_NAME), 'the anchored node.exe of 0.6.55');
  fs.writeFileSync(path.join(anchor, win32anchor.POINTER_NAME), path.join(root, 'app', 'engine'));
  return { dir, root, env, anchor, record: path.join(anchor, 'release-keys.state'), log: [] };
}
function bundleZip() {
  const files = {
    'Kosmos.exe': 'MZ the launcher',
    'open-board.js': '// the browser opener',
    '! READ ME FIRST - Windows will warn you.txt': 'Windows will warn you',
    'manifest.json': JSON.stringify({
      product: 'kosmos', platform: 'win32', arch: ARCH, version: NEXT, source_sha: SOURCE_SHA, source_dirty: false,
      signed: false, node: { version: NODE_VERSION, download_sha256: '0'.repeat(64) }, agents_supported: true,
    }),
    'runtime/node.exe': `the staged node.exe of ${NEXT}`,
    'runtime/LICENSE': 'MIT',
    'app/server.js': '// the new server\n',
    'app/package.json': JSON.stringify({ name: 'agent-workforce', version: NEXT }),
    'app/web/index.html': '<!doctype html><title>Kosmos</title>\n',
    'app/engine/kosmos-report-hook.js': '// the report hook',
    'bin/kosmos-cli.js': '// the kosmos command',
    'bin/kosmos.ps1': '# the PowerShell shim',
    'bin/kosmos': '#!/bin/sh',
  };
  const entries = [{ name: 'app/' }, { name: 'app/engine/' }, { name: 'bin/' }, { name: 'runtime/' }];
  for (const [name, data] of Object.entries(files)) entries.push({ name, data, method: 8 });
  return buildZip(entries);
}
const ZIP = bundleZip();
const POINTER = { version: NEXT, sha256: sha256(ZIP), artifact: `kosmos-win-${ARCH}.zip`, versioned: `kosmos-${NEXT}-win-${ARCH}.zip`, arch: ARCH };

function keyList(seq, keys, by = RECOVERY) {
  const bytes = Buffer.from(JSON.stringify({ type: 'kosmos-release-keys', release_keys: keys, seq, issued: '2026-10-20' }) + '\n');
  return { bytes, sig: crypto.sign(null, bytes, by.priv).toString('base64') + '\n' };
}

/**
 * The release host. `by` signs the release manifest; `lists` is what each request for the key list gets, in turn (the
 * last one repeats): { bytes, sig } or null (a 404 for both). `sigOnly404` serves the list but 404s its signature.
 */
function site({ by = RELEASE, lists = [keyList(1, [RELEASE.pub])], sigOnly404 = false } = {}) {
  const release = signedRelease(ZIP, { version: NEXT, arch: ARCH, over: { sha256: POINTER.sha256 }, key: by.priv });
  const manifestName = POINTER.versioned.replace(/\.zip$/, '.manifest.json');
  const urls = [];
  let listAsks = 0;
  const fetch = async (url) => {
    urls.push(url);
    const file = decodeURIComponent(new URL(url).pathname.split('/').pop());
    if (file === 'release-keys.json' || file === 'release-keys.json.sig') {
      const l = lists[Math.min(file === 'release-keys.json' ? listAsks++ : listAsks - 1, lists.length - 1)];
      if (!l || (sigOnly404 && file.endsWith('.sig'))) return new Response('not here', { status: 404 });
      return new Response(file.endsWith('.sig') ? l.sig : l.bytes);
    }
    if (file === manifestName) return new Response(release.bytes);
    if (file === manifestName + '.sig') return new Response(release.sig);
    if (file === 'latest-win.json') return new Response(JSON.stringify(POINTER));
    if (file === `${POINTER.versioned}.sha256`) return new Response(`${POINTER.sha256}  ${POINTER.versioned}\n`);
    if (file === POINTER.versioned) return new Response(ZIP, { headers: { 'content-length': String(ZIP.length) } });
    return new Response('not here', { status: 404 });
  };
  return { fetch, urls };
}
const TASK_BOARD = Object.freeze({ startedByTask: () => true, status: () => ({ registered: true, enabled: true, running: true }) });
function opts(c, s, over) {
  return {
    root: c.root, platform: 'win32', arch: ARCH, base: BASE, channel: 'prod', env: c.env, world: 'default',
    fetch: s.fetch,
    freeBytes: () => 64 * 1024 * 1024 * 1024,
    runStagedNode: () => NODE_VERSION + '\n',
    checkSignature: () => SIGNED_KOSMOS,
    /* The record's access list is read for real in its own tests below (Windows only); here it is the person's own. */
    recordAclRefusal: async () => null,
    limits: { keyListRetryMs: 0 },
    liveExecutionAllowed: () => true,
    boardTask: TASK_BOARD,
    log: (line) => c.log.push(line),
    ...(over || {}),
  };
}
const listUrls = (s) => s.urls.filter((u) => /\/release-keys\.json/.test(u));
const recorded = (c) => { try { return fs.readdirSync(c.record).sort(); } catch { return []; } };
const downloaded = (s) => s.urls.some((u) => u.includes(`/${POINTER.versioned}?`));

/* ─── off ─────────────────────────────────────────────────────────────────────────────────── */

test('#6692 off, as shipped: no recovery key, no list fetched, the built-in keys decide, no record started', T, async () => {
  assert.deepEqual(SHIPPED.mv.RECOVERY_KEYS, [], 'CONTROL: the shipped verifier has no recovery key');
  assert.deepEqual(OFF.mv.RECOVERY_KEYS, []);
  /* The rewritten copy, off: a host with NO list at all still stages, and only the usual files are asked for. */
  const c = freshCase();
  const s = site({ lists: [null] });
  const r = await OFF.wu.prepare(opts(c, s));
  assert.equal(r.ok, true, r.because);
  assert.deepEqual(listUrls(s), [], 'off fetches no list');
  assert.deepEqual(s.urls.map((u) => u.replace(/\?.*$/, '').split('/').pop()), [
    'latest-win.json', `kosmos-${NEXT}-win-${ARCH}.manifest.json`, `kosmos-${NEXT}-win-${ARCH}.manifest.json.sig`,
    `${POINTER.versioned}.sha256`, POINTER.versioned,
  ]);
  assert.deepEqual(recorded(c), [], 'off writes no record');
  /* Off, a list that would not verify changes nothing either, and the access list is never read. */
  const c2 = freshCase();
  const s2 = site({ lists: [keyList(1, [RELEASE.pub], STRANGER)] });
  const r2 = await OFF.wu.prepare(opts(c2, s2, { recordAclRefusal: async () => { throw new Error('off must not read the access list'); } }));
  assert.equal(r2.ok, true, r2.because);
  assert.deepEqual(listUrls(s2), []);
});

/* ─── on ──────────────────────────────────────────────────────────────────────────────────── */

test('#6692 on: the list is fetched FIRST (after the pointer), both files with one fresh query, then recorded in the anchor folder', T, async () => {
  const c = freshCase();
  const s = site();
  const r = await ON.wu.prepare(opts(c, s));
  assert.equal(r.ok, true, r.because);
  const names = s.urls.map((u) => u.replace(/\?.*$/, '').split('/').pop());
  assert.deepEqual(names.slice(0, 4), ['latest-win.json', 'release-keys.json', 'release-keys.json.sig', `kosmos-${NEXT}-win-${ARCH}.manifest.json`]);
  const [list, sig] = listUrls(s);
  assert.match(list, /^https:\/\/updates\.example\.test\/dist\/release-keys\.json\?r=[0-9a-f]{16}$/);
  assert.equal(sig, list.replace('release-keys.json?', 'release-keys.json.sig?'), 'the signature with the same query');
  assert.doesNotMatch(list, /\?v=/, 'not the manifest\'s version buster');
  assert.deepEqual(recorded(c), ['seq-1.json'], 'the record is in the anchor folder');
  assert.ok(!fs.existsSync(path.join(c.root, 'release-keys.state')) && !fs.existsSync(path.join(c.root, '.kosmos-update', 'release-keys.state')), 'never in the install folder');
  /* A second update asks again, with a new query. */
  const s2 = site();
  assert.equal((await ON.wu.prepare(opts(c, s2))).ok, true);
  assert.notEqual(listUrls(s2)[0], list, 'a new query each time');
});

test('#6692 THE ATTACK: a release signed by a built-in key the list dropped is refused when on, and installs when off', T, async () => {
  const c = freshCase();
  const s = site({ by: DROPPED, lists: [keyList(2, [RELEASE.pub])] });
  const r = await ON.wu.prepare(opts(c, s));
  assert.equal(r.ok, false, 'on: the dropped key must not open an update');
  assert.match(r.because, /not signed by the Kosmos release key/);
  assert.equal(downloaded(s), false, 'nothing was downloaded');
  /* CONTROL: off, the same release (DROPPED is built into KEYS) installs. */
  const off = await OFF.wu.prepare(opts(freshCase(), site({ by: DROPPED, lists: [keyList(2, [RELEASE.pub])] })));
  assert.equal(off.ok, true, 'CONTROL: off, the built-in key opens it: ' + off.because);
  /* CONTROL: on, the key the list names opens it. */
  assert.equal((await ON.wu.prepare(opts(freshCase(), site({ by: RELEASE, lists: [keyList(2, [RELEASE.pub])] })))).ok, true);
});

test('#6692 on: the manifest keys come from the list even when the test seam names others', T, async () => {
  /* manifestKeys is a seam for the suites; with a recovery key set it must not decide. */
  const r = await ON.wu.prepare(opts(freshCase(), site({ by: DROPPED, lists: [keyList(1, [RELEASE.pub])] }), { manifestKeys: [DROPPED.pub] }));
  assert.equal(r.ok, false);
  assert.match(r.because, /not signed by the Kosmos release key/);
});

test('#6692 on: no list served (either file a 404) refuses, and nothing is downloaded', T, async () => {
  for (const s of [site({ lists: [null] }), site({ sigOnly404: true })]) {
    const c = freshCase();
    const r = await ON.wu.prepare(opts(c, s));
    assert.equal(r.ok, false);
    assert.match(r.because, /publishes no release key list/);
    assert.equal(downloaded(s), false);
    assert.equal(s.urls.some((u) => u.includes('.manifest.json')), false, 'the manifest is not even asked for');
    assert.deepEqual(recorded(c), []);
  }
});

test('#6692 on: a list that does not verify is asked for again, each time with a new query, then refused as maybe mid-publish', T, async () => {
  const good = keyList(3, [RELEASE.pub]);
  const torn = { bytes: good.bytes, sig: keyList(2, [RELEASE.pub]).sig };   // a list from one publish, a signature from another
  const c = freshCase();
  const s = site({ lists: [torn] });
  const r = await ON.wu.prepare(opts(c, s));
  assert.equal(r.ok, false);
  assert.match(r.because, /not signed by the Kosmos recovery key \(it may be mid-publish\), so nothing was downloaded\. Try again/);
  const asked = listUrls(s).filter((u) => !u.includes('.sig?'));
  assert.equal(asked.length, 3, 'three attempts');
  assert.equal(new Set(asked.map((u) => u.split('?r=')[1])).size, 3, 'each with its own query');
  assert.equal(downloaded(s), false);
  /* A torn pair, then the matching one: the second attempt takes it and the update stages. */
  const s2 = site({ lists: [torn, good] });
  const r2 = await ON.wu.prepare(opts(freshCase(), s2));
  assert.equal(r2.ok, true, r2.because);
});

test('#6692 on: an older list than this copy has taken is refused at once (final, not retried)', T, async () => {
  const c = freshCase();
  assert.equal((await ON.wu.prepare(opts(c, site({ lists: [keyList(5, [RELEASE.pub])] })))).ok, true);
  const s = site({ lists: [keyList(4, [RELEASE.pub, DROPPED.pub])] });
  const r = await ON.wu.prepare(opts(c, s));
  assert.equal(r.ok, false);
  assert.match(r.because, /older than the 5 this copy has taken/);
  assert.equal(listUrls(s).filter((u) => !u.includes('.sig?')).length, 1, 'a final refusal is not asked again');
  /* Another set of keys at a seq already taken: final too. */
  const s2 = site({ lists: [keyList(5, [DROPPED.pub])] });
  const r2 = await ON.wu.prepare(opts(c, s2));
  assert.match(r2.because, /names other keys than the list 5/);
  assert.equal(listUrls(s2).filter((u) => !u.includes('.sig?')).length, 1);
});

test('#6692 on: "a newer list was taken meanwhile" is asked again; the newer record then decides', T, async () => {
  const c = freshCase();
  const s = site({ lists: [keyList(1, [RELEASE.pub])] });
  /* Another check records seq 9 while this one is linking its seq-1 in. */
  const realLink = fs.linkSync;
  let planted = false;
  fs.linkSync = function linkThenPlant(a, b) {
    const out = realLink.call(fs, a, b);
    if (!planted && /seq-1\.json$/.test(String(b))) { planted = true; fs.writeFileSync(path.join(c.record, 'seq-9.json'), JSON.stringify({ seq: 9, release_keys: [RELEASE.pub] })); }
    return out;
  };
  let r;
  try { r = await ON.wu.prepare(opts(c, s)); } finally { fs.linkSync = realLink; }
  assert.ok(planted, 'CONTROL: the newer record was planted mid-write');
  assert.equal(listUrls(s).filter((u) => !u.includes('.sig?')).length, 2, 'asked again after "taken meanwhile"');
  assert.equal(r.ok, false);
  assert.match(r.because, /older than the 9 this copy has taken/);
});

test('#6692 on: a record folder another account can reach is refused before any list is fetched, with what to fix', T, async () => {
  const c = freshCase();
  const s = site();
  const seen = [];
  const r = await ON.wu.prepare(opts(c, s, { recordAclRefusal: async (dirs) => { seen.push(dirs); return `the folder ${dirs[0]} can also be reached by Users. Remove those entries`; } }));
  assert.equal(r.ok, false);
  assert.match(r.because, /can also be reached by Users\. Remove those entries, then try again\. Nothing was downloaded/);
  assert.deepEqual(seen, [[path.dirname(c.anchor), c.anchor]], 'the anchor folder is the record home (no record yet: the folder it will inherit from), and the folder above it');
  assert.deepEqual(listUrls(s), []);
  assert.deepEqual(recorded(c), [], 'nothing written to a folder that is refused');
  /* With a record already there, both the anchor folder and the record are read. */
  const c2 = freshCase();
  assert.equal((await ON.wu.prepare(opts(c2, site()))).ok, true);
  const seen2 = [];
  await ON.wu.prepare(opts(c2, site(), { recordAclRefusal: async (dirs) => { seen2.push(dirs); return null; } }));
  assert.deepEqual(seen2, [[path.dirname(c2.anchor), c2.anchor, c2.record, path.join(c2.record, 'seq-1.json')]], 'and each list file in it');
});

test('#6692 on, the REAL access-list check: a profile folder passes, a record folder granted Users read is refused', { ...T, timeout: 120000, skip: !ON_WINDOWS && 'reads a Windows access list' }, async () => {
  const c = freshCase();
  const real = { ...opts(c, site()) };
  delete real.recordAclRefusal;
  const r = await ON.wu.prepare(real);
  assert.equal(r.ok, true, 'the sandbox under the profile temp folder is the person\'s own: ' + r.because);
  assert.deepEqual(recorded(c), ['seq-1.json']);
  cp.execFileSync('icacls', [c.record, '/grant', '*S-1-5-32-545:(OI)(CI)(R)'], { stdio: 'ignore' });
  const again = { ...opts(c, site()) };
  delete again.recordAclRefusal;
  const r2 = await ON.wu.prepare(again);
  assert.equal(r2.ok, false);
  assert.match(r2.because, /release-keys\.state \(part of this copy's record of the release key list\) can also be reached by Users/);
  /* An entry on one list file alone (Users may delete it) is refused too. */
  const c3 = freshCase();
  const first = { ...opts(c3, site()) };
  delete first.recordAclRefusal;
  assert.equal((await ON.wu.prepare(first)).ok, true);
  cp.execFileSync('icacls', [path.join(c3.record, 'seq-1.json'), '/grant', '*S-1-5-32-545:(D)'], { stdio: 'ignore' });
  const third = { ...opts(c3, site()) };
  delete third.recordAclRefusal;
  const r3 = await ON.wu.prepare(third);
  assert.equal(r3.ok, false);
  assert.match(r3.because, /seq-1\.json \(part of this copy's record of the release key list\) can also be reached by Users/);
});

/* ─── the record on a drive without hard links ────────────────────────────────────────────── */

test('#6692: a record that cannot be written because the drive makes no hard links says so', T, () => {
  const home = fs.mkdtempSync(path.join(SANDBOX, 'nolinks-'));
  const l = keyList(1, [RELEASE.pub]);
  const realLink = fs.linkSync;
  fs.linkSync = () => { throw Object.assign(new Error('EPERM: operation not permitted, link'), { code: 'EPERM' }); };
  let t;
  try { t = ON.mv.trustedKeys({ listBytes: l.bytes, listSig: l.sig, home }); } finally { fs.linkSync = realLink; }
  assert.equal(t.ok, false);
  assert.match(t.why, /could not be written: the drive holding .*nolinks-.* may not be able to make hard links \(FAT32 and exFAT drives cannot\)/);
  /* CONTROL: a link that fails while the drive CAN link (the probe succeeds) is not blamed on the drive. */
  let first = true;
  fs.linkSync = function failOnce(a, b) { if (first) { first = false; throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); } return realLink.call(fs, a, b); };
  let t2;
  try { t2 = ON.mv.trustedKeys({ listBytes: l.bytes, listSig: l.sig, home: fs.mkdtempSync(path.join(SANDBOX, 'links-')) }); } finally { fs.linkSync = realLink; }
  assert.equal(t2.ok, false);
  assert.match(t2.why, /could not be written$/);
  /* CONTROL: a probe refused because a scanner holds the file (EBUSY) is not blamed on the drive either. */
  fs.linkSync = () => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); };
  let t3;
  try { t3 = ON.mv.trustedKeys({ listBytes: l.bytes, listSig: l.sig, home: fs.mkdtempSync(path.join(SANDBOX, 'busy-')) }); } finally { fs.linkSync = realLink; }
  assert.equal(t3.ok, false);
  assert.match(t3.why, /could not be written$/);
});
