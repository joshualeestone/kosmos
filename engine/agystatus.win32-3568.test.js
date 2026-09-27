'use strict';
/**
 * #3568 on Windows: installing Google's agy (checked SHA-512 AND Google's signature, into Kosmos's
 * runners folder, never `agy install`), finding it (only with its verified marker), and the switch
 * that keeps the whole thing OFF on Windows until the operator turns it on. The Mac answers are
 * asserted unchanged beside each Windows one. Runs on any platform: the manifest, download, signature
 * and --version are seams, and the platform is injected.
 *
 *   node -r <no-schtasks-preload> --test engine/agystatus.win32-3568.test.js
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agywin-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_RUNNERS_DIR = path.join(SANDBOX, 'runners');
process.env.KOSMOS_NO_LEGACY_MIGRATION = '1';
delete process.env.AGENT_WORKFORCE_ANTIGRAVITY_WINDOWS;
delete process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN;
delete process.env.AGENT_WORKFORCE_ANTIGRAVITY;

const test = require('node:test');
const assert = require('node:assert/strict');

const runners = require('./runners');
const agystatus = require('./agystatus');
const win32agy = require('./win32agy');
const create = require('./create');

test.after(() => { agystatus.resetForTests(); win32agy.setSwitchForTests(null); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const BYTES = Buffer.from('MZ pretend agy.exe ' + 'x'.repeat(1000));
const SHA = crypto.createHash('sha512').update(BYTES).digest('hex');
const MANIFEST = { version: '1.2.11', url: 'https://storage.googleapis.com/antigravity-public/antigravity-cli/1.2.11-6016716732497920/windows-x64/cli_windows_x64.exe', sha512: SHA };
const GOOGLE = { status: 'Valid', subject: 'CN=Google LLC, O=Google LLC, L=Mountain View, S=California, C=US, SERIALNUMBER=3582691' };
function seams(over) {
  const calls = { manifest: [], download: [], signature: [], prove: [] };
  const o = Object.assign({
    arch: 'x64',
    fetchManifest: async (url) => { calls.manifest.push(url); return MANIFEST; },
    download: async (url, file) => { calls.download.push(url); fs.writeFileSync(file, BYTES, { mode: 0o755 }); },
    signature: async (file) => { calls.signature.push(file); return GOOGLE; },
    prove: (bin, done) => { calls.prove.push(bin); done(null, '1.2.11\n'); },
  }, over || {});
  return { o, calls };
}
const W = { platform: 'win32' };
function wipe() { fs.rmSync(path.join(SANDBOX, 'runners'), { recursive: true, force: true }); }

/* ---- install ------------------------------------------------------------------------------- */

test('install: Google\'s manifest, the download, SHA-512 and Google\'s signature pass, it runs, and only then is it found', async () => {
  wipe();
  assert.equal(runners.resolveBin('antigravity', W).present, false);
  const { o, calls } = seams();
  const r = await runners.installAntigravityWin32(o);
  assert.deepEqual(r, { ok: true, version: '1.2.11' });
  assert.deepEqual(calls.manifest, [runners.AGY_MANIFEST_BASE + 'windows_amd64.json']);
  assert.equal(runners.AGY_MANIFEST_BASE, 'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/');
  assert.deepEqual(calls.download, [MANIFEST.url]);
  const got = runners.resolveBin('antigravity', W);
  assert.equal(got.present, true);
  assert.equal(got.bin, path.join(SANDBOX, 'runners', 'antigravity', 'agy.exe'));
  assert.deepEqual(calls.prove, [got.bin], 'proved by running the placed file');
  assert.deepEqual(fs.readFileSync(got.bin), BYTES);
  assert.deepEqual(fs.readdirSync(path.join(SANDBOX, 'runners', '.tmp')), [], 'no staging left');
  // CONTROL: the Mac rung is untouched (its vendor path under the home, named agy).
  assert.equal(runners.resolveBin('antigravity', { platform: 'darwin' }).bin, path.join(SANDBOX, '.local', 'bin', 'agy'));
});

