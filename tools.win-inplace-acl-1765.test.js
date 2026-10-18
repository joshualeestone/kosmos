'use strict';
/**
 * #1765, Windows: Kosmos.exe refuses to run from a folder outside this person's profile that other people on the
 * PC can change (UnsafeRunFolderReason in tools/windows/KosmosLauncher.cs), before anything from that folder runs.
 *
 * Two halves, as tools.win-launcher-board-proof-1765.test.js does it:
 *   - the SOURCE (every platform): the check comes first in Main, before the uninstall, the window and the
 *     installer duties, and its rights and trusted accounts are the ones the plan names;
 *   - Windows only: a PROBE compiled beside KosmosLauncher.cs reads real folders whose permissions icacls sets
 *     (the profile seam pointed elsewhere, so a folder in the temp folder is read as if it were outside the
 *     profile), and a launcher built from this source runs from real folders at the root of the system drive:
 *     refused, with nothing from the folder run, where Users can write; started where only this user, SYSTEM and
 *     Administrators can.
 *
 * The committed tools/windows/Kosmos.exe is a signed binary built from this source; it is rebuilt and re-signed as
 * its own release step, so this tests the source, not that binary.
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const REPO = __dirname;
const LAUNCHER = path.join(REPO, 'tools', 'windows', 'KosmosLauncher.cs');
const SOURCE = fs.readFileSync(LAUNCHER, 'utf8');
const WINDOWS_ONLY = { skip: process.platform !== 'win32' && 'the probe needs Windows and its C# compiler' };
const SYSROOT = process.env.SystemRoot || 'C:\\Windows';
const CSC = path.join(SYSROOT, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const ICACLS = path.join(SYSROOT, 'System32', 'icacls.exe');
const USERS = '*S-1-5-32-545';
const EVERYONE = '*S-1-1-0';
const AUTH_USERS = '*S-1-5-11';

function slice(start, end) {
  const at = SOURCE.indexOf(start);
  assert.notEqual(at, -1, start + ' is gone from KosmosLauncher.cs');
  const to = SOURCE.indexOf(end, at + start.length);
  assert.notEqual(to, -1, 'the end of ' + start + ' is gone');
  return SOURCE.slice(at, to);
}

/* ---- the source ------------------------------------------------------------ */

test('#1765: Main refuses an unsafe folder before anything from it runs, the uninstall included', () => {
  const main = slice('static int Main(string[] args)', '\n    }\n');
  const check = main.indexOf('string unsafeFolder = UnsafeRunFolderReason(here);');
  const refuse = main.indexOf('if (unsafeFolder != null) return RefuseUnsafeFolder(here, unsafeFolder, wantsUninstall);');
  assert.ok(check !== -1 && refuse > check, 'Main no longer checks the folder');
  for (const later of ['if (wantsUninstall) return Uninstall(here, node);', 'return RunBoardWindow(', 'RunInstallerDuties(here, node, port)', 'Process.Start(o)', 'new ProcessStartInfo(node,']) {
    const at = main.indexOf(later);
    assert.ok(at !== -1, later + ' moved out of Main');
    assert.ok(at > refuse, later + ' comes before the folder check');
  }
});

