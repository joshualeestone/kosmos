'use strict';

/**
 * win32-launcher-native: Kosmos.exe presents itself as a Windows program.
 *
 *   node --test tools.win-launcher-native.test.js
 *
 * Plan: .claude/plans/win32-launcher-native-20260912T2148Z.md. Audit findings
 * W-04 (run from inside the zip), W-07 (no console window), W-08 (icon and
 * version information), and the zip README's Windows wording.
 *
 * 🔑 THE BINARY IS READ, NOT TRUSTED TO THE SOURCE. Kosmos.exe is committed
 * prebuilt (tools/windows/README.md), so "the source says /target:winexe" proves
 * nothing about the file that ships. The PE header and resource tree are parsed
 * here in plain JS, so these run on the Mac release lane too. Only the tests
 * that EXECUTE the exe need Windows.
 *
 * 🛑 THE EXE IS ONLY EVER RUN WHERE IT CANNOT REACH THE HAND-OFF. The board's
 * hand-off to its logon task (registering \Kosmos\board, moving engine-path)
 * lives in app\server.js. Every run below is in a scratch folder with no
 * runtime\node.exe, or with a placeholder one and no app\server.js, and the
 * source-order test pins that nothing is started before both checks.
 *
 * KOSMOS_LAUNCHER_EXE_UNDER_TEST points every binary test at another build,
 * which is how the revert controls (a console build, a build without the icon,
 * a build with the zip detection broken) are shown to go red.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const REPO = __dirname;
const EXE_PATH = process.env.KOSMOS_LAUNCHER_EXE_UNDER_TEST || path.join(REPO, 'tools', 'windows', 'Kosmos.exe');
const EXE = fs.readFileSync(EXE_PATH);
const ICO = fs.readFileSync(path.join(REPO, 'assets', 'kosmos.ico'));
const SOURCE = fs.readFileSync(path.join(REPO, 'tools', 'windows', 'KosmosLauncher.cs'), 'utf8');
const VERIFIER = fs.readFileSync(path.join(REPO, 'tools', 'windows', 'verify-launcher.ps1'), 'utf8');
const LAUNCHER_README = fs.readFileSync(path.join(REPO, 'tools', 'windows', 'README.md'), 'utf8');
const WIN = fs.readFileSync(path.join(REPO, 'tools', 'build-kosmos-windows.sh'), 'utf8');

const ICON_SIZES = [16, 32, 48, 256];
const IMAGE_SUBSYSTEM_WINDOWS_GUI = 2;
const RT_ICON = 3;
const RT_GROUP_ICON = 14;
const RT_VERSION = 16;
const WINDOWS_ONLY = { skip: process.platform !== 'win32' && 'running Kosmos.exe needs Windows' };

/* One derivation: the texts and versions the tests expect are read out of the
   launcher's own source, so a reworded message moves the test with it. */
function sourceConstant(name) {
  const m = SOURCE.match(new RegExp('const string ' + name + ' =\\s*"([^"]*)";'));
  assert.ok(m, 'KosmosLauncher.cs no longer defines ' + name);
  return m[1];
}
const INSIDE_ZIP_MESSAGE = sourceConstant('InsideZipMessage');
const PARTIAL_EXTRACT_ADVICE = sourceConstant('PartialExtractAdvice');

/* ---- a small PE reader --------------------------------------------------- */

function peLayout(buf) {
  assert.equal(buf.toString('latin1', 0, 2), 'MZ', 'not a DOS/PE file');
  const pe = buf.readUInt32LE(0x3c);
  assert.equal(buf.toString('latin1', pe, pe + 4), 'PE\0\0', 'no PE signature');
  const sectionCount = buf.readUInt16LE(pe + 6);
  const optionalSize = buf.readUInt16LE(pe + 20);
  const opt = pe + 24;
  const magic = buf.readUInt16LE(opt);
  const dataDirectories = opt + (magic === 0x20b ? 112 : 96);
  const sections = [];
  for (let i = 0; i < sectionCount; i++) {
    const s = opt + optionalSize + i * 40;
    sections.push({ va: buf.readUInt32LE(s + 12), vsize: buf.readUInt32LE(s + 8), raw: buf.readUInt32LE(s + 20), rawSize: buf.readUInt32LE(s + 16) });
  }
  const rvaToOffset = (rva) => {
    const s = sections.find((x) => rva >= x.va && rva < x.va + Math.max(x.vsize, x.rawSize));
    assert.ok(s, 'rva 0x' + rva.toString(16) + ' is in no section');
    return rva - s.va + s.raw;
  };
  return {
    subsystem: buf.readUInt16LE(opt + 68),
    resourceRva: buf.readUInt32LE(dataDirectories + 2 * 8),
    rvaToOffset,
  };
}

