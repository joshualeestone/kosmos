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

const manifestText = (overrides = {}) => JSON.stringify({ product: 'kosmos', platform: 'win32', arch: 'x64', version: VERSION, ...overrides });
function buildZip(launcherBytes, { manifest = manifestText() } = {}) {
  return makeZip([
    ...(launcherBytes ? [{ name: 'Kosmos.exe', data: launcherBytes }] : []),
    { name: 'manifest.json', data: manifest },
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
    if (name && files[name] === STALL) return;   // never answers: the download must time out
    if (name && Object.prototype.hasOwnProperty.call(files, name)) {
      res.writeHead(200, { 'content-type': types[path.extname(name)] || 'application/octet-stream' });
      res.end(files[name]);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}
const STALL = Symbol('stall');

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'win-setup-ps1-test-'));
test.after(() => fs.rmSync(SCRATCH, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));

function hasPwsh() {
  if (process.platform !== 'win32') return false;
  return spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { stdio: 'ignore', windowsHide: true }).status === 0;
}
const SHELLS = ['powershell.exe', ...(hasPwsh() ? ['pwsh'] : [])];
/** For the tests' own powershell.exe probes: no inherited PSModulePath, so 5.1 uses its own module folders even when these tests run under PowerShell 7 (as CI does). */
const PROBE_ENV = (() => { const env = { ...process.env }; for (const key of Object.keys(env)) if (/^psmodulepath$/i.test(key)) delete env[key]; return env; })();

/**
 * Runs `irm <host>/setup.ps1 | iex` in a fresh shell and reports its exit code, its output, and
 * what it left in its own TEMP. `asFile` runs it as `-File` instead, the other way it can be run.
 */
/**
 * The launch seam's stand-in for Kosmos.exe (KOSMOS_SETUP_TEST_LAUNCHER): a script run with the
 * extracted folder as its argument, doing what one real launcher outcome leaves behind.
 *   handover         exits 0 and leaves nothing (the launcher installed itself and handed over)
 *   fail             exits 3 and leaves nothing
 *   pointer          points the engine pointer at the folder, exits 0 (runs from here)
 *   pointer-and-stay points it at the folder and keeps running (a board serving from here)
 *   running          leaves a process running from inside the folder, exits 0
 *   locked           leaves the engine pointer held open with no sharing, exits 0 (being written)
 * Every process it leaves behind writes its id to SETUP_STUB_PIDS, for the test to end.
 */
const STUB_LAUNCHER = String.raw`
param([string] $Folder)
$anchor = Join-Path $env:LOCALAPPDATA 'Kosmos\runtime'
$pointer = Join-Path $anchor 'engine-path'
function Note-Pid($p) { Add-Content -LiteralPath $env:SETUP_STUB_PIDS -Value $p.Id }
switch ($env:SETUP_STUB_MODE) {
  'handover' { exit 0 }
  'fail' { exit 3 }
  'pointer' { New-Item -ItemType Directory -Force $anchor | Out-Null; [IO.File]::WriteAllText($pointer, "$Folder\app\engine"); exit 0 }
  'pointer-and-stay' { Add-Content -LiteralPath $env:SETUP_STUB_PIDS -Value $PID; New-Item -ItemType Directory -Force $anchor | Out-Null; [IO.File]::WriteAllText($pointer, "$Folder\app\engine"); Start-Sleep -Seconds 60; exit 0 }
  'running' {
    $copy = Join-Path $Folder 'still-running.exe'
    Copy-Item -LiteralPath $env:SETUP_STUB_NODE -Destination $copy
    Note-Pid (Start-Process -FilePath $copy -ArgumentList '-e', 'setTimeout(()=>{},60000)' -PassThru -WindowStyle Hidden -WorkingDirectory $env:SETUP_STUB_CWD)
    exit 0
  }
  'locked' {
    New-Item -ItemType Directory -Force $anchor | Out-Null
    [IO.File]::WriteAllText($pointer, 'C:\somewhere-else\app\engine')
    $ready = "$pointer.ready"
    $hold = '$held = [IO.File]::Open(''{0}'', ''Open'', ''ReadWrite'', ''None''); [IO.File]::WriteAllText(''{1}'', ''x''); Start-Sleep -Seconds 60; $held.Close()' -f $pointer, $ready
    Note-Pid (Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile', '-Command', $hold -PassThru -WindowStyle Hidden -WorkingDirectory $env:SETUP_STUB_CWD)
    while (-not (Test-Path -LiteralPath $ready)) { Start-Sleep -Milliseconds 100 }
    exit 0
  }
}
exit 9
`;

