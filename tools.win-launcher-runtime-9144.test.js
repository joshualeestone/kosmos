'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * #9144: a Windows runtime that crashes on every run is found before anything runs it, said plainly, and repaired.
 *
 *   node --test tools.win-launcher-runtime-9144.test.js
 *
 * Measured on the Windows box 11-26 (Homer): runtime\node.exe died on every run, even `node -e 1` (exit 139), while a
 * byte-identical COPY ran clean, and a fresh copy over it fixed it. The launcher said "try again", which fails the same
 * way, and the logon task's board died seconds after the hand-off where nobody saw it.
 *
 * Two halves, as tools.win-launcher-stuck-board-4543.test.js does it:
 *   - the SOURCE, for the wiring (where Main checks, that the check fails open, the repair's order, the look after a
 *     hand-off, the Yes default, the manifest key the build writes, C# 5 only);
 *   - a PROBE compiled beside KosmosLauncher.cs (Windows only), which runs the real RepairRuntime against a fake runtime
 *     that "crashes" (exit 139) when its FILE was created before a threshold, so the old file fails and a fresh copy,
 *     a new file, runs: the same shape as the fault.
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

test('#9144: Main checks the runtime after the file checks and the window errand, and before the installer duties and the board', () => {
  const main = method('static int Main(string[] args)');
  const exists = main.indexOf('if (!File.Exists(server)) return Fail(');
  const window = main.indexOf('if (wantsWindow) return RunBoardWindow(');
  const repair = main.indexOf('if (wantsRepair) return RepairRuntimeFromConsole(here);');
  const check = main.indexOf('int? endedByRuntimeCheck = CheckRuntimeBeforeStarting(here, node);');
  const duties = main.indexOf('int? endedByInstallerDuties = RunInstallerDuties(here, node, port);');
  const board = main.indexOf('p = Process.Start(s);');
  for (const [n, v] of Object.entries({ exists, window, repair, check, duties, board })) assert.ok(v > 0, n + ' moved');
  assert.ok(exists < window && window < repair && repair < check, 'the check is not after the file checks and the window errand');
  assert.ok(check < duties && check < board, 'something runs the runtime before it is checked');
  assert.match(main.slice(check), /^int\? endedByRuntimeCheck = CheckRuntimeBeforeStarting\(here, node\);\n\s+if \(endedByRuntimeCheck\.HasValue\) return endedByRuntimeCheck\.Value;/);
});

test('#9144: the check fails open: one that does not finish says nothing; one that will not start, or ends non-zero, is damaged', () => {
  const looks = method('internal static bool RuntimeLooksDamaged(int exitCode)');
  assert.match(looks, /return exitCode != 0 && exitCode != RuntimeCheckDidNotFinish;/);
  const check = method('static int? CheckRuntimeBeforeStarting(string here, string node)');
  assert.match(check, /if \(!RuntimeLooksDamaged\(code\)\) return null;/, 'a healthy or unfinished check does not let the launch go on');
  assert.match(check, /if \(problem == null\) return null;/, 'a repaired runtime does not let the launch go on');
  const run = method('internal static int RuntimeCheckExitCode(string nodePath)');
  assert.match(run, /new ProcessStartInfo\(nodePath, "-e 0"\)/);
  assert.match(run, /if \(!q\.WaitForExit\(RuntimeCheckTimeoutMs\)\)/, 'the check has no time limit');
  assert.match(run, /catch \{ return RuntimeCheckCouldNotStart; \}/, 'the check can throw');
});

test('#9144: the repair makes a NEW file, checks it, and only then swaps it in, keeping the old one', () => {
  const repair = method('internal static string RepairRuntime(string here)');
  const order = [
    'File.Copy(node, copy);',
    'string expected = ExpectedRuntimeSha256(here);',
    'int code = RuntimeCheckExitCode(copy);',
    'File.Move(node, damaged);',
    'try { File.Move(copy, node); }',
    'int after = RuntimeCheckExitCode(node);',
  ].map((s) => { const at = repair.indexOf(s); assert.ok(at > -1, s + ' is gone from RepairRuntime'); return at; });
  for (let i = 1; i < order.length; i += 1) assert.ok(order[i - 1] < order[i], 'the repair steps are out of order at step ' + i);
  assert.match(repair, /if \(code != 0\)\n\s+\{\n\s+TryDeleteFile\(copy\);/, 'a fresh copy that does not run is not removed, or a slow one is accepted');
  assert.match(repair, /Path\.Combine\(runtime, DamagedRuntimePrefix \+ DateTime\.Now\.ToString\("yyyyMMdd-HHmmss"\)\)/);
  assert.doesNotMatch(repair, /File\.Delete\(node\)|File\.WriteAllBytes\(node/, 'the repair deletes or rewrites the old runtime instead of keeping it');
  assert.match(SOURCE, /internal const string RepairCopyName = "node-repair\.exe";/, 'the fresh copy is not an .exe, so Windows may not run it as a program');
});

test('#9144: after a hand-off (and only then), nothing listening on the port in time offers the same Repair', () => {
  const main = method('static int Main(string[] args)');
  assert.match(main, /if \(provablyServingHere\) \{ servedHere = true; stoppedByPerson = KeepBoardUntilPersonStopsIt\(p\); break; \}/);
  assert.match(main, /if \(p\.ExitCode == 0 && !servedHere && !stoppedByPerson && showMessageBoxes\) LookAfterHandOff\(here, node, port\);\n\s+return p\.ExitCode;/);
  const look = method('static void LookAfterHandOff(string here, string node, int port)');
  assert.match(look, /if \(listening == null \|\| listening\.Count > 0\) return;/, 'an unreadable table or a listening board is not left alone');
  assert.ok(look.indexOf('while (waited.ElapsedMilliseconds < AfterHandOffLookMs)') < look.indexOf('RuntimeCheckExitCode(node)'), 'the runtime is checked before the board was given its time');
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

/* A fake runtime: exit 139 when this file was CREATED before the threshold in threshold.txt beside it, else 0. A copy
   is a new file (a new creation time), a rename keeps the old one: the same shape as the fault. */
const FAKE_NODE = `
using System; using System.IO;
class FakeNode {
  static int Main(string[] a) {
    string me = System.Reflection.Assembly.GetEntryAssembly().Location;
    string t = Path.Combine(Path.GetDirectoryName(me), "threshold.txt");
    if (!File.Exists(t)) return 0;
    long ticks = long.Parse(File.ReadAllText(t).Trim());
    return File.GetCreationTimeUtc(me).Ticks < ticks ? 139 : 0;
  }
}`;
const PROBE = `
using System; using System.IO;
class RuntimeProbe {
  static int Main(string[] a) {
    if (a[0] == "check") { Console.WriteLine(KosmosLauncher.RuntimeCheckExitCode(a[1])); return 0; }
    string problem = KosmosLauncher.RepairRuntime(a[1]);
    Console.WriteLine(problem == null ? "REPAIRED" : "PROBLEM " + problem);
    return 0;
  }
}`;

function compile(csc, out, sources, main) {
  const r = spawnSync(csc, ['/nologo', '/target:exe', '/main:' + main, '/out:' + out, ...sources], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, 'compile failed: ' + r.stdout + r.stderr);
}

test('#9144 probe: RepairRuntime against a fake runtime that crashes, a bad manifest sha256, and a copy that crashes too', WINDOWS_ONLY, (t) => {
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

  /* One kit per case: a folder with runtime\node.exe (the fake, created in the past) and an optional manifest. */
  let n = 0;
  function kit(threshold, manifestSha) {
    const root = path.join(dir, 'kit' + (n += 1));
    fs.mkdirSync(path.join(root, 'runtime'), { recursive: true });
    const node = path.join(root, 'runtime', 'node.exe');
    fs.copyFileSync(fake, node);
    spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Item '${node}').CreationTimeUtc = (Get-Date).ToUniversalTime().AddHours(-1)`], { windowsHide: true });
    fs.writeFileSync(path.join(root, 'runtime', 'threshold.txt'), String(threshold));
    if (manifestSha !== undefined) fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ product: 'kosmos', platform: 'win32', runtime_node_sha256: manifestSha }));
    return { root, node };
  }
  const nowTicks = () => String(BigInt(Date.now()) * 10000n + 621355968000000000n);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(fake)).digest('hex');

  /* A: the old file crashes, a fresh copy runs: repaired, the old kept, no copy left, node.exe now runs. */
  const a = kit(nowTicks(), sha);
  assert.equal(run('check', a.node), '139', 'CONTROL: the fake runtime crashes before the repair');
  assert.equal(run('repair', a.root), 'REPAIRED');
  assert.equal(run('check', a.node), '0', 'node.exe still crashes after the repair');
  const left = fs.readdirSync(path.join(a.root, 'runtime'));
  assert.equal(left.filter((f) => f.startsWith('node.exe.damaged-')).length, 1, 'the old runtime is not kept: ' + left);
  assert.ok(!left.includes('node-repair.exe'), 'the fresh copy was left behind under its working name');

  /* B: the manifest names another sha256: refused, nothing swapped, no copy left. */
  const b = kit(nowTicks(), '0'.repeat(64));
  assert.match(run('repair', b.root), /^PROBLEM its file does not match this version's/);
  assert.equal(run('check', b.node), '139', 'the old runtime was swapped out on a sha256 mismatch');
  assert.ok(!fs.readdirSync(path.join(b.root, 'runtime')).some((f) => f === 'node-repair.exe' || f.startsWith('node.exe.damaged-')));

  /* C: a fresh copy crashes too (the threshold is in the future): refused, the old left in place. */
  const c = kit(String(BigInt(nowTicks()) + 36000000000n), sha);
  assert.match(run('repair', c.root), /^PROBLEM a fresh copy of it does not run either/);
  assert.ok(fs.existsSync(c.node) && !fs.readdirSync(path.join(c.root, 'runtime')).some((f) => f === 'node-repair.exe' || f.startsWith('node.exe.damaged-')));

  /* D: an older build with no manifest key: repaired on the run check alone. */
  const d = kit(nowTicks());
  assert.equal(run('repair', d.root), 'REPAIRED');
});