/* Every resource leaf as { type, name, data }. Names are numeric ids here. */
function resources(buf) {
  const layout = peLayout(buf);
  if (!layout.resourceRva) return [];
  const root = layout.rvaToOffset(layout.resourceRva);
  const entriesOf = (dirOffset) => {
    const count = buf.readUInt16LE(dirOffset + 12) + buf.readUInt16LE(dirOffset + 14);
    const out = [];
    for (let i = 0; i < count; i++) {
      const e = dirOffset + 16 + i * 8;
      const nameField = buf.readUInt32LE(e);
      const target = buf.readUInt32LE(e + 4);
      out.push({ id: nameField & 0x80000000 ? null : nameField, isDirectory: Boolean(target & 0x80000000), offset: root + (target & 0x7fffffff) });
    }
    return out;
  };
  const leaves = [];
  for (const type of entriesOf(root)) {
    if (!type.isDirectory) continue;
    for (const name of entriesOf(type.offset)) {
      if (!name.isDirectory) continue;
      for (const lang of entriesOf(name.offset)) {
        const dataOffset = layout.rvaToOffset(buf.readUInt32LE(lang.offset));
        const size = buf.readUInt32LE(lang.offset + 4);
        leaves.push({ type: type.id, name: name.id, data: buf.subarray(dataOffset, dataOffset + size) });
      }
    }
  }
  return leaves;
}

/* The sizes an icon directory lists (a GRPICONDIR or an .ico's ICONDIR). Both
   store 256 as 0. entrySize is 14 for a group resource and 16 for a file. */
function iconDirectorySizes(buf, entrySize) {
  const count = buf.readUInt16LE(4);
  const sizes = [];
  for (let i = 0; i < count; i++) sizes.push(buf[6 + i * entrySize] || 256);
  return sizes.sort((a, b) => a - b);
}

/* The image bytes of each entry of an .ico file, in file order. */
function icoImages(buf) {
  const count = buf.readUInt16LE(4);
  const images = [];
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const size = buf.readUInt32LE(e + 8);
    const offset = buf.readUInt32LE(e + 12);
    images.push(buf.subarray(offset, offset + size));
  }
  return images;
}

/* The key/value strings of a VS_VERSIONINFO block. Every node is wLength,
   wValueLength, wType, a UTF-16 key, padding to 32 bits, a value, padding, and
   children; a text node (wType 1) measures its value in UTF-16 characters. */
function versionStrings(block) {
  const strings = {};
  const align4 = (n) => (n + 3) & ~3;
  const walk = (offset, end) => {
    while (offset + 6 <= end) {
      const length = block.readUInt16LE(offset);
      if (length === 0) break;
      const valueLength = block.readUInt16LE(offset + 2);
      const isText = block.readUInt16LE(offset + 4) === 1;
      let p = offset + 6;
      let key = '';
      for (; p + 1 < block.length; p += 2) {
        const ch = block.readUInt16LE(p);
        if (ch === 0) { p += 2; break; }
        key += String.fromCharCode(ch);
      }
      p = align4(p);
      const valueBytes = isText ? valueLength * 2 : valueLength;
      if (isText && valueLength > 0) strings[key] = block.toString('utf16le', p, p + valueBytes).replace(/\0+$/, '');
      else if (isText) strings[key] = '';
      walk(align4(p + valueBytes), offset + length);
      offset = align4(offset + length);
    }
  };
  walk(0, block.length);
  return strings;
}

/* ---- the binary --------------------------------------------------------- */

test('W-07: Kosmos.exe is a GUI-subsystem exe, so a double-click opens no console window', () => {
  assert.equal(peLayout(EXE).subsystem, IMAGE_SUBSYSTEM_WINDOWS_GUI,
    'the committed Kosmos.exe is not a GUI exe (subsystem 3 is the console window W-07 removed); rebuild it with /target:winexe');
});

test('W-08: Kosmos.exe carries the Kosmos icon at 16, 32, 48 and 256, byte for byte from assets/kosmos.ico', () => {
  const leaves = resources(EXE);
  const groups = leaves.filter((r) => r.type === RT_GROUP_ICON);
  assert.equal(groups.length, 1, 'Kosmos.exe has no icon group resource; it shows the generic program icon (build with /win32icon:)');
  assert.deepEqual(iconDirectorySizes(groups[0].data, 14), ICON_SIZES, 'the icon group does not list the four sizes');
  const images = leaves.filter((r) => r.type === RT_ICON).map((r) => r.data);
  const shipped = icoImages(ICO);
  assert.equal(images.length, shipped.length, 'the exe carries a different number of icon images than assets/kosmos.ico');
  for (const image of shipped) {
    assert.ok(images.some((i) => i.equals(image)), 'an image in assets/kosmos.ico is not in Kosmos.exe; the exe was built from another icon');
  }
});