/**
 * Runs `irm <host>/setup.ps1 | iex` in a fresh shell and reports its exit code, its output, and
 * what it left in its own TEMP. `asFile` runs it as `-File` instead, the other way it can be run.
 * `stub` runs the launch step with STUB_LAUNCHER in that mode instead of stopping before it.
 */
async function runSetup(host, { shell = 'powershell.exe', env = {}, asFile = false, beforeIex = '', afterIex = '', stub = null, timeoutMs = RUN_TIMEOUT_MS } = {}) {
  const root = fs.mkdtempSync(path.join(SCRATCH, 'run-'));
  const temp = path.join(root, 'temp');
  const local = path.join(root, 'local');
  fs.mkdirSync(temp);
  fs.mkdirSync(local);
  const pids = path.join(root, 'stub-pids.txt');
  const childEnv = { ...process.env, TEMP: temp, TMP: temp, LOCALAPPDATA: local, KOSMOS_RELEASE_BASE: `${host.base}/dist`, KOSMOS_SETUP_TEST_NO_LAUNCH: '1', ...env };
  if (!('KOSMOS_UPDATE_CHANNEL' in env)) delete childEnv.KOSMOS_UPDATE_CHANNEL;
  if (stub) {
    const stubFile = path.join(root, 'stub-launcher.ps1');
    fs.writeFileSync(stubFile, STUB_LAUNCHER);
    delete childEnv.KOSMOS_SETUP_TEST_NO_LAUNCH;
    Object.assign(childEnv, { KOSMOS_SETUP_TEST_LAUNCHER: stubFile, SETUP_STUB_MODE: stub, SETUP_STUB_PIDS: pids, SETUP_STUB_NODE: process.execPath, SETUP_STUB_CWD: root });
  }
  const args = asFile
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT]
    : ['-NoProfile', '-NonInteractive', '-Command', `${beforeIex} irm '${host.base}/setup.ps1' | iex; ${afterIex} exit $LASTEXITCODE`];
  const started = Date.now();
  const child = spawn(shell, args, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
  const code = await new Promise((resolve) => child.on('close', resolve));
  clearTimeout(timer);
  const elapsedMs = Date.now() - started;
  const leftInTemp = fs.readdirSync(temp);
  const work = leftInTemp.find((name) => name.startsWith('kosmos-setup-'));
  const kept = work ? path.join(temp, work, 'Kosmos') : null;
  // The stub's leftovers end here, after the listing: they are what kept the folder.
  if (fs.existsSync(pids)) {
    for (const pid of fs.readFileSync(pids, 'utf8').split(/\s+/).filter(Boolean)) spawnSync('taskkill', ['/F', '/T', '/PID', pid], { stdio: 'ignore', windowsHide: true });
  }
  return { code, out, leftInTemp, kept, elapsedMs, timedOut, root };
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

test('an empty pointer ({}) is refused in a sentence, not an error', WINDOWS_ONLY, async () => {
  const host = await startHost({ ...goodFiles(signedZip()), 'latest-win.json': Buffer.from('{}') });
  try {
    assertRefused(await runSetup(host), /Kosmos was not installed: the release information is missing its version\./);
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
  const check = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${process.execPath}').Status`], { encoding: 'utf8', windowsHide: true, env: PROBE_ENV });
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

// ---- Windows PowerShell 5.1 started from inside PowerShell 7 (CI's first red, PR #4565) ----

function pwshModulesFolder() {
  if (!hasPwsh()) return null;
  const home = String(spawnSync('pwsh', ['-NoProfile', '-Command', '$PSHOME'], { encoding: 'utf8', windowsHide: true }).stdout).trim();
  const modules = home && path.join(home, 'Modules');
  return modules && fs.existsSync(modules) ? modules : null;
}

test('5.1 run with PowerShell 7\'s module folders first on PSModulePath still hashes and checks the signature', WINDOWS_ONLY, async (t) => {
  // What powershell.exe inherits when anything PowerShell 7 started (a terminal, an editor, the CI
  // step running these tests) starts it: 7's module folders ahead of 5.1's. 5.1 then finds 7's
  // Microsoft.PowerShell.Utility and .Security first, cannot load them, and Get-FileHash and
  // Get-AuthenticodeSignature stop working.
  const modules = pwshModulesFolder();
  if (!modules) { t.skip('no PowerShell 7 here to take module folders from'); return; }
  const inherited = [modules, process.env.PSModulePath || ''].join(';');
  const host = await startHost(goodFiles(signedZip()));
  try {
    const result = await runSetup(host, { env: { PSModulePath: inherited } });
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /Checked: Kosmos\.exe is signed by Kosmos Agent Manager, Inc\./);
    assert.deepEqual(result.leftInTemp, []);
  } finally { await host.close(); }
  // And a refusal under that path is still the named one, not "something unexpected".
  const zip = signedZip();
  const bad = await startHost({ ...goodFiles(zip), [`${VERSIONED}.sha256`]: sidecarFor(OTHER_SHA) });
  try {
    assertRefused(await runSetup(bad, { env: { PSModulePath: inherited } }), /the download did not match its published checksum/);
  } finally { await bad.close(); }
});

// ---- after the launch (review of #4549: the folder is kept unless it is positively free) ----

function assertKept(result) {
  assert.ok(result.kept && fs.existsSync(path.join(result.kept, 'Kosmos.exe')), `the extracted copy must be kept; TEMP holds ${JSON.stringify(result.leftInTemp)}\n${result.out}`);
}

test('launch: a launcher that hands over cleanly leaves nothing behind', WINDOWS_ONLY, async () => {
  const host = await startHost(goodFiles(signedZip()));
  try {
    const result = await runSetup(host, { stub: 'handover' });
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /Done\. Kosmos is installed and opening\./);
    assert.deepEqual(result.leftInTemp, [], 'handed over: the extracted copy is removed');
  } finally { await host.close(); }
});

test('launch: a process still running from the extracted folder keeps it', WINDOWS_ONLY, async () => {
  const host = await startHost(goodFiles(signedZip()));
  try {
    const result = await runSetup(host, { stub: 'running' });
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /Kosmos is running from .* for now; please leave that folder alone\./);
    assertKept(result);
  } finally { await host.close(); }
});

test('launch: an engine pointer naming the extracted folder keeps it', WINDOWS_ONLY, async () => {
  const host = await startHost(goodFiles(signedZip()));
  try {
    const result = await runSetup(host, { stub: 'pointer' });
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /Kosmos is running from .* for now/);
    assertKept(result);
  } finally { await host.close(); }
});