test('install: a checksum that does not match is discarded, and nothing is found', async () => {
  wipe();
  const { o, calls } = seams({ download: async (url, file) => { fs.writeFileSync(file, Buffer.from('tampered')); } });
  const r = await runners.installAntigravityWin32(o);
  assert.equal(r.ok, false);
  assert.match(r.because, /did not match the checksum Google publishes/);
  assert.equal(calls.signature.length, 0, 'never asked about a file that failed its checksum');
  assert.equal(runners.resolveBin('antigravity', W).present, false);
});

test('install: a file not signed by Google LLC (or not validly signed) is discarded', async () => {
  for (const sig of [{ status: 'Valid', subject: 'CN=Evil LLC, O=Evil LLC' }, { status: 'NotSigned', subject: '' }, { status: 'HashMismatch', subject: GOOGLE.subject },
    { status: 'Valid', subject: 'CN=Google LLC Impostor, O=Other' }]) {
    wipe();
    const { o, calls } = seams({ signature: async () => sig });
    const r = await runners.installAntigravityWin32(o);
    assert.equal(r.ok, false, JSON.stringify(sig));
    assert.match(r.because, /not signed by Google/);
    assert.equal(calls.prove.length, 0);
    assert.equal(runners.resolveBin('antigravity', W).present, false);
  }
  assert.equal(runners.agySignedByGoogle(GOOGLE), true);
});

test('install: a manifest in a shape Kosmos does not know downloads nothing; an unknown CPU is refused by name', async () => {
  for (const bad of [null, { ...MANIFEST, url: MANIFEST.url.replace('https:', 'http:') }, { ...MANIFEST, url: 'https://evil.example/agy.exe' },
    { ...MANIFEST, sha512: 'abc' }, { ...MANIFEST, version: '../../x' }]) {
    wipe();
    const { o, calls } = seams({ fetchManifest: async () => bad });
    const r = await runners.installAntigravityWin32(o);
    assert.equal(r.ok, false);
    assert.equal(calls.download.length, 0, JSON.stringify(bad));
  }
  const { o, calls } = seams({ arch: 'ia32' });
  const r = await runners.installAntigravityWin32(o);
  assert.match(r.because, /no Windows Antigravity for this kind of processor \(ia32\)/);
  assert.equal(calls.manifest.length, 0);
});

test('install: a file that does not run is not vouched for', async () => {
  wipe();
  const { o } = seams({ prove: (bin, done) => done(new Error('bad image')) });
  const r = await runners.installAntigravityWin32(o);
  assert.equal(r.ok, false);
  assert.match(r.because, /did not start/);
  assert.equal(runners.resolveBin('antigravity', W).present, false, 'no marker, not present');
});

test('resolve: on Windows an override must be agy.exe (or agy); the Mac rule is unchanged', () => {
  const dir = path.join(SANDBOX, 'ov'); fs.mkdirSync(dir, { recursive: true });
  const other = path.join(dir, 'gemini.exe'); fs.writeFileSync(other, 'x', { mode: 0o755 });
  process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN = other;
  try {
    const r = runners.resolveBin('antigravity', W);
    assert.equal(r.present, false);
    assert.match(r.because, /agy\.exe/);
    assert.equal(runners.isAgyName('C:\\x\\AGY.EXE', 'win32'), true);
    assert.equal(runners.isAgyName('agy.exe', 'darwin'), false, 'CONTROL: a Mac pane shows agy, never agy.exe');
    assert.equal(runners.isAgyName('agy', 'darwin'), true);
  } finally { delete process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN; }
});

/* ---- the switch ---------------------------------------------------------------------------- */