test('W-08: the version information says Kosmos, carries the LAUNCHER version, and names no company yet', () => {
  const version = resources(EXE).find((r) => r.type === RT_VERSION);
  assert.ok(version, 'Kosmos.exe has no version resource');
  const strings = versionStrings(version.data);
  assert.equal(strings.FileDescription, 'Kosmos', 'FileDescription is what Task Manager and SmartScreen show');
  assert.equal(strings.ProductName, 'Kosmos');
  assert.equal(strings.FileVersion, sourceConstant('LauncherVersion'), 'the exe was not rebuilt after LauncherVersion changed');
  assert.equal(strings.ProductVersion, sourceConstant('LauncherProductVersion'));
  /* It must match the code-signing certificate's subject, which is not issued
     yet. A guessed company would contradict the signature once it lands. */
  assert.ok(!strings.CompanyName, 'Kosmos.exe names a company before the signing certificate says which');
  assert.doesNotMatch(SOURCE, /\[assembly:\s*AssemblyCompany/, 'the source sets AssemblyCompany before the signing certificate exists');
  /* Never the app's version: the exe is copied unchanged into every release. */
  const appVersion = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
  assert.notEqual(strings.FileVersion.replace(/(\.0)+$/, ''), appVersion.replace(/(\.0)+$/, ''),
    'the launcher carries the app version, which goes stale at the next release');
});

test('W-08: assets/kosmos.ico holds the four sizes and is generated by the committed script', () => {
  assert.equal(ICO.readUInt16LE(2), 1, 'assets/kosmos.ico is not an icon file');
  assert.deepEqual(iconDirectorySizes(ICO, 16), ICON_SIZES);
  const script = fs.readFileSync(path.join(REPO, 'assets', 'make-kosmos-ico.ps1'), 'utf8');
  assert.match(script, /IconSizes = \{ 16, 32, 48, 256 \}/, 'the generator no longer makes the sizes this test expects');
  assert.match(script, /Kosmos-1024-shaped\.png/, 'the generator no longer reads the rounded master');
});

test('the build flags are one fact: the README documents exactly what verify-launcher.ps1 compiles with', () => {
  const flags = VERIFIER.match(/\$FLAGS = @\(([^)]*)\)/);
  assert.ok(flags, 'verify-launcher.ps1 no longer defines $FLAGS');
  const list = [...flags[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const icon = VERIFIER.match(/\$ICON_FLAG_FROM_REPO_ROOT = '([^']+)'/);
  assert.ok(icon, 'verify-launcher.ps1 no longer names the icon flag');
  assert.ok(list.includes('/target:winexe'), 'the verifier does not build a GUI exe');
  const block = LAUNCHER_README.match(/## Rebuilding it[\s\S]*?```\n([\s\S]*?)```/);
  assert.ok(block, 'the README lost its build command');
  const documented = block[1].split(/[\s^]+/).filter((t) => t.startsWith('/') && !t.startsWith('/out:'));
  assert.deepEqual(documented, [...list, icon[1]], 'the README and verify-launcher.ps1 build Kosmos.exe with different flags');
});

/* ---- the source, where the binary cannot say it ------------------------ */

test('🛑 nothing is started before the runtime and app checks, so a runtime-less folder never reaches the hand-off', () => {
  const main = SOURCE.slice(SOURCE.indexOf('static int Main('), SOURCE.indexOf('static int Fail('));
  const runtimeCheck = main.indexOf('if (!File.Exists(node))');
  const appCheck = main.indexOf('if (!File.Exists(server))');
  assert.ok(runtimeCheck > 0 && appCheck > runtimeCheck, 'the runtime and app checks moved');
  const starts = [...SOURCE.matchAll(/Process\.Start\(/g)].map((m) => m.index);
  /* The one start outside the launch is taskkill, in the stop path, which only runs
     once the server is already running. */
  const stopAt = SOURCE.indexOf('static void StopServerAndEverythingItStarted(');
  const stopEnd = SOURCE.indexOf('\n    }\n', stopAt);
  assert.ok(stopAt > 0 && stopEnd > stopAt, 'the stop path moved');
  assert.match(SOURCE.slice(stopAt, stopEnd), /"taskkill\.exe"\), "\/PID " \+ server\.Id \+ " \/T \/F"\)/,
    'the stop path no longer ends the board and its descendants with taskkill /T');
  const launches = starts.filter((at) => !(at > stopAt && at < stopEnd));
  assert.equal(starts.length - launches.length, 1, 'the stop path starts something other than one taskkill');
  assert.equal(launches.length, 2, 'the launcher starts something other than the opener and the server');
  const mainAt = SOURCE.indexOf('static int Main(');
  for (const at of launches) {
    assert.ok(at > mainAt + appCheck, 'a process is started before the runtime and app checks; the tests below would reach the hand-off');
  }
});

test('rounds 1-2 BUG: a board PROVABLY serving from the launcher (listening) gets a box that is the person\'s handle on it', () => {
  /* When the hand-off does not happen, server.js serves in place, on a hidden console
     in GUI mode. Without this box the person could neither see nor stop that board,
     and the next Kosmos.exe would die on the port it holds. */
  const handoff = require('./engine/win32handoff');
  const wait = SOURCE.match(/const int CheckForServingAfterMs = (\d+);/);
  assert.ok(wait, 'the launcher no longer names when it starts checking whether the board serves from it');
  assert.equal(Number(wait[1]), handoff.HANDOFF_CHECK_FOR_SERVING_AFTER_MS,
    'the launcher starts checking at a different time than the hand-off says: one fact, two copies, drifted');
  const handoffSource = fs.readFileSync(path.join(REPO, 'engine', 'win32handoff.js'), 'utf8');
  assert.match(handoffSource, /const HANDOFF_CHECK_FOR_SERVING_AFTER_MS = HANDOFF_BUDGET_MS \+ PROBE_TIMEOUT_MS \+ MIN_PORT_RELEASE_WAIT_MS \+ PROBE_TIMEOUT_MS;/,
    'the check mark is no longer derived from the budget and its floors');
  assert.doesNotMatch(SOURCE + handoffSource, /HandOffWorstCaseMs|HANDOFF_WORST_CASE_MS/, 'a constant still claims to be the hand-off\'s worst case, which round 2 measured it is not');
  assert.equal(sourceConstant('RunningHereMessage'),
    "Kosmos couldn't move to the background, so it's running from here instead. Keep this box open while you use Kosmos. Click OK to stop Kosmos. To see why, run Kosmos.exe --console.");
  const main = SOURCE.slice(SOURCE.indexOf('static int Main('), SOURCE.indexOf('static int Fail('));
  /* Round 2: time alone gave a healthy but slow hand-off a false box. The box is
     reached only through the listener check, and only in GUI mode. */
  assert.match(main,
    /if \(showMessageBoxes\)\s*\{\s*int stillToWaitMs = CheckForServingAfterMs - \(int\)sinceServerStarted\.ElapsedMilliseconds;\s*if \(!p\.WaitForExit\(Math\.Max\(0, stillToWaitMs\)\)\)\s*\{\s*while \(!p\.WaitForExit\(ServingPollMs\)\)\s*\{\s*if \(IsListeningOnAnyPort\(p\.Id\)\) \{ stoppedByPerson = KeepBoardUntilPersonStopsIt\(p\); break; \}\s*\}\s*\}\s*\}/,
    'the box is no longer gated on the board listening (or on GUI mode): a slow hand-off gets a false box again');
  assert.equal([...main.matchAll(/KeepBoardUntilPersonStopsIt\(/g)].length, 1, 'the box is reachable from Main other than through the listener gate');
  const lookup = SOURCE.slice(SOURCE.indexOf('internal static bool IsListeningOnAnyPort('), SOURCE.indexOf('// ---- presenting to a person'));
  assert.match(lookup, /OwnsATcpListener\(processId, AF_INET, IPV4_ROW_BYTES, IPV4_ROW_OWNING_PID_OFFSET\)\s*\|\| OwnsATcpListener\(processId, AF_INET6, IPV6_ROW_BYTES, IPV6_ROW_OWNING_PID_OFFSET\)/, 'the lookup no longer reads both IPv4 and IPv6 listeners');
  assert.match(lookup, /const int TCP_TABLE_OWNER_PID_LISTENER = 3;/);
  assert.match(lookup, /if \(result == ERROR_INSUFFICIENT_BUFFER\) continue;/, 'the lookup no longer resizes its buffer');
  assert.match(lookup, /finally\s*\{\s*if \(table != IntPtr\.Zero\) Marshal\.FreeHGlobal\(table\);\s*\}/, 'the lookup no longer frees its buffer on every path');
  assert.match(main, /if \(p\.ExitCode != 0 && !stoppedByPerson\)/, 'a board the person stopped is reported as a crash');
  const keep = SOURCE.slice(SOURCE.indexOf('static bool KeepBoardUntilPersonStopsIt('), SOURCE.indexOf('static void StopServerAndEverythingItStarted('));
  assert.match(keep, /server\.WaitForExit\(\);/, 'nothing watches for the board ending while the box is up');
  assert.match(keep, /PostMessage\(window, WM_CLOSE,/, 'the box is not closed when the board ends by itself');
  /* Retried until the box has returned, and (round 2) checked and enumerated under
     the lock the main thread takes to mark it closed, so no WM_CLOSE reaches the
     crash box shown after it. */
  assert.match(keep, /while \(true\)\s*\{\s*lock \(runningHereBoxLock\)\s*\{\s*if \(boxIsClosed\) return;\s*EnumThreadWindows\(boxThread, closeDialogs, IntPtr\.Zero\);\s*\}/,
    'the watcher checks the box flag and enumerates outside the lock, so it can close the crash box');
  assert.match(keep,
    /ShowMessageBox\(RunningHereMessage, false\);\s*lock \(runningHereBoxLock\) \{ boxIsClosed = true; \}\s*if \(server\.HasExited\) return false;\s*StopServerAndEverythingItStarted\(server\);\s*return true;/,
    'OK does not stop the board, stops one that had already ended, or marks the box closed outside the lock');
});

test('W-07: message boxes are for a person at a desktop, and --console keeps the console launcher', () => {
  assert.match(SOURCE, /showMessageBoxes = !wantsConsole && Environment\.UserInteractive;/,
    'a non-interactive run could show a message box nobody can see and wait on it forever');
  assert.match(SOURCE, /const string ConsoleFlag = "--console";/);
  assert.match(SOURCE, /const string WindowTitle = "Kosmos";/);
  /* The server's start is the old one except for the hidden console. */
  assert.match(SOURCE, /new ProcessStartInfo\(node, "\\"" \+ server \+ "\\""\);\s*s\.UseShellExecute = false;\s*s\.WorkingDirectory = here;/);
  assert.match(SOURCE, /s\.CreateNoWindow = showMessageBoxes;/);
  assert.doesNotMatch(SOURCE, /Redirect(StandardOutput|StandardError|StandardInput)\s*=\s*true/,
    'the server\'s output is redirected, which changes what it sees and can hang WaitForExit on a grandchild');
});

/* ---- the zip README ---------------------------------------------------- */

test('the zip README speaks Windows: Extract, sign in, the real prompts, a folder that is not Projects', () => {
  const readme = WIN.slice(WIN.indexOf("printf 'Kosmos for Windows"), WIN.indexOf('} > "$STAGE/! READ ME FIRST'));
  assert.ok(readme.length > 1000, 'the README block moved; this reads nothing');
  assert.doesNotMatch(readme, /[Uu]npack/, 'the README says "unpack"; Explorer says Extract');
  assert.doesNotMatch(readme, /log in|login/, 'the README says "log in"; Windows says sign in');
  assert.match(readme, /Extract All\.\.\./);
  assert.match(readme, /If a box says "The publisher could not be verified", click Run\./);
  assert.match(readme, /Tip: before you extract, right-click the zip, choose Properties, tick\\r\\n'\n\s*printf 'Unblock/);
  assert.match(readme, /This preview is not signed yet; signed builds are coming\./);
  assert.doesNotMatch(readme, /have not bought/, 'the README still says a certificate was not bought');
  /* %LOCALAPPDATA%, typed into File Explorer's address bar, which expands it: the
     profile folder is often not the person's name and AppData is hidden (round 1). */
  assert.match(readme, /folder named Kosmos inside %%LOCALAPPDATA%%\\\\Programs\./, 'the README does not suggest the per-user Programs folder');
  assert.match(readme, /in File Explorer, click the address bar, type\\r\\n'\n\s*printf '%%LOCALAPPDATA%%\\\\Programs and press Enter\./, 'the README does not say how to reach that folder');
  assert.match(readme, /paste that path into the box, and click Extract\./);
  assert.doesNotMatch(readme, /AppData\\\\Local\\\\Programs/, 'the README spells out a profile path the person has to guess');
  assert.doesNotMatch(readme, /<your name>\\\\Kosmos\)/, 'the README suggests C:\\Users\\<name>\\Kosmos, where the Projects live (W-09)');
  assert.match(readme, /Bookmarks to Kosmos don\\047t stay\\r\\n'\n\s*printf 'signed in\. Always open Kosmos from Kosmos\.exe\./);
  assert.doesNotMatch(readme, /Start menu/, 'the README promises a Start menu entry this slice does not create');
  assert.match(readme, /open Start, type Task Scheduler, press Enter, and open\\r\\n'\n\s*printf 'Task Scheduler Library, then the Kosmos folder\./);
  assert.doesNotMatch(readme, /A window opens for a moment/, 'the README still describes the console window W-07 removed');
  assert.match(WIN, /"\$STAGE\/! READ ME FIRST - Windows will warn you\.txt"/, 'the ! filename, which sorts first, is gone');
});

/* ---- running the built exe, where it provably stops -------------------- */

function copyLauncherInto(folder, extra) {
  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(EXE_PATH, path.join(folder, 'Kosmos.exe'));
  if (extra && extra.placeholderRuntime) {
    fs.mkdirSync(path.join(folder, 'runtime'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'runtime', 'node.exe'), '');
  }
  assert.ok(!fs.existsSync(path.join(folder, 'app', 'server.js')), 'a scratch launcher folder must never hold a server that could hand off');
  return path.join(folder, 'Kosmos.exe');
}

/* --console, output captured, stdin empty so a held window cannot wait, and a
   timeout so a launcher that did wait fails instead of hanging the suite. */
function runConsole(exe, tempFolder, timeoutMs) {
  const env = { ...process.env, TEMP: tempFolder, TMP: tempFolder };
  delete env.PORT;
  const r = spawnSync(exe, ['--console'], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs || 20000, windowsHide: true, encoding: 'utf8' });
  assert.equal(r.error, undefined, 'Kosmos.exe did not run: ' + (r.error && r.error.message));
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function scratch() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kln-'));
  const temp = path.join(base, 'fake-temp');
  const elsewhere = path.join(base, 'Users', 'someone');
  fs.mkdirSync(temp, { recursive: true });
  fs.mkdirSync(elsewhere, { recursive: true });
  return { base, temp, elsewhere };
}

test('W-04: run from Explorer\'s zip view (a Temp1_*.zip folder under TEMP, no runtime) says it is still inside the zip', WINDOWS_ONLY, () => {
  const s = scratch();
  try {
    const exe = copyLauncherInto(path.join(s.temp, 'Temp1_kosmos-win-x64.zip'));
    const r = runConsole(exe, s.temp);
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes(INSIDE_ZIP_MESSAGE), 'no inside-the-zip message: ' + r.out);
    assert.ok(!r.out.includes(PARTIAL_EXTRACT_ADVICE), 'the zip case got the partial-extract message too');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('W-04: any extraction under TEMP (7-Zip, WinRAR) with no runtime is the zip case too', WINDOWS_ONLY, () => {
  const s = scratch();
  try {
    const exe = copyLauncherInto(path.join(s.temp, '7zO1A2B3C4D'));
    const r = runConsole(exe, s.temp);
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes(INSIDE_ZIP_MESSAGE), 'a Temp extraction was not recognised: ' + r.out);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('W-04: a folder named *.zip outside TEMP, with no runtime, is the zip case', WINDOWS_ONLY, () => {
  const s = scratch();
  try {
    const exe = copyLauncherInto(path.join(s.elsewhere, 'Downloads', 'kosmos-win-x64.zip', 'kosmos-win-x64'));
    const r = runConsole(exe, s.temp);
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes(INSIDE_ZIP_MESSAGE), 'a .zip path segment was not recognised: ' + r.out);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

function shortNameOf(p) {
  /* Verbatim, because node would otherwise escape the inner quotes as \" and
     cmd would read a different command. */
  const r = spawnSync('cmd.exe', ['/d', '/c', 'for %I in ("' + p + '") do @echo %~sI'],
    { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true });
  return (r.stdout || '').trim() || p;
}

test('W-04: an 8.3 short name on either side (TEMP or the exe\'s own path) still matches', WINDOWS_ONLY, (t) => {
  const s = scratch();
  try {
    const longTemp = path.join(s.temp, 'Temp Folder With Spaces');
    /* No "zip" in the folder name: its 8.3 form would end in .ZIP and match on
       the .zip-segment rule, proving nothing about the temp comparison. */
    const exe = copyLauncherInto(path.join(longTemp, 'extracted by some tool'));
    const shortTemp = shortNameOf(longTemp);
    const shortExe = path.join(shortNameOf(path.dirname(exe)), 'Kosmos.exe');
    if (shortTemp.toLowerCase() === longTemp.toLowerCase()) {
      t.skip('this volume has no 8.3 names, so there is no short form to test');
      return;
    }
    assert.doesNotMatch(shortExe, /\.zip/i, 'the short exe path matches on a .zip segment, so this arm would prove nothing');
    let r = runConsole(exe, shortTemp);
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes(INSIDE_ZIP_MESSAGE), 'a short-name TEMP did not match the long exe path: ' + r.out);
    r = runConsole(shortExe, longTemp);
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes(INSIDE_ZIP_MESSAGE), 'an exe launched by its short path did not match the long TEMP: ' + r.out);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('W-04 CONTROL: an ordinary folder with no runtime is a partial extract, NOT the zip case', WINDOWS_ONLY, () => {
  const s = scratch();
  try {
    const exe = copyLauncherInto(path.join(s.elsewhere, 'AppData', 'Local', 'Programs', 'Kosmos'));
    const r = runConsole(exe, s.temp);
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes('Kosmos could not start: the bundled runtime is missing (runtime\\node.exe).'), r.out);
    assert.ok(r.out.includes(PARTIAL_EXTRACT_ADVICE), 'no partial-extract advice: ' + r.out);
    assert.ok(!r.out.includes(INSIDE_ZIP_MESSAGE), 'an ordinary folder was taken for the inside of a zip');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('round 1: a sibling of TEMP that merely starts with its name (Temp2 beside Temp) is NOT inside the zip', WINDOWS_ONLY, () => {
  const s = scratch();
  try {
    const temp = path.join(s.base, 'Temp');
    fs.mkdirSync(temp, { recursive: true });
    const exe = copyLauncherInto(path.join(s.base, 'Temp2', 'Kosmos'));
    const r = runConsole(exe, temp);
    assert.equal(r.code, 1, r.out);
    assert.ok(!r.out.includes(INSIDE_ZIP_MESSAGE), 'a folder beside TEMP with a longer name was taken for TEMP: ' + r.out);
    assert.ok(r.out.includes(PARTIAL_EXTRACT_ADVICE), r.out);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('round 1: TEMP set to a whole drive (C:\\) does not make every folder on it "inside the zip"', WINDOWS_ONLY, () => {
  const s = scratch();
  try {
    const exe = copyLauncherInto(path.join(s.elsewhere, 'Kosmos'));
    const r = runConsole(exe, path.parse(s.base).root);
    assert.equal(r.code, 1, r.out);
    assert.ok(!r.out.includes(INSIDE_ZIP_MESSAGE), 'a drive-root TEMP claimed a folder on that drive: ' + r.out);
    assert.ok(r.out.includes(PARTIAL_EXTRACT_ADVICE), r.out);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('round 1 CONVENTION: --console with both outputs captured and no console to attach to opens no window and does not hold', WINDOWS_ONLY, async () => {
  /* A parent with no console (a detached process, a service-like caller) makes
     AttachConsole fail. Before the fix the launcher then allocated a visible console,
     left the NUL stdin unrestored, and Hold() waited on that new window for a key. */
  const s = scratch();
  try {
    const exe = copyLauncherInto(path.join(s.elsewhere, 'Kosmos'));
    const resultFile = path.join(s.base, 'relay-result.json');
    const relay = [
      "const { spawn } = require('node:child_process');",
      "const [exe, out, waitMs] = process.argv.slice(1);",
      "const child = spawn(exe, ['--console'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });",
      "let text = ''; let killed = false;",
      "child.stdout.on('data', (d) => { text += d; }); child.stderr.on('data', (d) => { text += d; });",
      "const timer = setTimeout(() => { killed = true; child.kill(); }, Number(waitMs));",
      "child.on('close', (code) => { clearTimeout(timer); require('node:fs').writeFileSync(out, JSON.stringify({ code, killed, text })); });",
    ].join('\n');
    const env = { ...process.env, TEMP: s.temp, TMP: s.temp };
    delete env.PORT;
    const RELAY_WAIT_MS = 10000;
    /* detached on Windows is DETACHED_PROCESS: the relay has no console, so neither
       does anything it starts, and the launcher's AttachConsole fails. */
    const relayProcess = require('node:child_process').spawn(process.execPath, ['-e', relay, exe, resultFile, String(RELAY_WAIT_MS)],
      { detached: true, stdio: 'ignore', windowsHide: true, env });
    await new Promise((resolve) => relayProcess.on('exit', resolve));
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    assert.equal(result.killed, false, 'the launcher held on a console of its own nobody can see, until it was killed: ' + result.text);
    /* Only a console the launcher allocated for itself has one attached process, and
       only then does Hold() print its prompt. Measured on the box: with a NUL stdin,
       ReadKey threw instead of blocking, so the old code did not hang there, but it
       still opened a console window and prompted into it. The prompt is the visible
       trace of that window. */
    assert.ok(!result.text.includes('Press any key to close this window.'),
      'the launcher allocated a console window of its own although both outputs were captured: ' + result.text);
    assert.equal(result.code, 1, result.text);
    assert.ok(result.text.includes(PARTIAL_EXTRACT_ADVICE), 'the captured outputs did not get the message: ' + result.text);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

/* A folder with a real node.exe and a FAKE app\server.js: the launcher's own
   behaviour runs end to end, and the thing it starts is a script written here, not
   the board, so no hand-off exists to reach. No open-board.js, so no opener. */
const FAKE_BOARD_MARKER = '// fake board written by tools.win-launcher-native.test.js';
function stageFakeBoard(folder, serverScript) {
  fs.mkdirSync(path.join(folder, 'runtime'), { recursive: true });
  fs.mkdirSync(path.join(folder, 'app'), { recursive: true });
  const exe = path.join(folder, 'Kosmos.exe');
  if (!fs.existsSync(exe)) fs.copyFileSync(EXE_PATH, exe);
  const node = path.join(folder, 'runtime', 'node.exe');
  if (!fs.existsSync(node)) fs.copyFileSync(process.execPath, node);
  fs.writeFileSync(path.join(folder, 'app', 'server.js'), FAKE_BOARD_MARKER + '\n' + serverScript + '\n');
  assert.deepEqual(fs.readdirSync(path.join(folder, 'app')), ['server.js'], 'the fake app must hold only the fake server');
  assert.ok(fs.readFileSync(path.join(folder, 'app', 'server.js'), 'utf8').startsWith(FAKE_BOARD_MARKER));
  assert.ok(!fs.existsSync(path.join(folder, 'open-board.js')), 'a scratch launcher folder must never start the real opener');
  return exe;
}

test('--console waits on the board and passes its exit code through, with the console launcher\'s lines', WINDOWS_ONLY, () => {
  const s = scratch();
  try {
    const exe = stageFakeBoard(path.join(s.elsewhere, 'Kosmos'), 'process.exit(7);');
    const r = runConsole(exe, s.temp);
    assert.equal(r.code, 7, 'the board\'s exit code did not come back: ' + r.out);
    assert.ok(r.out.includes('Starting Kosmos. A browser will open in a moment.'), r.out);
    assert.ok(r.out.includes('Kosmos stopped. The lines above say why.'), r.out);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

/* The top-level windows a process owns: its main window handle, and how many message
   boxes (#32770) belong to it. PowerShell, because node has no window API; the script
   travels base64 so no quoting reaches a command line. */
function windowsOwnedBy(pid) {
  const script = [
    '$id = ' + Number(pid),
    "Add-Type -TypeDefinition @'",
    'using System; using System.Text; using System.Runtime.InteropServices;',
    'public static class LauncherWindowProbe {',
    '  public delegate bool Visit(IntPtr window, IntPtr parameter);',
    '  [DllImport("user32.dll")] static extern bool EnumWindows(Visit visit, IntPtr parameter);',
    '  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);',
    '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);',
    '  public static int Dialogs(uint owner) {',
    '    int count = 0;',
    '    Visit visit = (window, parameter) => { uint processId; GetWindowThreadProcessId(window, out processId);',
    '      if (processId == owner) { var name = new StringBuilder(64); GetClassName(window, name, name.Capacity); if (name.ToString() == "#32770") count++; }',
    '      return true; };',
    '    EnumWindows(visit, IntPtr.Zero);',
    '    return count;',
    '  }',
    '}',
    "'@",
    '$p = Get-Process -Id $id -ErrorAction SilentlyContinue',
    '$main = 0; if ($p) { $main = [int64]$p.MainWindowHandle }',
    'Write-Output ("{0} {1}" -f $main, [LauncherWindowProbe]::Dialogs([uint32]$id))',
  ].join('\r\n');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const m = String(r.stdout || '').trim().match(/(-?\d+) (\d+)\s*$/);
  assert.ok(m, 'the window probe did not run: ' + (r.stderr || r.stdout || (r.error && r.error.message)));
  return { mainWindow: Number(m[1]), dialogs: Number(m[2]) };
}

function killTree(pid) {
  spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
}

test('rounds 1-2 BUG, --console arm: a board LISTENING past the check mark is neither boxed nor stopped, and the launcher opens no window', WINDOWS_ONLY, async () => {
  /* The fake board listens (on an ephemeral loopback port, never 16180), so a
     regression that let --console reach the box would show one: the listener gate
     alone would not keep it away. A box closed by the watcher when the board ends
     would leave the exit code green, so the window itself is looked for while the
     board is still up. */
  const checkAfterMs = require('./engine/win32handoff').HANDOFF_CHECK_FOR_SERVING_AFTER_MS;
  const LOOK_FOR_A_WINDOW_AT_MS = checkAfterMs + 2000;
  const BOARD_ENDS_AT_MS = LOOK_FOR_A_WINDOW_AT_MS + 8000;
  const s = scratch();
  let launcher = null;
  try {
    const exe = stageFakeBoard(path.join(s.elsewhere, 'Kosmos'),
      "require('node:net').createServer().listen(0, '127.0.0.1'); setTimeout(() => process.exit(0), " + BOARD_ENDS_AT_MS + ');');
    const env = { ...process.env, TEMP: s.temp, TMP: s.temp };
    delete env.PORT;
    const startedAt = Date.now();
    launcher = spawn(exe, ['--console'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    launcher.stdout.on('data', (d) => { out += d; });
    launcher.stderr.on('data', (d) => { out += d; });
    const exited = new Promise((resolve) => launcher.on('exit', (code) => resolve(code)));
    await Promise.race([exited, sleep(LOOK_FOR_A_WINDOW_AT_MS)]);
    const windows = windowsOwnedBy(launcher.pid);
    if (windows.mainWindow !== 0 || windows.dialogs > 0) {
      killTree(launcher.pid);
      assert.fail('the --console launcher showed a window while its board was listening: ' + JSON.stringify(windows));
    }
    const code = await exited;
    const tookMs = Date.now() - startedAt;
    assert.equal(code, 0, 'the launcher did not wait for the board to end by itself: ' + out);
    assert.ok(tookMs >= BOARD_ENDS_AT_MS, 'the launcher ended before the board did (' + tookMs + 'ms)');
    assert.ok(!out.includes('Kosmos stopped'), out);
  } finally {
    if (launcher && launcher.exitCode === null) killTree(launcher.pid);
    fs.rmSync(s.base, { recursive: true, force: true });
  }
});

test('round 2: the listener lookup finds a process listening on IPv4 or IPv6, and not one that is not listening', WINDOWS_ONLY, async (t) => {
  /* The lookup is compiled out of the real KosmosLauncher.cs together with a
     four-line probe, in scratch, and never shipped. Real node processes do the
     listening, on ephemeral loopback ports (never 16180). */
  const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(csc)) { t.skip('no .NET Framework compiler on this machine'); return; }
  const s = scratch();
  const children = [];
  try {
    const probeSource = path.join(s.base, 'ListenerProbe.cs');
    fs.writeFileSync(probeSource, 'class ListenerProbe { static int Main(string[] a) { System.Console.Write(KosmosLauncher.IsListeningOnAnyPort(int.Parse(a[0])) ? "listening" : "not-listening"); return 0; } }\n');
    const probe = path.join(s.base, 'probe.exe');
    const built = spawnSync(csc, ['/nologo', '/target:exe', '/main:ListenerProbe', '/out:' + probe, path.join(REPO, 'tools', 'windows', 'KosmosLauncher.cs'), probeSource], { encoding: 'utf8', windowsHide: true });
    assert.equal(built.status, 0, 'the probe did not compile: ' + built.stdout + built.stderr);
    const lookup = (pid) => spawnSync(probe, [String(pid)], { encoding: 'utf8', windowsHide: true }).stdout.trim();

    const startChild = (script) => new Promise((resolve) => {
      const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      children.push(child);
      child.stdout.on('data', (d) => resolve({ child, said: String(d).trim() }));
      child.on('exit', () => resolve({ child, said: 'exited' }));
    });
    const LISTEN = (host) => "const s = require('node:net').createServer(); s.on('error', () => { console.log('cannot'); }); s.listen(0, '" + host + "', () => console.log('up')); setInterval(() => {}, 1000);";

    const v4 = await startChild(LISTEN('127.0.0.1'));
    assert.equal(v4.said, 'up');
    assert.equal(lookup(v4.child.pid), 'listening', 'an IPv4 listener was not found');

    const idle = await startChild("console.log('idle'); setInterval(() => {}, 1000);");
    assert.equal(idle.said, 'idle');
    assert.equal(lookup(idle.child.pid), 'not-listening', 'a process that listens on nothing was reported listening');

    const v6 = await startChild(LISTEN('::1'));
    if (v6.said !== 'up') { t.diagnostic('no IPv6 loopback here; the IPv6 arm did not run'); return; }
    assert.equal(lookup(v6.child.pid), 'listening', 'an IPv6-only listener was not found');
  } finally {
    for (const child of children) { try { child.kill(); } catch { /* already gone */ } }
    fs.rmSync(s.base, { recursive: true, force: true });
  }
});

test('a runtime with no app is a partial extract naming app\\server.js, and never starts anything', WINDOWS_ONLY, () => {
  const s = scratch();
  try {
    const folder = path.join(s.elsewhere, 'Kosmos-partial');
    const exe = copyLauncherInto(folder, { placeholderRuntime: true });
    const r = runConsole(exe, s.temp);
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes('Kosmos could not start: the application is missing (app\\server.js).'), r.out);
    assert.ok(!r.out.includes('Starting Kosmos'), 'the launcher went past the app check');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});