test('launch: a launcher that stays running with the pointer on the folder ends the wait at once and keeps it', WINDOWS_ONLY, async () => {
  const host = await startHost(goodFiles(signedZip()));
  try {
    const result = await runSetup(host, { stub: 'pointer-and-stay' });
    assert.equal(result.code, 0, result.out);
    assert.ok(result.elapsedMs < 40000, `the wait should end on the pointer, not the launcher (${result.elapsedMs} ms)`);
    assertKept(result);
  } finally { await host.close(); }
});

test('launch: an engine pointer that cannot be read (held open while written) keeps the folder', WINDOWS_ONLY, async () => {
  const host = await startHost(goodFiles(signedZip()));
  try {
    const result = await runSetup(host, { stub: 'locked' });
    assert.match(result.out, /Could not confirm Kosmos has finished with .*, so it is left in place/, result.out);
    assert.equal(result.code, 0, result.out);
    assertKept(result);
  } finally { await host.close(); }
});

test('launch: a launcher that fails with nothing using the folder removes it and says so', WINDOWS_ONLY, async () => {
  const host = await startHost(goodFiles(signedZip()));
  try {
    const result = await runSetup(host, { stub: 'fail' });
    assert.equal(result.code, 1, result.out);
    assert.match(result.out, /Kosmos did not finish opening: Kosmos\.exe stopped with a problem \(code 3\)/);
    assert.deepEqual(result.leftInTemp, []);
  } finally { await host.close(); }
});

