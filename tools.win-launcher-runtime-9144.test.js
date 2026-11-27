'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * #9144: a Windows runtime that crashes on every run is found before anything runs it, said plainly, and repaired.
 *
 *   node --test tools.win-launcher-runtime-9144.test.js
 *
 * Measured on the Windows box 11-26 (Homer): <LOCALAPPDATA>\Kosmos\runtime\node.exe, the ANCHORED copy the logon
 * task's board and every agent run, died on every run (exit 139 in bash) while a byte-identical COPY ran clean, and a
 * fresh copy over it fixed it. The launcher said "try again", which fails the same way, and the logon task's board died
 * after the hand-off where nobody saw it.
 *
 * Two halves, as tools.win-launcher-stuck-board-4543.test.js does it:
 *   - the SOURCE, for the wiring (where Main checks, both copies, what counts as damaged, the repair's order, the look
 *     after a hand-off, the Yes default, the anchored path's rule, the manifest key the build writes, C# 5 only);
 *   - a PROBE compiled beside KosmosLauncher.cs (Windows only), which runs the real RepairRuntime against a fake runtime
 *     that "crashes" (exit 139) when its FILE ID is on a list: a copy is a new file with a new ID, a rename keeps it.
 *     (Keyed on the ID, not a time: NTFS tunnelling gives a file renamed into a just-vacated name the old CREATION time.)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const REPO = __dirname;
const LAUNCHER = path.join(REPO, 'tools', 'windows', 'KosmosLauncher.cs');
const SOURCE = fs.readFileSync(LAUNCHER, 'utf8');
const BUILD = fs.readFileSync(path.join(REPO, 'tools', 'build-kosmos-windows.sh'), 'utf8');
const ANCHOR = fs.readFileSync(path.join(REPO, 'engine', 'win32anchor.js'), 'utf8');
const WINDOWS_ONLY = { skip: process.platform !== 'win32' && 'the probe needs the Windows C# compiler and Windows processes' };

function slice(start, end) {
  const at = SOURCE.indexOf(start);
  assert.notEqual(at, -1, start + ' is gone from KosmosLauncher.cs');
  const to = SOURCE.indexOf(end, at + start.length);
  assert.notEqual(to, -1, 'the end of ' + start + ' is gone');
  return SOURCE.slice(at, to);
}
function method(signature) { return slice(signature, '\n    }\n'); }

/* ---- the source ------------------------------------------------------------ */

test('#9144: Main checks the runtimes after the file checks and the window errand, and before the installer duties and the board', () => {
  const main = method('static int Main(string[] args)');
  const exists = main.indexOf('if (!File.Exists(server)) return Fail(');
  const window = main.indexOf('if (wantsWindow) return RunBoardWindow(');
  const repair = main.indexOf('if (wantsRepair) return RepairRuntimeFromConsole(here);');
  const check = main.indexOf('int? endedByRuntimeCheck = CheckRuntimesBeforeStarting(here, node);');
  const duties = main.indexOf('int? endedByInstallerDuties = RunInstallerDuties(here, node, port);');
  const board = main.indexOf('p = Process.Start(s);');
  for (const [n, v] of Object.entries({ exists, window, repair, check, duties, board })) assert.ok(v > 0, n + ' moved');
  assert.ok(exists < window && window < repair && repair < check, 'the check is not after the file checks and the window errand');
  assert.ok(check < duties && check < board, 'something runs the runtime before it is checked');
  assert.match(main.slice(check), /^int\? endedByRuntimeCheck = CheckRuntimesBeforeStarting\(here, node\);\n\s+if \(endedByRuntimeCheck\.HasValue\) return endedByRuntimeCheck\.Value;/);
});

test('#9144: BOTH copies are checked: this folder\'s, then the logon task\'s anchored one, repaired from this folder\'s', () => {
  const check = method('static int? CheckRuntimesBeforeStarting(string here, string node)');
  const own = check.indexOf('RuntimeCheck own = CheckRuntime(node);');
  const anchored = check.indexOf('RuntimeCheck task = CheckRuntime(anchored);');
  assert.ok(own > -1 && anchored > own, 'the anchored copy is not checked after this folder\'s');
  assert.match(check, /RepairRuntime\(node, anchored, ExpectedRuntimeSha256\(here\)\)/, 'the anchored copy is not repaired from this folder\'s');
  assert.match(check, /RepairRuntime\(node, node, ExpectedRuntimeSha256\(here\)\)/);
  assert.match(method('static void LookAfterHandOff(string here, string node, int port)'), /RuntimeCheck task = CheckRuntime\(anchored\);/, 'the look after a hand-off does not check the copy the logon task runs');
});

test('#9144: the anchored path follows engine/win32anchor.js anchorDir\'s rule', () => {
  const p = method('internal static string AnchoredRuntimePath()');
  /* The C# branches, in order. */
  const data = p.indexOf('if (!string.IsNullOrEmpty(data)) baseDir = Path.Combine(data, InstallFolderName);');
  const home = p.indexOf('else if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("AGENT_WORKFORCE_HOME")))');
  const local = p.indexOf('else baseDir = Path.Combine(LocalAppDataFolder(), InstallFolderName);');
  assert.ok(data > -1 && home > data && local > home, 'the anchored path\'s branches moved: ' + [data, home, local]);
  assert.match(p, /return Path\.Combine\(baseDir, "runtime", "node\.exe"\);/);
  /* The JS rule they mirror, and the folder name. */
  assert.match(ANCHOR, /\} else if \(e\.AGENT_WORKFORCE_DATA\) \{\n\s+base = p\.join\(e\.AGENT_WORKFORCE_DATA, APP\);/);
  assert.match(ANCHOR, /base = e\.AGENT_WORKFORCE_HOME\n\s+\? p\.join\(home, 'AppData', 'Local', APP\)\n\s+: p\.join\(e\.LOCALAPPDATA \|\| p\.join\(home, 'AppData', 'Local'\), APP\);/);
  assert.match(ANCHOR, /const dir = p\.join\(base, 'runtime'\);/);
  assert.match(SOURCE, /const string InstallFolderName = "Kosmos";/);
  assert.match(fs.readFileSync(path.join(REPO, 'engine', 'store.js'), 'utf8'), /const APP = 'Kosmos';/);
});

test('#9144 review 2: the anchored copy is repaired only from the same version, and nothing runs during an update', () => {
  const check = method('static int? CheckRuntimesBeforeStarting(string here, string node)');
  assert.match(check, /^static int\? CheckRuntimesBeforeStarting\(string here, string node\)\n\s+\{\n(\s+\/\/[^\n]*\n)+\s+if \(UpdateUnderWayHere\(here\)\) return null;/, 'the check runs while an update swaps files');
  assert.match(check, /if \(!SameRuntimeVersion\(node, anchored\)\) return null;\n\s+RuntimeCheck task = CheckRuntime\(anchored\);/);
  assert.match(method('static void LookAfterHandOff(string here, string node, int port)'), /if \(!SameRuntimeVersion\(node, anchored\) \|\| UpdateUnderWayHere\(here\)\) return;/);
  assert.match(method('static int RepairRuntimeFromConsole(string here)'), /if \(target == anchored && !SameRuntimeVersion\(node, anchored\)\)/);
  assert.match(method('internal static bool SameRuntimeVersion(string node, string anchored)'), /return new FileInfo\(node\)\.Length == new FileInfo\(anchored\)\.Length;/);
  /* Console with nobody to ask: says so and goes on (fail open). */
  assert.match(check, /Console\.Error\.WriteLine\("If Kosmos does not start, run: Kosmos\.exe " \+ RepairRuntimeFlag\);\n\s+return null;/);
});

test('#9144 review 3: a fresh copy is stamped now, the anchored path cannot throw out of the launch, a failed repair goes on, and the update is asked again after a Yes', () => {
  const repair = method('internal static string RepairRuntime(string from, string target, string expectedSha256)');
  const copied = repair.indexOf('File.Copy(from, copy, true);');
  const stamped = repair.indexOf('File.SetLastWriteTimeUtc(copy, DateTime.UtcNow);');
  assert.ok(copied > -1 && stamped > copied && stamped < repair.indexOf('FileSha256Hex(copy)'), 'the copy keeps its source\'s time, so another launch\'s sweep can delete it mid-repair');
  const check = method('static int? CheckRuntimesBeforeStarting(string here, string node)');
  assert.match(check, /try \{ anchored = AnchoredRuntimePath\(\); \}\n\s+catch \{ return null; \}/, 'AnchoredRuntimePath can throw out of the launch');
  assert.match(check, /if \(problem != null\) \{ ShowMessageBox\(RepairFailedMessage\(problem\), true\); return null; \}/, 'a failed repair ends the launch');
  assert.equal((check.match(/if \(UpdateUnderWayHere\(here\)\) return null;/g) || []).length, 3, 'the update is not asked before the check and again after each Yes');
});

test('#9144: damaged means it RAN, finished, and did not end with 0; Windows refusing to start it is never repaired', () => {
  assert.match(SOURCE, /public bool LooksDamaged \{ get \{ return Started && Finished && ExitCode != 0; \} \}/);
  const check = method('static int? CheckRuntimesBeforeStarting(string here, string node)');
  assert.match(check, /if \(!AskRepair\(DamagedRuntimeQuestion\(own\.Words\)\)\) return null;/, 'a No does not let the launch go on');
  assert.match(check, /else if \(!own\.Finished \|\| !own\.Started\) return null;/, 'an unfinished or refused check does not let the launch go on');
  assert.match(check, /if \(!task\.LooksDamaged\) return null;/);
  const run = method('internal static RuntimeCheck CheckRuntime(string nodePath)');
  assert.match(run, /new ProcessStartInfo\(nodePath, "-e 0"\)/);
  assert.match(run, /catch \(Exception e\) \{ r\.StartError = e\.Message; return r; \}/, 'Windows\' reason for refusing to start it is dropped');
  assert.match(run, /if \(!q\.WaitForExit\(RuntimeCheckTimeoutMs\)\)/, 'the check has no time limit');
  assert.match(run, /SetErrorMode\(SEM_FAILCRITICALERRORS \| SEM_NOGPFAULTERRORBOX\)/, 'a crash can put up a dialog that holds the check');
});

test('#9144: the repair makes a NEW file, checks it, and only then swaps it in, keeping one old copy', () => {
  const repair = method('internal static string RepairRuntime(string from, string target, string expectedSha256)');
  const order = [
    'File.Copy(from, copy, true);',
    'string got = FileSha256Hex(copy);',
    'RuntimeCheck fresh = CheckRuntime(copy);',
    'foreach (string old in Directory.GetFiles(dir, DamagedRuntimePrefix + "*")) TryDeleteFile(old);',
    'string why = MoveWithRetry(target, damaged);',
    'try { File.Move(copy, target); }',
    'RuntimeCheck after = CheckRuntime(target);',
  ].map((s) => { const at = repair.indexOf(s); assert.ok(at > -1, s + ' is gone from RepairRuntime'); return at; });
  for (let i = 1; i < order.length; i += 1) assert.ok(order[i - 1] < order[i], 'the repair steps are out of order at step ' + i);
  assert.match(repair, /if \(!fresh\.Finished \|\| fresh\.ExitCode != 0\)\n\s+\{\n\s+TryDeleteFile\(copy\);/, 'a fresh copy that does not run is kept, or a slow one is accepted');
  assert.match(repair, /Path\.Combine\(dir, RepairCopyPrefix \+ Process\.GetCurrentProcess\(\)\.Id \+ "\.exe"\)/, 'two launches repairing at once share one copy');
  assert.match(repair, /and the runtime is now missing: /, 'a failed swap that leaves no runtime does not say so');
  assert.doesNotMatch(repair, /File\.Delete\(target\)|File\.WriteAllBytes\(target/, 'the repair deletes or rewrites the old runtime instead of keeping it');
});

test('#9144: a file that does not match this version is sent to a download, not a restart', () => {
  const m = method('internal static string RepairFailedMessage(string problem)');
  assert.match(m, /"does not match this version's"/);
  assert.match(m, /\(fileIsWrong \? DownloadAdvice : RestartAdvice\)/);
  assert.match(method('internal static string RepairRuntime(string from, string target, string expectedSha256)'), /"its file does not match this version's \(sha256 "/, 'the words RepairFailedMessage keys on moved');
});

test('#9144: after a hand-off (and only then), a quiet port AND a failing logon-task runtime offer Repair; a healthy runtime says nothing', () => {
  const main = method('static int Main(string[] args)');
  assert.match(main, /if \(provablyServingHere\) \{ servedHere = true; stoppedByPerson = KeepBoardUntilPersonStopsIt\(p\); break; \}/);
  assert.match(main, /if \(p\.ExitCode == 0 && !servedHere && !stoppedByPerson && showMessageBoxes\) LookAfterHandOff\(here, node, port\);\n\s+return p\.ExitCode;/);
  const look = method('static void LookAfterHandOff(string here, string node, int port)');
  assert.match(look, /if \(listening == null \|\| listening\.Count > 0\) return;/, 'an unreadable table or a listening board is not left alone');
  assert.match(look, /if \(!task\.LooksDamaged\) return;/, 'a slow but healthy board gets a question');
  assert.ok(look.indexOf('while (waited.ElapsedMilliseconds < AfterHandOffLookMs)') < look.indexOf('CheckRuntime(anchored)'), 'the runtime is checked before the board was given its time');
  const ms = Number((/internal const int AfterHandOffLookMs = (\d+);/.exec(SOURCE) || [])[1]);
  const serving = Number((/const int CheckForServingAfterMs = (\d+);/.exec(SOURCE) || [])[1]);
  assert.ok(ms >= 60000 && ms > serving, 'the look comes before a slow first boot could be listening (' + ms + ' ms)');
});

test('#9144: Repair is the default answer; the removal questions keep No as theirs', () => {
  assert.match(method('static bool AskRepair(string question)'), /MessageBoxDefaultButton\.Button1\) == System\.Windows\.Forms\.DialogResult\.Yes/);
  assert.match(method('static bool AskYesNo(string question)'), /MessageBoxDefaultButton\.Button2/, 'AskYesNo lost its No default');
});

test('#9144: the manifest key the launcher reads is the one the build writes, from the STAGED runtime file', () => {
  const key = (/internal const string RuntimeShaManifestKey = "([a-z_0-9]+)";/.exec(SOURCE) || [])[1];
  assert.ok(key, 'the launcher no longer names its manifest key');
  const manifestAt = BUILD.indexOf('cat > "$STAGE/manifest.json" <<JSON');
  const manifest = BUILD.slice(manifestAt, BUILD.indexOf('\nJSON\n', manifestAt));
  assert.match(manifest, new RegExp('\\n  "' + key + '": "\\$_node_exe_sha",\\n'), 'the build does not write the key at the top level');
  assert.match(BUILD, /_node_exe_sha="\$\(shasum -a 256 "\$STAGE\/runtime\/node\.exe" \| awk '\{print \$1\}'\)"/, 'the sha256 is not the staged file\'s');
  assert.ok(BUILD.indexOf('_node_exe_sha="$(shasum') < manifestAt, 'the sha256 is taken after the manifest is written');
});

test('#9144: the launcher stays C# 5 (the in-box .NET Framework compiler verify-launcher.ps1 pins)', () => {
  const code = SOURCE.replace(/\/\/[^\n]*/g, '');
  const c6 = (src) => /\$"|\?\.[A-Za-z]|\bnameof\(/.test(src);
  assert.equal(c6(code), false, 'a C# 6 construct crept into KosmosLauncher.cs');
  assert.equal(c6('string x = $"a {b}";'), true, 'CONTROL: an interpolated string is seen');
  assert.equal(c6('int n = a?.Length ?? 0;'), true, 'CONTROL: a null-conditional is seen');
});

/* ---- the probe (Windows only) ----------------------------------------------- */

/* A fake runtime: exit 139 when this file's ID (volume serial and file index) is listed in crash-ids.txt beside it, or
   when the list says ALWAYS; else 0. A copy is a new file with a new ID; a rename keeps the ID. */
const FILE_ID = `
  [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential, Pack = 4)]
  struct BHFI { public uint attr; public uint c1, c2, a1, a2, w1, w2; public uint vol, sizeHi, sizeLo, links, idxHi, idxLo; }
  [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetFileInformationByHandle(Microsoft.Win32.SafeHandles.SafeFileHandle h, out BHFI info);
  internal static string FileId(string path) {
    using (System.IO.FileStream f = new System.IO.FileStream(path, System.IO.FileMode.Open, System.IO.FileAccess.Read, System.IO.FileShare.ReadWrite | System.IO.FileShare.Delete)) {
      BHFI i; if (!GetFileInformationByHandle(f.SafeFileHandle, out i)) return "?";
      return i.vol.ToString("x8") + ":" + i.idxHi.ToString("x8") + i.idxLo.ToString("x8");
    }
  }`;
const FAKE_NODE = `
using System; using System.IO;
class FakeNode {
${FILE_ID}
  static int Main(string[] a) {
    string me = System.Reflection.Assembly.GetEntryAssembly().Location;
    string list = Path.Combine(Path.GetDirectoryName(me), "crash-ids.txt");
    if (!File.Exists(list)) return 0;
    string all = File.ReadAllText(list);
    if (all.Contains("ALWAYS")) return 139;
    return all.Contains(FileId(me)) ? 139 : 0;
  }
}`;
const PROBE = `
using System; using System.IO;
class RuntimeProbe {
${FILE_ID}
  static int Main(string[] a) {
    if (a[0] == "fileid") { Console.WriteLine(FileId(a[1])); return 0; }
    if (a[0] == "sameversion") { Console.WriteLine(KosmosLauncher.SameRuntimeVersion(a[1], a[2])); return 0; }
    if (a[0] == "check") {
      KosmosLauncher.RuntimeCheck c = KosmosLauncher.CheckRuntime(a[1]);
      Console.WriteLine(!c.Started ? "NOTSTARTED" : !c.Finished ? "UNFINISHED" : c.ExitCode.ToString());
      return 0;
    }
    string problem = KosmosLauncher.RepairRuntime(a[1], a[2], a[3] == "-" ? null : a[3]);
    Console.WriteLine(problem == null ? "REPAIRED" : "PROBLEM " + problem);
    return 0;
  }
}`;

function compile(csc, out, sources, main) {
  const r = spawnSync(csc, ['/nologo', '/target:exe', '/main:' + main, '/out:' + out, ...sources], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, 'compile failed: ' + r.stdout + r.stderr);
}

test('#9144 probe: RepairRuntime on a crashing runtime, a crashing anchored copy, a bad sha256, and a copy that crashes too', WINDOWS_ONLY, (t) => {
  const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(csc)) { t.skip('no .NET Framework compiler on this machine'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-9144-'));
  fs.writeFileSync(path.join(dir, 'FakeNode.cs'), FAKE_NODE);
  fs.writeFileSync(path.join(dir, 'RuntimeProbe.cs'), PROBE);
  const fake = path.join(dir, 'fake-node.exe');
  const probe = path.join(dir, 'probe.exe');
  compile(csc, fake, [path.join(dir, 'FakeNode.cs')], 'FakeNode');
  compile(csc, probe, [LAUNCHER, path.join(dir, 'RuntimeProbe.cs')], 'RuntimeProbe');
  const run = (...args) => (spawnSync(probe, args, { encoding: 'utf8', windowsHide: true, timeout: 120000 }).stdout || '').trim();
  const sha = crypto.createHash('sha256').update(fs.readFileSync(fake)).digest('hex');

  /* A folder holding runtime\node.exe (the fake); `crash` lists that very file's ID (or ALWAYS). */
  let n = 0;
  function runtimeDir(crash) {
    const root = path.join(dir, 'kit' + (n += 1));
    const rt = path.join(root, 'runtime');
    fs.mkdirSync(rt, { recursive: true });
    const node = path.join(rt, 'node.exe');
    fs.copyFileSync(fake, node);
    if (crash === 'always') fs.writeFileSync(path.join(rt, 'crash-ids.txt'), 'ALWAYS\n');
    else if (crash) fs.writeFileSync(path.join(rt, 'crash-ids.txt'), run('fileid', node) + '\n');
    return { root, rt, node };
  }
  const leftovers = (rt) => fs.readdirSync(rt).filter((f) => f.startsWith('node-repair-'));
  const kept = (rt) => fs.readdirSync(rt).filter((f) => f.startsWith('node.exe.damaged-'));

  /* A: this folder's runtime crashes, a fresh copy runs: repaired, one old kept, no copy left. */
  const a = runtimeDir(true);
  assert.equal(run('check', a.node), '139', 'CONTROL: the fake runtime crashes before the repair');
  assert.equal(run('repair', a.node, a.node, sha), 'REPAIRED');
  assert.equal(run('check', a.node), '0', 'node.exe still crashes after the repair');
  assert.equal(kept(a.rt).length, 1);
  assert.deepEqual(leftovers(a.rt), []);

  /* E: the ANCHORED copy crashes (the fault on the box); this folder's is healthy: repaired from it. */
  const install = runtimeDir(false);
  const anchored = runtimeDir(true);
  assert.equal(run('check', anchored.node), '139', 'CONTROL: the anchored copy crashes before the repair');
  assert.equal(run('repair', install.node, anchored.node, sha), 'REPAIRED');
  assert.equal(run('check', anchored.node), '0');
  assert.equal(kept(anchored.rt).length, 1);
  assert.equal(kept(install.rt).length, 0, 'the healthy source was touched');
  assert.equal(run('sameversion', install.node, anchored.node), 'True');
  /* Review 2: another version (another size) is never the anchored copy's source. */
  const other = runtimeDir(true);
  fs.appendFileSync(other.node, Buffer.alloc(16));
  assert.equal(run('sameversion', install.node, other.node), 'False', 'a different-size anchored copy would be overwritten (a downgrade)');

  /* B: the manifest names another sha256: refused, nothing swapped, no copy left. */
  const b = runtimeDir(true);
  assert.match(run('repair', b.node, b.node, '0'.repeat(64)), /^PROBLEM its file does not match this version's/);
  assert.equal(run('check', b.node), '139', 'the old runtime was swapped out on a sha256 mismatch');
  assert.deepEqual([...leftovers(b.rt), ...kept(b.rt)], []);

  /* C: a fresh copy crashes too: refused, the old left in place. */
  const c = runtimeDir('always');
  assert.match(run('repair', c.node, c.node, sha), /^PROBLEM a fresh copy of it does not run either/);
  assert.ok(fs.existsSync(c.node));
  assert.deepEqual([...leftovers(c.rt), ...kept(c.rt)], []);

  /* D: an older build with no manifest key: repaired on the run check alone; a second repair keeps ONE old copy. */
  const d = runtimeDir(true);
  assert.equal(run('repair', d.node, d.node, '-'), 'REPAIRED');
  fs.writeFileSync(path.join(d.rt, 'crash-ids.txt'), run('fileid', d.node) + '\n');
  assert.equal(run('repair', d.node, d.node, '-'), 'REPAIRED');
  assert.equal(kept(d.rt).length, 1, 'old copies pile up: ' + kept(d.rt));
});
