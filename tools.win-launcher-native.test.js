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
const { spawnSync } = require('node:child_process');

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
  assert.equal(starts.length, 2, 'the launcher starts something other than the opener and the server');
  const mainAt = SOURCE.indexOf('static int Main(');
  for (const at of starts) {
    assert.ok(at > mainAt + appCheck, 'a process is started before the runtime and app checks; the tests below would reach the hand-off');
  }
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
  assert.match(readme, /C:\\\\Users\\\\<your name>\\\\AppData\\\\Local\\\\Programs\\\\Kosmos/, 'the README does not suggest the per-user Programs folder');
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
function runConsole(exe, tempFolder) {
  const env = { ...process.env, TEMP: tempFolder, TMP: tempFolder };
  delete env.PORT;
  const r = spawnSync(exe, ['--console'], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, windowsHide: true, encoding: 'utf8' });
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

test('W-04: TEMP given as an 8.3 short name still matches the exe\'s long path', WINDOWS_ONLY, (t) => {
  const s = scratch();
  try {
    const longTemp = path.join(s.temp, 'Temp Folder With Spaces');
    fs.mkdirSync(longTemp, { recursive: true });
    /* Verbatim, because node would otherwise escape the inner quotes as \" and
       cmd would read a different command. */
    const short = spawnSync('cmd.exe', ['/d', '/c', 'for %I in ("' + longTemp + '") do @echo %~sI'],
      { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true });
    const shortTemp = (short.stdout || '').trim();
    if (!shortTemp || shortTemp.toLowerCase() === longTemp.toLowerCase()) {
      t.skip('this volume has no 8.3 names, so there is no short form to test');
      return;
    }
    const exe = copyLauncherInto(path.join(longTemp, 'Temp1_kosmos-win-x64.zip-less'));
    const r = runConsole(exe, shortTemp);
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes(INSIDE_ZIP_MESSAGE), 'a short-name TEMP did not match the long exe path: ' + r.out);
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