// ---- pointer, zip and manifest shapes ----

const pointerWith = (zip, fields) => Buffer.from(JSON.stringify({ version: VERSION, sha256: sha256(zip), artifact: 'kosmos-win-x64.zip', versioned: VERSIONED, arch: 'x64', ...fields }));
const POINTER_CASES = [
  ['an uppercase sha256', (zip) => ({ sha256: sha256(zip).toUpperCase() }), /the release information has an unreadable checksum\./],
  ['a short sha256', (zip) => ({ sha256: sha256(zip).slice(0, 63) }), /the release information has an unreadable checksum\./],
  ['a sha256 with a trailing newline', (zip) => ({ sha256: sha256(zip) + '\n' }), /the release information has an unreadable checksum\./],
  ['a version outside the pattern', () => ({ version: '9.9 01', versioned: 'kosmos-9.9 01-win-x64.zip' }), /names a download in an unexpected form/],
  ['a version with a trailing newline', () => ({ version: VERSION + '\n', versioned: `kosmos-${VERSION}\n-win-x64.zip` }), /names a download in an unexpected form/],
  ['an arch outside the pattern', () => ({ arch: 'x6/4', versioned: `kosmos-${VERSION}-win-x6/4.zip` }), /names a download in an unexpected form/],
  ['an arch with a trailing newline', () => ({ arch: 'x64\n', versioned: `kosmos-${VERSION}-win-x64\n.zip` }), /names a download in an unexpected form/],
  ['a wrong versioned name', () => ({ versioned: `kosmos-${VERSION}-win-arm64.zip` }), /names a download in an unexpected form/],
  ['a versioned name with a trailing newline', () => ({ versioned: VERSIONED + '\n' }), /names a download in an unexpected form/],
];
for (const [what, fields, sentence] of POINTER_CASES) {
  test(`a pointer with ${what} is refused`, WINDOWS_ONLY, async () => {
    const zip = signedZip();
    const host = await startHost({ ...goodFiles(zip), 'latest-win.json': pointerWith(zip, fields(zip)) });
    try { assertRefused(await runSetup(host), sentence); } finally { await host.close(); }
  });
}

const ZIP_CASES = [
  ['a zip with no Kosmos.exe', () => buildZip(null), /the download has no Kosmos\.exe in it\./],
  ['a zip whose manifest names another product', () => buildZip(fs.readFileSync(SIGNED_LAUNCHER), { manifest: manifestText({ product: 'other' }) }), /the download is not a Kosmos for Windows build\./],
  ['a zip whose manifest names another platform', () => buildZip(fs.readFileSync(SIGNED_LAUNCHER), { manifest: manifestText({ platform: 'darwin' }) }), /the download is not a Kosmos for Windows build\./],
  ['a corrupt zip (right checksums, not a zip)', () => Buffer.from('this is not a zip file at all'), /the download could not be unpacked/],
];
for (const [what, makeBytes, sentence] of ZIP_CASES) {
  test(`${what} is refused`, WINDOWS_ONLY, async () => {
    const host = await startHost(goodFiles(makeBytes()));
    try { assertRefused(await runSetup(host), sentence); } finally { await host.close(); }
  });
}

// ---- TLS ----

const TLS_PROBE = "Write-Host ('AFTER tls=' + [Net.ServicePointManager]::SecurityProtocol);";
test('TLS: SystemDefault is left alone during the run (OR-ing Tls12 into it would mean TLS 1.2 only) and after', WINDOWS_ONLY, async () => {
  const host = await startHost(goodFiles(signedZip()));
  try {
    const result = await runSetup(host, { beforeIex: "[Net.ServicePointManager]::SecurityProtocol = 'SystemDefault';", afterIex: TLS_PROBE });
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /TLS during the run: SystemDefault\)/, result.out);
    assert.match(result.out, /AFTER tls=SystemDefault/);
  } finally { await host.close(); }
});

