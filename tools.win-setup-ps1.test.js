'use strict';

/**
 * tools/windows/setup.ps1, the Windows one-line install (`irm https://installkosmos.com/setup.ps1 | iex`),
 * run the way a person runs it: fetched with `irm` from a server and piped to `iex` in a fresh
 * `powershell -NoProfile`, against a fake download host on 127.0.0.1.
 *
 *   node --test tools.win-setup-ps1.test.js
 *
 * The fake host answers /dist/<name> with a 307 to /r2/<name>, as installkosmos.com answers with a
 * redirect to R2, and serves the .sha256 sidecar as application/octet-stream, the content type that
 * makes Invoke-WebRequest hand back bytes instead of text. The zip holds the committed, signed
 * tools/windows/Kosmos.exe (the file every published zip carries), so the signature check runs for
 * real. KOSMOS_SETUP_TEST_NO_LAUNCH=1 stops the script before it runs Kosmos.exe: a launch would
 * install Kosmos on the machine running the tests. TEMP, TMP and LOCALAPPDATA point into a scratch
 * folder, so "nothing left behind" is a directory listing.
 *
 * Windows only (powershell.exe, Authenticode). Also runs each arm under PowerShell 7 when `pwsh` is
 * on PATH (the Windows CI runner has it).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn, spawnSync } = require('node:child_process');

const WINDOWS_ONLY = { skip: process.platform !== 'win32' && 'setup.ps1 needs Windows PowerShell and Authenticode' };
const SCRIPT = path.resolve(__dirname, 'tools/windows/setup.ps1');
const SIGNED_LAUNCHER = path.resolve(__dirname, 'tools/windows/Kosmos.exe');
const VERSION = '9.9.01';
const VERSIONED = `kosmos-${VERSION}-win-x64.zip`;
/** Generous: powershell.exe's first start on a CI runner, plus Authenticode's certificate checks. */
const RUN_TIMEOUT_MS = 180000;

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const OTHER_SHA = 'ab'.repeat(32);

/** A stored (uncompressed) zip, the shape Info-ZIP and .NET both read. */
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const crc = zlib.crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const MANIFEST = JSON.stringify({ product: 'kosmos', platform: 'win32', arch: 'x64', version: VERSION });
function buildZip(launcherBytes) {
  return makeZip([
    { name: 'Kosmos.exe', data: launcherBytes },
    { name: 'manifest.json', data: MANIFEST },
    { name: 'app/server.js', data: '// not run by these tests\n' },
  ]);
}
const pointerFor = (sha) => Buffer.from(JSON.stringify({ version: VERSION, sha256: sha, artifact: 'kosmos-win-x64.zip', versioned: VERSIONED, arch: 'x64' }) + '\n');
const sidecarFor = (sha) => Buffer.from(`${sha}  ${VERSIONED}\n`);

/**
 * The fake download host. `files` maps a name under /dist to its bytes; a name that is absent is a 404.
 * setup.ps1 itself is served as text/plain, the way a static host serves a .ps1.
 */
async function startHost(files) {
  const types = { '.json': 'application/json', '.zip': 'application/zip', '.sha256': 'application/octet-stream' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/setup.ps1') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(fs.readFileSync(SCRIPT));
      return;
    }
    if (url.pathname.startsWith('/dist/')) {
      res.writeHead(307, { location: '/r2/' + url.pathname.slice('/dist/'.length) + url.search });
      res.end();
      return;
    }
    const name = url.pathname.startsWith('/r2/') ? url.pathname.slice('/r2/'.length) : null;
    if (name && Object.prototype.hasOwnProperty.call(files, name)) {
      res.writeHead(200, { 'content-type': types[path.extname(name)] || 'application/octet-stream' });
      res.end(files[name]);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'win-setup-ps1-test-'));
test.after(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

function hasPwsh() {
  if (process.platform !== 'win32') return false;
  return spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { stdio: 'ignore', windowsHide: true }).status === 0;
}
const SHELLS = ['powershell.exe', ...(hasPwsh() ? ['pwsh'] : [])];

/**
 * Runs `irm <host>/setup.ps1 | iex` in a fresh shell and reports its exit code, its output, and
 * what it left in its own TEMP. `asFile` runs it as `-File` instead, the other way it can be run.
 */