test('#1765: the rights that count, and the only accounts that may hold them', () => {
  assert.match(SOURCE, /internal const int RunFolderChangeRights = FILE_WRITE_DATA \| FILE_APPEND_DATA \| FILE_WRITE_EA \| FILE_DELETE_CHILD \| DELETE_RIGHT \| WRITE_DAC \| WRITE_OWNER \| GENERIC_ALL \| GENERIC_WRITE;/);
  assert.match(SOURCE, /internal const int AncestorChangeRights = FILE_DELETE_CHILD \| DELETE_RIGHT \| WRITE_DAC \| WRITE_OWNER \| GENERIC_ALL \| GENERIC_WRITE;/);
  const writers = slice('static readonly string[] TrustedWriterSids = {', '};');
  assert.deepEqual([...writers.matchAll(/"(S-[0-9-]+)"/g)].map((m) => m[1]),
    ['S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464', 'S-1-3-0', 'S-1-3-4']);
  const owners = slice('static readonly string[] TrustedOwnerSids = {', '};');
  assert.deepEqual([...owners.matchAll(/"(S-[0-9-]+)"/g)].map((m) => m[1]),
    ['S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464']);
  // Inside the profile is trusted by where it is; everything else is read, and a read that fails refuses.
  const reason = slice('internal static string UnsafeRunFolderReason(string here)', '\n    }\n');
  assert.match(reason, /if \(profile != null && IsSameOrInside\(full, profile\)\) return null;/);
  const other = slice('static string OtherWriterOf(', '\n    }\n');
  assert.match(other, /catch \(Exception e\) \{ return "who can change "/);
  assert.match(other, /if \(acl == null \|\| !hasDacl\) return "anyone can change "/);
});

test('#1765: the refusal is plain, says what to do, and carries no em dash', () => {
  const message = slice('internal static string UnsafeFolderMessage(', '\n    }\n');
  assert.match(message, /other people who use this computer may be able to change the files in that folder/);
  assert.match(message, /Download Kosmos again, extract it into " \+ downloads \+ ", and open Kosmos\.exe from there/);
  // The Downloads folder named is the profile's own, spelled out: one moved to another drive would be refused too.
  assert.match(message, /string downloads = profile != null \? Path\.Combine\(profile, "Downloads"\)/);
  assert.match(message, /You can then uninstall it from Settings > Apps, and once you have next signed in to Windows, delete /);
  assert.doesNotMatch(slice('// ---- a folder other people can change (#1765)', 'static int FailInsideZip()'), /\u2014/);
});

/* ---- Windows: real folders --------------------------------------------------- */

let probeExe = null;
let launcherExe = null;
let buildDir = null;
let mySid = null;
const made = [];

function icacls(folder, ...args) {
  const r = spawnSync(ICACLS, [folder, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, 'icacls ' + args.join(' ') + ' failed: ' + r.stdout + r.stderr);
}
// Only this user, SYSTEM and Administrators, nothing inherited.
function lockDown(folder) {
  icacls(folder, '/inheritance:r', '/grant:r', '*' + mySid + ':(OI)(CI)F', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F');
}
function probe(folder, profile) {
  const r = spawnSync(probeExe, profile === undefined ? [folder] : [folder, profile], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(r.status, 0, 'the probe failed: ' + r.stdout + r.stderr);
  return r.stdout.trim();
}
const needsBuild = (t) => { if (!probeExe) { t.skip('no probe (not Windows, or no compiler)'); return false; } return true; };

test('#1765: the probe and a launcher compile from this source', WINDOWS_ONLY, (t) => {
  if (!fs.existsSync(CSC)) { t.skip('no .NET Framework compiler on this machine'); return; }
  const who = spawnSync(path.join(SYSROOT, 'System32', 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  mySid = (String(who.stdout).match(/"(S-1-[0-9-]+)"/) || [])[1];
  assert.ok(mySid, 'whoami did not name this account: ' + who.stdout);
  buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-acl-probe-'));
  fs.writeFileSync(path.join(buildDir, 'AclProbe.cs'), `
using System;
class AclProbe {
  static int Main(string[] a) {
    if (a.Length > 1) { string p = a[1]; KosmosLauncher.userProfileFolder = () => p; }
    string r = KosmosLauncher.UnsafeRunFolderReason(a[0]);
    Console.Write(r == null ? "SAFE" : "UNSAFE " + r);
    return 0;
  }
}
`);
  const p = path.join(buildDir, 'probe.exe');
  let built = spawnSync(CSC, ['/nologo', '/target:exe', '/main:AclProbe', '/out:' + p, LAUNCHER, path.join(buildDir, 'AclProbe.cs')], { encoding: 'utf8', windowsHide: true });
  assert.equal(built.status, 0, 'the probe did not compile: ' + built.stdout + built.stderr);
  // The launcher itself, with the flags verify-launcher.ps1 uses, named Kosmos.exe as the real one is.
  const exe = path.join(buildDir, 'Kosmos.exe');
  built = spawnSync(CSC, ['/nologo', '/target:winexe', '/optimize+', '/platform:anycpu', '/win32icon:' + path.join(REPO, 'assets', 'kosmos.ico'), '/out:' + exe, LAUNCHER], { encoding: 'utf8', windowsHide: true });
  assert.equal(built.status, 0, 'the launcher did not compile: ' + built.stdout + built.stderr);
  probeExe = p;
  launcherExe = exe;
});

// A folder in the temp folder, read as if it were outside the profile (the seam names a profile it is not in).
const NOT_MY_PROFILE = 'Z:\\not-this-profile';
function sandboxFolder(name) {
  const f = path.join(fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-acl-'))), name);
  fs.mkdirSync(f);
  return f;
}
// The temp folder's own branch must be safe for the cases below to mean anything; a CI image whose temp folder
// is not is a fact about that image, said plainly, not a failure of the check.
function baselineOrSkip(t) {
  const base = sandboxFolder('base');
  lockDown(base);
  const answer = probe(base, NOT_MY_PROFILE);
  if (answer !== 'SAFE') {
    assert.ok(!answer.includes(base), 'a locked-down folder was refused for its own permissions: ' + answer);
    t.skip('this machine\'s temp folder branch is itself writable by others: ' + answer);
    return false;
  }
  return true;
}

test('#1765: the run folder: only this user, SYSTEM and Administrators may change it or what is inside it', WINDOWS_ONLY, (t) => {
  if (!needsBuild(t) || !baselineOrSkip(t)) return;
  const cases = [
    ['Users may modify', [USERS + ':(OI)(CI)M'], /^UNSAFE .+ can change /],
    ['Everyone may write', [EVERYONE + ':(OI)(CI)W'], /^UNSAFE .+ can change /],
    ['Authenticated Users may modify the files inside only', [AUTH_USERS + ':(OI)(IO)M'], /^UNSAFE .+ can change /],
    ['Users may delete what is inside', [USERS + ':(DC)'], /^UNSAFE .+ can change /],
    ['Users may change its permissions', [USERS + ':(WDAC)'], /^UNSAFE .+ can change /],
    ['Users may read and run it', [USERS + ':(OI)(CI)RX'], /^SAFE$/],
  ];
  for (const [label, grant, expected] of cases) {
    const f = sandboxFolder('run');
    lockDown(f);
    icacls(f, '/grant', ...grant);
    const answer = probe(f, NOT_MY_PROFILE);
    assert.match(answer, expected, label + ': ' + answer);
    if (expected.source !== '^SAFE$') assert.ok(answer.includes(f), label + ': the reason does not name the folder: ' + answer);
  }
  // A deny is never counted against the folder, and a locked-down one is safe.
  const denied = sandboxFolder('run');
  lockDown(denied);
  icacls(denied, '/deny', USERS + ':(OI)(CI)M');
  assert.equal(probe(denied, NOT_MY_PROFILE), 'SAFE');
});

test('#1765: a folder above it counts only for what would let someone swap the branch below', WINDOWS_ONLY, (t) => {
  if (!needsBuild(t) || !baselineOrSkip(t)) return;
  // The parent lets Users delete what is in it: the locked run folder can be renamed away and replaced.
  const run = sandboxFolder('run');
  const parent = path.dirname(run);
  lockDown(run);
  lockDown(parent);
  icacls(parent, '/grant', USERS + ':(DC)');
  let answer = probe(run, NOT_MY_PROFILE);
  assert.match(answer, /^UNSAFE .+ can change /);
  assert.ok(answer.includes(parent) && !answer.includes(run), 'the reason does not name the parent: ' + answer);
  // The parent passes Modify down only (inherit-only), which the run folder does not take: safe.
  const run2 = sandboxFolder('run');
  const parent2 = path.dirname(run2);
  lockDown(parent2);
  icacls(parent2, '/grant', USERS + ':(OI)(CI)(IO)M');
  lockDown(run2);
  assert.equal(probe(run2, NOT_MY_PROFILE), 'SAFE');
  // The parent lets Users add files (a sibling folder is no threat to this one): safe.
  const run3 = sandboxFolder('run');
  lockDown(path.dirname(run3));
  icacls(path.dirname(run3), '/grant', USERS + ':(WD,AD)');
  lockDown(run3);
  assert.equal(probe(run3, NOT_MY_PROFILE), 'SAFE');
});

test('#1765: the code inside is read on its own, whatever the run folder says', WINDOWS_ONLY, (t) => {
  if (!needsBuild(t) || !baselineOrSkip(t)) return;
  const build = () => {
    const f = sandboxFolder('run');
    lockDown(f);
    fs.mkdirSync(path.join(f, 'runtime'));
    fs.writeFileSync(path.join(f, 'runtime', 'node.exe'), '');
    fs.mkdirSync(path.join(f, 'app'));
    fs.writeFileSync(path.join(f, 'app', 'server.js'), '');
    return f;
  };
  const clean = build();
  assert.equal(probe(clean, NOT_MY_PROFILE), 'SAFE', 'a locked build with its code inside was refused');
  // node.exe given to Users on its own (as a file made there while the folder let them would be theirs to give).
  const file = build();
  icacls(path.join(file, 'runtime', 'node.exe'), '/grant', USERS + ':(M)');
  let answer = probe(file, NOT_MY_PROFILE);
  assert.match(answer, /^UNSAFE .+ can change /);
  assert.ok(answer.includes(path.join(file, 'runtime', 'node.exe')), 'the reason does not name node.exe: ' + answer);
  // app\ cut off from the folder's entries, with its own for Users.
  const app = build();
  icacls(path.join(app, 'app'), '/inheritance:r', '/grant:r', '*' + mySid + ':(OI)(CI)F', USERS + ':(OI)(CI)M');
  answer = probe(app, NOT_MY_PROFILE);
  assert.match(answer, /^UNSAFE .+ can change /);
  assert.ok(answer.includes(path.join(app, 'app')), 'the reason does not name app: ' + answer);
  // A file below the six is taken at the folder's word (the plan's named weak spot), so this stays safe.
  const deep = build();
  fs.writeFileSync(path.join(deep, 'app', 'other.js'), '');
  icacls(path.join(deep, 'app', 'other.js'), '/grant', USERS + ':(M)');
  assert.equal(probe(deep, NOT_MY_PROFILE), 'SAFE');
});

test('#1765: a folder inside this person\'s profile is not read; a missing folder is refused', WINDOWS_ONLY, (t) => {
  if (!needsBuild(t)) return;
  const profile = fs.realpathSync.native(os.homedir());
  const f = sandboxFolder('run');
  if (!f.toLowerCase().startsWith(profile.toLowerCase() + '\\')) { t.skip('this machine\'s temp folder is not inside the profile: ' + f); return; }
  icacls(f, '/grant', USERS + ':(OI)(CI)M');
  assert.equal(probe(f), 'SAFE', 'a folder inside the profile was read');
  assert.match(probe(path.join(path.dirname(f), 'gone'), NOT_MY_PROFILE), /^UNSAFE who can change .* could not be read/);
});

/* ---- Windows: the launcher, run from the root of the system drive ------------ */

// A real-looking build: the launcher, a node.exe, and an app\server.js that only leaves a mark. No manifest, so the
// launcher does none of its installer duties, and no open-board.js, so it opens no window.
function sweepDriveRoot(drive) {
  let names = [];
  try { names = fs.readdirSync(drive); } catch { return; }
  for (const n of names) {
    if (!/^kosmos-acl-test-(open|locked)-[0-9a-f]{8}$/.test(n)) continue;
    const f = path.join(drive, n);
    try { if (Date.now() - fs.statSync(f).mtimeMs > 60 * 60 * 1000) fs.rmSync(f, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* another account's, or in use */ }
  }
}
function stubBuild(t, label) {
  const drive = (process.env.SystemDrive || 'C:') + '\\';
  sweepDriveRoot(drive);
  const folder = path.join(drive, 'kosmos-acl-test-' + label + '-' + crypto.randomBytes(4).toString('hex'));
  try { fs.mkdirSync(folder); } catch (e) { t.skip('cannot make a folder at ' + drive + ' (' + e.code + ')'); return null; }
  made.push(folder);
  fs.copyFileSync(launcherExe, path.join(folder, 'Kosmos.exe'));
  fs.mkdirSync(path.join(folder, 'runtime'));
  fs.copyFileSync(process.execPath, path.join(folder, 'runtime', 'node.exe'));
  fs.mkdirSync(path.join(folder, 'app'));
  fs.writeFileSync(path.join(folder, 'app', 'server.js'), "require('fs').writeFileSync(require('path').join(__dirname, '..', 'ran.txt'), 'ran');\n");
  return folder;
}
function runLauncher(folder, args) {
  const env = { ...process.env, PORT: '1' };
  const r = spawnSync(path.join(folder, 'Kosmos.exe'), [...args, '--console'], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, windowsHide: true, encoding: 'utf8' });
  assert.equal(r.error, undefined, 'Kosmos.exe did not run: ' + (r.error && r.error.message));
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('#1765: from a folder at the drive root that Users can change, Kosmos.exe refuses in words and runs nothing from it', WINDOWS_ONLY, (t) => {
  if (!needsBuild(t)) return;
  const folder = stubBuild(t, 'open');
  if (!folder) return;
  lockDown(folder);
  icacls(folder, '/grant', USERS + ':(OI)(CI)M');
  const r = runLauncher(folder, []);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Kosmos will not start from .*kosmos-acl-test-open-[0-9a-f]+, because other people who use this computer may be able to change the files in that folder/);
  assert.match(r.out, /Details: .+ can change /);
  assert.ok(!fs.existsSync(path.join(folder, 'ran.txt')), 'the folder\'s server.js ran');
  const u = runLauncher(folder, ['--uninstall']);
  assert.equal(u.code, 1, u.out);
  assert.match(u.out, /Kosmos will not run its uninstall from /);
  assert.ok(!fs.existsSync(path.join(folder, 'ran.txt')), 'the uninstall ran something from the folder');
});

test('#1765: from a locked-down folder at the drive root, Kosmos.exe starts what is in it', WINDOWS_ONLY, (t) => {
  if (!needsBuild(t)) return;
  const folder = stubBuild(t, 'locked');
  if (!folder) return;
  lockDown(folder);
  const r = runLauncher(folder, []);
  assert.doesNotMatch(r.out, /will not start from/, 'a locked-down folder was refused: ' + r.out);
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.readFileSync(path.join(folder, 'ran.txt'), 'utf8'), 'ran', 'the folder\'s server.js did not run');
});

test.after(() => {
  for (const f of made) fs.rmSync(f, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  if (buildDir) fs.rmSync(buildDir, { recursive: true, force: true });
});