test('TLS: an explicit list gains Tls12 during the run and is restored after, on success and on failure', WINDOWS_ONLY, async () => {
  const files = goodFiles(signedZip());
  const host = await startHost(files);
  try {
    const good = await runSetup(host, { beforeIex: "[Net.ServicePointManager]::SecurityProtocol = 'Tls11';", afterIex: TLS_PROBE });
    assert.equal(good.code, 0, good.out);
    assert.match(good.out, /TLS during the run: Tls11, Tls12\)/, good.out);
    assert.match(good.out, /AFTER tls=Tls11\r?\n/);
    delete files['latest-win.json'];
    const bad = await runSetup(host, { beforeIex: "[Net.ServicePointManager]::SecurityProtocol = 'Tls11';", afterIex: TLS_PROBE });
    assert.equal(bad.code, 1, bad.out);
    assert.match(bad.out, /AFTER tls=Tls11\r?\n/);
  } finally { await host.close(); }
});

// ---- the zip download's timeout ----

test('a zip download that never answers ends with a sentence, not a hung window', WINDOWS_ONLY, async () => {
  const zip = signedZip();
  const host = await startHost({ ...goodFiles(zip), [VERSIONED]: STALL });
  try {
    const result = await runSetup(host, { env: { KOSMOS_SETUP_TEST_ZIP_TIMEOUT_SECONDS: '3' }, timeoutMs: 60000 });
    assert.equal(result.timedOut, false, 'the script must end on its own');
    assertRefused(result, new RegExp(`could not download Kosmos ${VERSION.replace(/\./g, '\\.')} \\(it took longer than 3 seconds\\)\\.`));
  } finally { await host.close(); }
});

// ---- the signer and its chain ----

test('a Kosmos.exe signed with a self-made certificate named Kosmos Agent Manager, Inc. is refused', WINDOWS_ONLY, async () => {
  const signedCopy = path.join(SCRATCH, 'self-signed-Kosmos.exe');
  fs.copyFileSync(SIGNED_LAUNCHER, signedCopy);
  const make = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', [
    "$c = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=\"Kosmos Agent Manager, Inc.\"' -CertStoreLocation Cert:\\CurrentUser\\My",
    `try { $s = Set-AuthenticodeSignature -LiteralPath '${signedCopy}' -Certificate $c; Write-Output ('signed ' + $s.Status) }`,
    "finally { Remove-Item -LiteralPath ('Cert:\\CurrentUser\\My\\' + $c.Thumbprint) -DeleteKey }",
  ].join('\n')], { encoding: 'utf8', windowsHide: true, env: PROBE_ENV });
  assert.match(String(make.stdout), /signed /, `could not make the self-signed fixture: ${make.stdout}${make.stderr}`);
  const host = await startHost(goodFiles(buildZip(fs.readFileSync(signedCopy))));
  try {
    assertRefused(await runSetup(host), /Kosmos was not installed: Kosmos\.exe is not validly signed/);
  } finally { await host.close(); }
});

test('the chain check: a valid signature whose name matches but whose chain is not Microsoft ID Verified is refused', WINDOWS_ONLY, async (t) => {
  // Windows PowerShell's own powershell.exe is validly signed (by catalog, which a copy keeps) as
  // "Microsoft Windows", under Microsoft Root Certificate Authority 2010, not the ID Verified chain.
  // (node.exe cannot stand in here: it is signed through the same Microsoft service as Kosmos.exe.)
  // The test-only KOSMOS_SETUP_TEST_EXPECTED_SIGNER (honoured only with NO_LAUNCH) makes its name the
  // expected one, so only the chain check stands between it and the launch.
  const other = path.join(process.env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const probe = spawnSync('powershell.exe', ['-NoProfile', '-Command', `$s = Get-AuthenticodeSignature -LiteralPath '${other}'; if ($s.Status -eq 'Valid') { $s.SignerCertificate.GetNameInfo('SimpleName', $false) }`], { encoding: 'utf8', windowsHide: true, env: PROBE_ENV });
  const otherSigner = String(probe.stdout).trim();
  if (!otherSigner) { t.skip('powershell.exe is not validly signed here'); return; }
  const host = await startHost(goodFiles(buildZip(fs.readFileSync(other))));
  try {
    assertRefused(await runSetup(host, { env: { KOSMOS_SETUP_TEST_EXPECTED_SIGNER: otherSigner } }),
      /Kosmos\.exe's signature does not come from Microsoft's code-signing service for .* \(its chain ends at /);
  } finally { await host.close(); }
});