async function runSetup(host, { shell = 'powershell.exe', env = {}, asFile = false, afterIex = '' } = {}) {
  const root = fs.mkdtempSync(path.join(SCRATCH, 'run-'));
  const temp = path.join(root, 'temp');
  const local = path.join(root, 'local');
  fs.mkdirSync(temp);
  fs.mkdirSync(local);
  const childEnv = { ...process.env, TEMP: temp, TMP: temp, LOCALAPPDATA: local, KOSMOS_RELEASE_BASE: `${host.base}/dist`, KOSMOS_SETUP_TEST_NO_LAUNCH: '1', ...env };
  if (!('KOSMOS_UPDATE_CHANNEL' in env)) delete childEnv.KOSMOS_UPDATE_CHANNEL;
  const args = asFile
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT]
    : ['-NoProfile', '-NonInteractive', '-Command', `irm '${host.base}/setup.ps1' | iex; ${afterIex} exit $LASTEXITCODE`];
  const child = spawn(shell, args, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS);
  const code = await new Promise((resolve) => child.on('close', resolve));
  clearTimeout(timer);
  return { code, out, leftInTemp: fs.readdirSync(temp), root };
}

const signedZip = () => buildZip(fs.readFileSync(SIGNED_LAUNCHER));
const goodFiles = (zip) => ({ 'latest-win.json': pointerFor(sha256(zip)), [VERSIONED]: zip, [`${VERSIONED}.sha256`]: sidecarFor(sha256(zip)) });

function assertRefused(result, sentence) {
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, sentence, result.out);
  assert.match(result.out, /Nothing was installed, and anything downloaded has been removed\./, result.out);
  assert.deepEqual(result.leftInTemp, [], 'a refused run leaves nothing in TEMP');
  assert.doesNotMatch(result.out, /Test mode: stopping before opening Kosmos/, 'a refused run never reaches the launch');
  assert.doesNotMatch(result.out, /At line:|CategoryInfo|FullyQualifiedErrorId/, 'no PowerShell error record reaches the person');
}

for (const shell of SHELLS) {
  test(`${shell}: the good path verifies both checksums and the signature, extracts, stops before the launch, and cleans up`, WINDOWS_ONLY, async () => {
    const host = await startHost(goodFiles(signedZip()));
    try {
      const result = await runSetup(host, { shell });
      assert.equal(result.code, 0, result.out);
      assert.match(result.out, new RegExp(`Downloading Kosmos ${VERSION.replace(/\./g, '\\.')}\\.`));
      assert.match(result.out, /Checked: Kosmos\.exe is signed by Kosmos Agent Manager, Inc\., and the download matches both published checksums\./);
      assert.match(result.out, /Test mode: stopping before opening Kosmos\. It would run .*\\kosmos-setup-[0-9a-f]{12}\\Kosmos\\Kosmos\.exe/);
      assert.deepEqual(result.leftInTemp, [], 'the extracted copy is removed once the run is over');
    } finally { await host.close(); }
  });
}

test('a zip whose checksum is not the pointer\'s is refused, and nothing is left behind', WINDOWS_ONLY, async () => {
  const zip = signedZip();
  const host = await startHost({ ...goodFiles(zip), 'latest-win.json': pointerFor(OTHER_SHA), [`${VERSIONED}.sha256`]: sidecarFor(OTHER_SHA) });
  try {
    assertRefused(await runSetup(host), /Kosmos was not installed: the download did not arrive intact/);
  } finally { await host.close(); }
});

test('a zip whose checksum is not the sidecar\'s is refused, even when the pointer matches', WINDOWS_ONLY, async () => {
  const zip = signedZip();
  const host = await startHost({ ...goodFiles(zip), [`${VERSIONED}.sha256`]: sidecarFor(OTHER_SHA) });
  try {
    assertRefused(await runSetup(host), /Kosmos was not installed: the download did not match its published checksum/);
  } finally { await host.close(); }
});