test('Windows is OFF until switched on: not supported, not offered, no install, no sign-in; the Mac is unchanged', async () => {
  agystatus.setPlatformForTests('win32');
  win32agy.setSwitchForTests(() => false);
  assert.equal(agystatus.supported(), false);
  assert.deepEqual(agystatus.installedForScreen(), { installed: false, enabled: true, supported: false });
  let ranWin = 0; let ranMac = 0;
  agystatus.setWin32InstallerForTests(async () => { ranWin += 1; return { ok: true }; });
  agystatus.setInstallerForTests((done) => { ranMac += 1; done(null); });
  assert.match((await agystatus.install()).because, /not available on this computer yet/);
  assert.match((await agystatus.openForSignIn()).because, /not available on this computer yet/);
  assert.equal((await agystatus.check()).offered, false);
  assert.equal(ranWin + ranMac, 0);

  win32agy.setSwitchForTests(() => true);
  assert.equal(agystatus.supported(), true, 'switched on');
  assert.equal(agystatus.installedForScreen().supported, true);

  agystatus.setPlatformForTests('darwin');
  win32agy.setSwitchForTests(() => false);
  assert.equal(agystatus.supported(), true, 'CONTROL: the Mac never reads the Windows switch');
  agystatus.resetForTests();
  win32agy.setSwitchForTests(null);
});

test('switched on, Windows installs with the Windows installer (never Google\'s shell script) and checks with agy models (no prompt)', async () => {
  agystatus.setPlatformForTests('win32');
  win32agy.setSwitchForTests(() => true);
  let ranMac = 0; let ranWin = 0;
  agystatus.setInstallerForTests((done) => { ranMac += 1; done(null); });
  agystatus.setWin32InstallerForTests(async () => { ranWin += 1; return { ok: false, because: 'the download server did not hand over Antigravity (it answered 503), so nothing was installed. Try again later' }; });
  const r = await agystatus.install();
  assert.equal(ranMac, 0, 'Google\'s bash installer is never run on Windows');
  assert.equal(ranWin, 1);
  assert.match(r.because, /answered 503/);

  const fake = path.join(SANDBOX, 'ov2', process.platform === 'win32' ? 'agy.exe' : 'agy');
  fs.mkdirSync(path.dirname(fake), { recursive: true }); fs.writeFileSync(fake, 'x', { mode: 0o755 });
  process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN = fake;
  try {
    const seen = [];
    agystatus.setRunnerForTests((bin, done) => { seen.push(bin); done(null, '', { signedIn: true }); });
    assert.deepEqual(await agystatus.check(), { installed: true, signedIn: true });
    agystatus.setRunnerForTests((bin, done) => done(null, '', { signedIn: false, because: 'Antigravity is not signed in to Google on this computer' }));
    const out = await agystatus.check();
    assert.equal(out.signedIn, null, 'signed out stays "could not confirm" to the screen');
    assert.match(out.because, /not signed in/);
  } finally { delete process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN; agystatus.resetForTests(); win32agy.setSwitchForTests(null); }
});

/* ---- create -------------------------------------------------------------------------------- */

test('create: an Antigravity agent on Windows is refused while the switch is off, and gets past that refusal once it is on', () => {
  win32agy.setSwitchForTests(() => false);
  const off = create.setProvider('nobody', 'antigravity', { platform: 'win32' });
  assert.equal(off.outcome, create.OUTCOME.REFUSED);
  assert.match(off.because, /cannot start an Antigravity agent on Windows yet/);
  win32agy.setSwitchForTests(() => true);
  // Past the refusal it asks for the agent's task; a seam answers "no such task", so no schtasks runs.
  const job = require('./win32job');
  job.setRunner(() => ({ ok: false, out: 'ERROR: The system cannot find the file specified.' }));
  try {
    const on = create.setProvider('nobody', 'antigravity', { platform: 'win32' });
    assert.doesNotMatch(String(on.because), /on Windows yet/, 'the Windows refusal is gone with the switch on');
  } finally { job.setRunner(null); win32agy.setSwitchForTests(null); }
});
