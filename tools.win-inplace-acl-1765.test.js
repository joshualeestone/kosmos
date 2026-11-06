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

test('#1765: --check-run-folder is answered before anything else in Main, the console included, and does nothing else', () => {
  /* The board reads this answer from a pipe (engine/win32runfolder.js): no box, no console, no errand may come first. */
  const main = slice('static int Main(string[] args)', '\n    }\n');
  const flag = main.indexOf('CheckRunFolderFlag');
  assert.ok(flag !== -1, 'Main no longer answers --check-run-folder');
  for (const later of ['ConnectToAConsole()', 'string unsafeFolder = UnsafeRunFolderReason(here);', 'if (wantsUninstall) return Uninstall(here, node);']) {
    const at = main.indexOf(later);
    assert.ok(at !== -1 && at > flag, later + ' comes before the --check-run-folder answer');
  }
  const branch = main.slice(flag, main.indexOf('bool wantsConsole'));
  assert.match(branch, /Console\.Out\.Write\(RunFolderAnswer\(Here\(\)\)\);[\s\S]*return 0;/);
  assert.doesNotMatch(branch, /Process\.Start|ShowMessageBox|RunInstallerDuties/, 'the answer does more than answer');
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
  assert.match(other, /catch \(Exception e\) \{ return Unreadable\("who can change "/);
  assert.match(other, /if \(acl == null \|\| !hasDacl\) return "anyone can change "/);
});

test('#1765: the refusal is plain, says what to do, and carries no em dash', () => {
  const message = slice('internal static string UnsafeFolderMessage(', '\n    }\n');
  assert.match(message, /other people who use this computer may be able to change the files in that folder/);
  assert.match(message, /Download Kosmos again, extract it into " \+ downloads \+ ", and open Kosmos\.exe from there/);
  // The folder named is one inside the profile that exists (FreshCopyFolder; real folders below).
  assert.match(message, /string downloads = FreshCopyFolder\(profile\);/);
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
function probe(folder, profile, asSid) {
  const args = profile === undefined ? [folder] : (asSid ? [folder, profile, asSid] : [folder, profile]);
  const r = spawnSync(probeExe, args, { encoding: 'utf8', windowsHide: true, timeout: 30000 });
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
    if (a[0] == "--fresh") {
      string d = a[2], k = a[3];
      KosmosLauncher.downloadsFolder = () => d;
      KosmosLauncher.desktopFolder = () => k;
      Console.Write(KosmosLauncher.FreshCopyFolder(a[1]));
      return 0;
    }
    if (a[0] == "--answer") {
      string pr = a[2];
      KosmosLauncher.userProfileFolder = () => pr;
      Console.Write(KosmosLauncher.RunFolderAnswer(a[1]));
      return 0;
    }
    if (a.Length > 2) { var other = new System.Security.Principal.SecurityIdentifier(a[2]); KosmosLauncher.currentUser = () => other; }
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

test('#1765: the run folder: only this user, SYSTEM, Administrators and TrustedInstaller may change it or what is inside it', WINDOWS_ONLY, (t) => {
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
  // Write data and add folder only: a deny of Modify or W also denies reading (W carries Synchronize), and a folder
  // this account cannot list is refused.
  icacls(denied, '/deny', USERS + ':(OI)(CI)(WD,AD)');
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
    fs.writeFileSync(path.join(f, 'runtime', 'WebView2Loader.dll'), '');
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
  // Review 2 (v2): any file beside node.exe in runtime\, not only the named ones.
  const beside = build();
  fs.writeFileSync(path.join(beside, 'runtime', 'planted.dll'), '');
  icacls(path.join(beside, 'runtime', 'planted.dll'), '/grant', USERS + ':(M)');
  answer = probe(beside, NOT_MY_PROFILE);
  assert.match(answer, /^UNSAFE .+ can change /);
  assert.ok(answer.includes(path.join(beside, 'runtime', 'planted.dll')), 'the reason does not name the planted dll: ' + answer);
  // Review 1 (v2): the WebView2 loader the window loads into the launcher, given to Users on its own.
  const dll = build();
  icacls(path.join(dll, 'runtime', 'WebView2Loader.dll'), '/grant', USERS + ':(M)');
  answer = probe(dll, NOT_MY_PROFILE);
  assert.match(answer, /^UNSAFE .+ can change /);
  assert.ok(answer.includes(path.join(dll, 'runtime', 'WebView2Loader.dll')), 'the reason does not name WebView2Loader.dll: ' + answer);
  // app\ cut off from the folder's entries, with its own for Users.
  const app = build();
  icacls(path.join(app, 'app'), '/inheritance:r', '/grant:r', '*' + mySid + ':(OI)(CI)F', USERS + ':(OI)(CI)M');
  answer = probe(app, NOT_MY_PROFILE);
  assert.match(answer, /^UNSAFE .+ can change /);
  assert.ok(answer.includes(path.join(app, 'app')), 'the reason does not name app: ' + answer);
  // Any file at any depth is read on its own: one under app\ given to Users is refused.
  const deep = build();
  fs.mkdirSync(path.join(deep, 'app', 'engine'));
  fs.writeFileSync(path.join(deep, 'app', 'engine', 'other.js'), '');
  icacls(path.join(deep, 'app', 'engine', 'other.js'), '/grant', USERS + ':(M)');
  answer = probe(deep, NOT_MY_PROFILE);
  assert.match(answer, /^UNSAFE .+ can change /);
  assert.ok(answer.includes(path.join(deep, 'app', 'engine', 'other.js')), 'the reason does not name the deep file: ' + answer);
  // Review 5 (v2): bin\, first on every agent's PATH, stopped inheriting and lets Users change it.
  const bin = build();
  fs.mkdirSync(path.join(bin, 'bin'));
  icacls(path.join(bin, 'bin'), '/inheritance:r', '/grant:r', '*' + mySid + ':(OI)(CI)F', USERS + ':(OI)(CI)M');
  answer = probe(bin, NOT_MY_PROFILE);
  assert.match(answer, /^UNSAFE .+ can change /);
  assert.ok(answer.includes(path.join(bin, 'bin')), 'the reason does not name bin: ' + answer);
  // A file in bin\ given to Users on its own.
  const binFile = build();
  fs.mkdirSync(path.join(binFile, 'bin'));
  fs.writeFileSync(path.join(binFile, 'bin', 'kosmos.ps1'), '');
  icacls(path.join(binFile, 'bin', 'kosmos.ps1'), '/grant', USERS + ':(M)');
  answer = probe(binFile, NOT_MY_PROFILE);
  assert.ok(answer.includes(path.join(binFile, 'bin', 'kosmos.ps1')), 'the reason does not name the file in bin: ' + answer);
  // A junction inside is refused, never followed.
  const linked = build();
  const target = sandboxFolder('elsewhere');
  const mk = spawnSync(path.join(SYSROOT, 'System32', 'cmd.exe'), ['/d', '/c', 'mklink', '/J', path.join(linked, 'app', 'linked'), target], { encoding: 'utf8', windowsHide: true });
  assert.equal(mk.status, 0, 'mklink /J failed: ' + mk.stdout + mk.stderr);
  answer = probe(linked, NOT_MY_PROFILE);
  assert.match(answer, /is a link to another place/, 'a junction inside was not refused: ' + answer);
  // Review 4 (v2): but a folder under app\ that stopped inheriting and lets Users change it is read on its own.
  const sub = build();
  const lib = path.join(sub, 'app', 'node_modules', 'lib');
  fs.mkdirSync(lib, { recursive: true });
  icacls(lib, '/inheritance:r', '/grant:r', '*' + mySid + ':(OI)(CI)F', USERS + ':(OI)(CI)M');
  answer = probe(sub, NOT_MY_PROFILE);
  assert.match(answer, /^UNSAFE .+ can change /);
  assert.ok(answer.includes(lib), 'the reason does not name the folder under app: ' + answer);
});

test('#1765: a folder inside this person\'s profile is not read; a missing folder is refused', WINDOWS_ONLY, (t) => {
  if (!needsBuild(t)) return;
  const profile = fs.realpathSync.native(os.homedir());
  const f = sandboxFolder('run');
  if (!f.toLowerCase().startsWith(profile.toLowerCase() + '\\')) { t.skip('this machine\'s temp folder is not inside the profile: ' + f); return; }
  icacls(f, '/grant', USERS + ':(OI)(CI)M');
  assert.equal(probe(f), 'SAFE', 'a folder inside the profile was read');
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

test('#1765: the refusal names a folder inside the profile that is really there', WINDOWS_ONLY, (t) => {
  if (!needsBuild(t)) return;
  /* Review 2 (v2): Explorer can move Downloads to another drive, where a fresh copy would be refused too, and the
     profile's own Downloads may then not exist. */
  // The long form: a CI image's TEMP can be an 8.3 short name (RUNNER~1), and Windows answers in the long one.
  const profile = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-acl-profile-')));
  made.push(profile);
  const fresh = (downloads, desktop) => {
    const r = spawnSync(probeExe, ['--fresh', profile, downloads, desktop], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(r.status, 0, 'the probe failed: ' + r.stdout + r.stderr);
    return r.stdout.trim();
  };
  const moved = 'Z:\\Downloads';
  const desk = path.join(profile, 'Desktop');
  // Nothing inside the profile exists yet: the user folder itself.
  assert.equal(fresh(moved, desk), profile);
  fs.mkdirSync(desk);
  // Downloads moved away, no profile Downloads: the Desktop.
  assert.equal(fresh(moved, desk), desk);
  fs.mkdirSync(path.join(profile, 'Downloads'));
  // The profile's own Downloads, when it is there.
  assert.equal(fresh(moved, desk), path.join(profile, 'Downloads'));
  // The real Downloads, when it is inside the profile.
  const real = path.join(profile, 'Stuff', 'Dl');
  fs.mkdirSync(real, { recursive: true });
  assert.equal(fresh(real, desk), real);
});

test('#1765: a folder owned by anyone but the four is refused, whatever its entries say', WINDOWS_ONLY, (t) => {
  if (!needsBuild(t)) return;
  /* Review 3 (v2): the owner rule is the defence for a file another account made while the folder let them. Read a
     folder this account owns and locked down as if another account were running: its owner is then not one of the
     four, so it must be refused as owned, before any entry is weighed. */
  const f = sandboxFolder('owned');
  lockDown(f);
  // Owned by this account itself: an elevated runner (CI) makes what it creates owned by Administrators, who are
  // trusted, and the owner rule would never be asked.
  icacls(f, '/setowner', '*' + mySid);
  assert.equal(probe(f, NOT_MY_PROFILE), 'SAFE', 'a locked folder of this account was refused');
  const someoneElse = 'S-1-5-21-1111111111-2222222222-3333333333-1002';
  const answer = probe(f, NOT_MY_PROFILE, someoneElse);
  assert.match(answer, /^UNSAFE .+ owns /, 'an untrusted owner was not refused as the owner: ' + answer);
  assert.ok(answer.includes(f), 'the reason does not name the folder: ' + answer);
});

test('#1765: a folder on a network share is refused before anything is read', WINDOWS_ONLY, (t) => {
  if (!needsBuild(t)) return;
  /* Review 5 (v2): the well-known accounts in a share's permissions are the file server's. */
  assert.match(probe('\\\\fileserver\\apps\\Kosmos', NOT_MY_PROFILE), /^UNSAFE .+ is on another computer \(a network share\)/);
});

test('#1765: a run folder that is not there is refused', WINDOWS_ONLY, (t) => {
  if (!needsBuild(t)) return;
  const f = sandboxFolder('run');
  assert.match(probe(path.join(path.dirname(f), 'gone'), NOT_MY_PROFILE), /^UNSAFE who can change .* could not be read/);
});

test('#1765: a drive root that lets others delete it does not refuse a locked folder on that drive', WINDOWS_ONLY, (t) => {
  if (!needsBuild(t)) return;
  /* A drive's root cannot be renamed or deleted, so DELETE on it changes nothing below. subst (no administrator
     needed) makes a sandbox folder a drive root to read. Delete-child on the root still counts. */
  const used = new Set(spawnSync(path.join(SYSROOT, 'System32', 'cmd.exe'), ['/d', '/c', 'subst'], { encoding: 'utf8', windowsHide: true }).stdout.split(/\r?\n/).map((l) => l.slice(0, 1).toUpperCase()));
  const letter = 'QRSTUVWXYZ'.split('').find((l) => !used.has(l) && !fs.existsSync(l + ':\\'));
  if (!letter) { t.skip('no free drive letter for subst'); return; }
  const rootFolder = sandboxFolder('driveroot');
  lockDown(rootFolder);
  fs.mkdirSync(path.join(rootFolder, 'kos'));
  lockDown(path.join(rootFolder, 'kos'));
  const subst = (...a) => spawnSync(path.join(SYSROOT, 'System32', 'subst.exe'), a, { encoding: 'utf8', windowsHide: true });
  const made2 = subst(letter + ':', rootFolder);
  assert.equal(made2.status, 0, 'subst failed: ' + made2.stdout + made2.stderr);
  try {
    icacls(rootFolder, '/grant', USERS + ':(D)');
    assert.equal(probe(letter + ':\\kos', NOT_MY_PROFILE), 'SAFE', 'DELETE on the drive root refused a locked folder');
    icacls(rootFolder, '/grant', USERS + ':(DC)');
    assert.match(probe(letter + ':\\kos', NOT_MY_PROFILE), /^UNSAFE .+ can change /, 'delete-child on the drive root was not counted');
  } finally {
    subst(letter + ':', '/D');
  }
});

test('#1765: a run folder that is a link, or sits behind one, is refused', WINDOWS_ONLY, (t) => {
  if (!needsBuild(t)) return;
  /* Its permissions would be read at the target, never on the link, and whoever may delete the link can put their
     own folder at the same path. */
  const target = sandboxFolder('target');
  lockDown(target);
  const junction = path.join(path.dirname(target), 'kos-link');
  const mk = spawnSync(path.join(SYSROOT, 'System32', 'cmd.exe'), ['/d', '/c', 'mklink', '/J', junction, target], { encoding: 'utf8', windowsHide: true });
  assert.equal(mk.status, 0, 'mklink /J failed: ' + mk.stdout + mk.stderr);
  assert.equal(probe(target, NOT_MY_PROFILE), 'SAFE', 'the locked target itself was refused');
  let answer = probe(junction, NOT_MY_PROFILE);
  assert.match(answer, /is a link to another place, and Kosmos does not run from behind one/, 'a run folder that is a junction was not refused: ' + answer);
  fs.mkdirSync(path.join(target, 'inner'));
  lockDown(path.join(target, 'inner'));
  answer = probe(path.join(junction, 'inner'), NOT_MY_PROFILE);
  assert.match(answer, /is a link to another place, and Kosmos does not run from behind one/, 'a run folder behind a junction was not refused: ' + answer);
  assert.ok(answer.includes(junction), 'the reason does not name the link: ' + answer);
  fs.rmdirSync(junction);
});

test('#1765: --check-run-folder answers one JSON line: safe in the profile, and the reason and the words for the board elsewhere', WINDOWS_ONLY, (t) => {
  if (!needsBuild(t)) return;
  // The built launcher itself, run as the board runs it, from a folder inside this profile (the temp folder).
  const here = sandboxFolder('answer');
  fs.copyFileSync(launcherExe, path.join(here, 'Kosmos.exe'));
  const r = spawnSync(path.join(here, 'Kosmos.exe'), ['--check-run-folder'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(r.status, 0, 'the launcher failed: ' + r.stdout + r.stderr);
  // The launcher's shape every time (review 2); safe when this machine's temp folder is inside the profile, as it is
  // by default, and said so when it is not.
  const real = JSON.parse(r.stdout);
  assert.equal(typeof real.safe, 'boolean', 'not the launcher\'s answer: ' + r.stdout);
  const profileHome = fs.realpathSync.native(os.homedir());
  if (here.toLowerCase().startsWith(profileHome.toLowerCase() + '\\')) {
    assert.deepEqual(real, { safe: true }, 'a folder inside the profile was not safe: ' + r.stdout);
  } else {
    t.diagnostic('this machine\'s temp folder is not inside the profile, so the safe answer was not checked here: ' + here);
  }
  assert.ok(!fs.existsSync(path.join(here, 'ran.txt')), 'the answer started something');
  // An unsafe folder (Users may change it), read as outside the profile: valid JSON with the reason and the words.
  const open = sandboxFolder('answer-open');
  icacls(open, '/grant', USERS + ':(OI)(CI)M');
  const p = spawnSync(probeExe, ['--answer', open, NOT_MY_PROFILE], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(p.status, 0, 'the probe failed: ' + p.stdout + p.stderr);
  const a = JSON.parse(p.stdout);
  assert.equal(a.safe, false);
  assert.equal(a.folder, open);
  assert.match(a.reason, / can change /);
  assert.ok(a.message.startsWith('Kosmos is running from ' + open + ', and other people who use this computer may be able to change'), a.message);
  // Not before the next sign-in: the old board and its agents run from that folder until then (review 1).
  assert.ok(a.message.endsWith('Once you have next signed in to Windows, you can delete ' + open + '.'), a.message);
  assert.equal(a.checked, undefined, 'a folder that was read is not marked unchecked');
  assert.doesNotMatch(a.message, /\u2014/, 'an em dash in the words');
  // A folder that cannot be read answers unchecked, with the reason and the softer words for the person.
  const gone = path.join(path.dirname(open), 'not-there');
  const u = JSON.parse(spawnSync(probeExe, ['--answer', gone, NOT_MY_PROFILE], { encoding: 'utf8', windowsHide: true, timeout: 30000 }).stdout);
  assert.equal(u.safe, false);
  assert.equal(u.checked, false);
  assert.match(u.reason, /could not be read/);
  assert.ok(u.message.startsWith('Kosmos is running from ' + gone + ', and it could not check whether other people who use this computer can change'), u.message);
  assert.equal(u.folder, gone);
  // A folder whose NAME says "could not be read" but that Users can change is unsafe, not unchecked: the launcher
  // flags an unreadable answer, it does not search the sentence (review 3).
  const named = sandboxFolder('could not be read');
  icacls(named, '/grant', USERS + ':(OI)(CI)M');
  const nm = JSON.parse(spawnSync(probeExe, ['--answer', named, NOT_MY_PROFILE], { encoding: 'utf8', windowsHide: true, timeout: 30000 }).stdout);
  assert.equal(nm.safe, false);
  assert.equal(nm.checked, undefined, 'a name that quotes the words turned "can change" into "unchecked": ' + JSON.stringify(nm));
  assert.match(nm.reason, / can change /);
  // A locked folder answers safe.
  const locked = sandboxFolder('answer-locked');
  lockDown(locked);
  assert.deepEqual(JSON.parse(spawnSync(probeExe, ['--answer', locked, NOT_MY_PROFILE], { encoding: 'utf8', windowsHide: true, timeout: 30000 }).stdout), { safe: true });
});