test('a missing sidecar is refused', WINDOWS_ONLY, async () => {
  const files = goodFiles(signedZip());
  delete files[`${VERSIONED}.sha256`];
  const host = await startHost(files);
  try {
    assertRefused(await runSetup(host), /Kosmos was not installed: could not download the download's checksum \(the server answered 404\)/);
  } finally { await host.close(); }
});

test('a missing pointer is refused before anything is downloaded', WINDOWS_ONLY, async () => {
  const files = goodFiles(signedZip());
  delete files['latest-win.json'];
  const host = await startHost(files);
  try {
    assertRefused(await runSetup(host), /Kosmos was not installed: could not download the release information \(the server answered 404\)/);
  } finally { await host.close(); }
});

test('a pointer naming a download outside the published shape is refused', WINDOWS_ONLY, async () => {
  const zip = signedZip();
  const bad = Buffer.from(JSON.stringify({ version: VERSION, sha256: sha256(zip), versioned: '..\\..\\evil.zip', arch: 'x64' }));
  const host = await startHost({ ...goodFiles(zip), 'latest-win.json': bad });
  try {
    assertRefused(await runSetup(host), /the release information names a download in an unexpected form/);
  } finally { await host.close(); }
});

test('a Kosmos.exe with no signature is refused, though both checksums match', WINDOWS_ONLY, async () => {
  const unsigned = Buffer.from(fs.readFileSync(SIGNED_LAUNCHER));
  // Truncating the file removes its signature block (it sits at the end of a PE file).
  const zip = buildZip(unsigned.subarray(0, 4096));
  const host = await startHost(goodFiles(zip));
  try {
    assertRefused(await runSetup(host), /Kosmos was not installed: Kosmos\.exe is not validly signed/);
  } finally { await host.close(); }
});

test('a Kosmos.exe validly signed by someone else is refused', WINDOWS_ONLY, async (t) => {
  // node.exe is Authenticode-signed by the OpenJS Foundation: Valid, but the wrong signer.
  const check = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${process.execPath}').Status`], { encoding: 'utf8', windowsHide: true });
  if (String(check.stdout).trim() !== 'Valid') { t.skip('this node.exe is not validly signed, so it cannot stand in for another signer'); return; }
  const zip = buildZip(fs.readFileSync(process.execPath));
  const host = await startHost(goodFiles(zip));
  try {
    assertRefused(await runSetup(host), /Kosmos was not installed: Kosmos\.exe is signed by '[^']+', not by Kosmos Agent Manager, Inc\./);
  } finally { await host.close(); }
});

test('KOSMOS_UPDATE_CHANNEL=staging reads latest-win-staging.json', WINDOWS_ONLY, async () => {
  const zip = signedZip();
  const files = goodFiles(zip);
  files['latest-win-staging.json'] = files['latest-win.json'];
  delete files['latest-win.json'];
  const host = await startHost(files);
  try {
    const result = await runSetup(host, { env: { KOSMOS_UPDATE_CHANNEL: 'staging' } });
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /Using the staging channel \(latest-win-staging\.json\)\./);
    assert.match(result.out, /Test mode: stopping before opening Kosmos/);
  } finally { await host.close(); }
});

test('under iex nothing leaks into the person\'s session, and a failure keeps their window open', WINDOWS_ONLY, async () => {
  const files = goodFiles(signedZip());
  delete files['latest-win.json'];
  const host = await startHost(files);
  try {
    // After the failed iex the session carries on: this line runs, and sees the person's own settings.
    const probe = "Write-Host ('AFTER state=' + [bool](Get-Variable -Name state -ErrorAction SilentlyContinue) + ' progress=' + $ProgressPreference + ' eap=' + $ErrorActionPreference + ' code=' + $LASTEXITCODE);";
    const result = await runSetup(host, { afterIex: probe });
    assert.match(result.out, /AFTER state=False progress=Continue eap=Continue code=1/, result.out);
    assert.equal(result.code, 1);
  } finally { await host.close(); }
});

test('run as a file, a failure exits 1', WINDOWS_ONLY, async () => {
  const files = goodFiles(signedZip());
  delete files['latest-win.json'];
  const host = await startHost(files);
  try {
    const result = await runSetup(host, { asFile: true });
    assert.equal(result.code, 1, result.out);
    assert.match(result.out, /Kosmos was not installed: could not download the release information/);
  } finally { await host.close(); }
});

// Not Windows-only: these hold on every platform, so the Mac suite checks them too.
test('setup.ps1 is plain ASCII with no em dash (5.1 reads a BOM-less script as the ANSI code page)', () => {
  const bytes = fs.readFileSync(SCRIPT);
  const offending = [...bytes].findIndex((b) => b > 0x7f);
  assert.equal(offending, -1, `non-ASCII byte at offset ${offending}`);
});

test('setup.ps1 never calls exit outside the run-as-file branch, which would close the person\'s window under iex', () => {
  // Comments dropped first: they may talk about exit. (This script has no '#' inside a string.)
  const lines = fs.readFileSync(SCRIPT, 'utf8').split(/\r?\n/).map((line) => line.replace(/#.*$/, '')).filter((line) => /\bexit\b/.test(line));
  assert.deepEqual(lines.map((line) => line.trim()), ['if ($RunAsFile) { exit 1 }']);
});
