'use strict';
/**
 * win32-installer-native: Kosmos.exe does an installer's job (installer audit W-06, W-20, W-27).
 *
 *   node --test tools.win-installer-native.test.js
 *
 * Plan: .claude/plans/win32-installer-native-20260913T052847Z.md.
 *
 * 🛑 NEVER THE REAL START MENU, REGISTRY, TASKS OR DATA. The shortcut, the Apps entry, the
 * Known Folders and the "Keep it here" memory are exercised through a probe compiled out of the
 * real KosmosLauncher.cs in a scratch folder, whose seams point them at a temp Start Menu folder,
 * `HKCU\Software\KosmosTest\<guid>`, fake folders and a temp file. The probe refuses any
 * registry parent outside `Software\KosmosTest\`. The real `Kosmos.lnk` and the real
 * `HKCU\...\Uninstall\Kosmos` are looked at before and after every probe run, as a control that
 * the seams held.
 * The shipped exe itself is run only as `--uninstall --console`, which must refuse before
 * anything; its helper there is a stand-in that would leave a marker if it ever ran.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = __dirname;
const EXE_PATH = process.env.KOSMOS_LAUNCHER_EXE_UNDER_TEST || path.join(REPO, 'tools', 'windows', 'Kosmos.exe');
const SOURCE_PATH = path.join(REPO, 'tools', 'windows', 'KosmosLauncher.cs');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');
/* Comments removed, for assertions about what the code DOES rather than what it says. */
const CODE = SOURCE.replace(/\/\/[^\n]*/g, '');
const WINDOWS_ONLY = { skip: process.platform !== 'win32' && 'the probe and Kosmos.exe need Windows' };
const CSC = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

/** One method's body, from its declaration to its closing brace at class indentation. */
function method(name) {
  const at = SOURCE.search(new RegExp('\\n {4}(?:internal |public |private )?static [^\\n(=]*?\\b' + name + '\\('));
  assert.ok(at > -1, 'KosmosLauncher.cs no longer has ' + name);
  const end = SOURCE.indexOf('\n    }\n', at);
  assert.ok(end > at, name + ' has no end');
  return SOURCE.slice(at, end);
}

function constant(name) {
  const m = SOURCE.match(new RegExp('const string ' + name + ' =\\s*"([^"]*)";'));
  assert.ok(m, 'KosmosLauncher.cs no longer defines ' + name);
  return m[1];
}

/* ---- the source, where a probe cannot say it ------------------------------ */

test('W-20: the Start menu shortcut is IShellLink COM, never a PowerShell or WScript.Shell process', () => {
  assert.match(SOURCE, /\[ComImport, Guid\("00021401-0000-0000-C000-000000000046"\)\]\s*class ShellLinkObject \{ \}/, 'not the ShellLink coclass');
  assert.match(SOURCE, /InterfaceType\(ComInterfaceType\.InterfaceIsIUnknown\), Guid\("000214F9-0000-0000-C000-000000000046"\)\]\s*interface IShellLinkW/, 'not IShellLinkW');
  const refresh = method('RefreshStartMenuShortcut');
  assert.match(refresh, /link = new ShellLinkObject\(\);/);
  assert.match(refresh, /shellLink\.SetPath\(exe\);\s*shellLink\.SetWorkingDirectory\(workingDirectory\);\s*shellLink\.SetIconLocation\(exe, 0\);/,
    'the shortcut does not point at the exe, start in the Kosmos folder, and use the exe\'s icon');
  assert.match(refresh, /ComTypes\.IPersistFile\)link\)\.Save\(at, true\);/);
  assert.match(refresh, /finally\s*\{\s*if \(link != null\) Marshal\.FinalReleaseComObject\(link\);/);
  assert.doesNotMatch(CODE, /WScript\.Shell|powershell|cscript|wscript/i, 'the launcher shells a script host');
  assert.match(SOURCE, /startMenuProgramsFolder = \(\) => Environment\.GetFolderPath\(Environment\.SpecialFolder\.Programs\);/,
    'the shortcut is not in the per-user Start Menu Programs folder');
  assert.equal(constant('ShortcutFileName'), 'Kosmos.lnk');
});

test('W-27b: the Apps & features entry is per user, carries every value, and names no Publisher until the certificate does', () => {
  assert.match(SOURCE, /internal static string uninstallKeyParent = @"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall";/);
  assert.equal(constant('UninstallKeyName'), 'Kosmos');
  assert.doesNotMatch(CODE, /Registry\.LocalMachine|RegistryHive\.LocalMachine/, 'a machine-wide key needs admin');
  const register = method('RegisterUninstallEntry');
  assert.match(register, /Registry\.CurrentUser\.CreateSubKey\(uninstallKeyParent \+ "\\\\" \+ UninstallKeyName\)/);
  assert.match(register, /string uninstall = "\\"" \+ exe \+ "\\" " \+ UninstallFlag;/, 'UninstallString is not the quoted exe with --uninstall');
  for (const [name, value, kind] of [
    ['DisplayName', 'DisplayName', 'String'], ['DisplayIcon', 'exe', 'String'], ['DisplayVersion', 'version', 'String'],
    ['InstallLocation', 'root', 'String'], ['UninstallString', 'uninstall', 'String'], ['QuietUninstallString', 'uninstall', 'String'],
    ['NoModify', '1', 'DWord'], ['NoRepair', '1', 'DWord'],
  ]) {
    assert.ok(register.includes('key.SetValue("' + name + '", ' + value + ', RegistryValueKind.' + kind + ');'), name + ' is not written as ' + value);
  }
  assert.match(register, /key\.SetValue\("EstimatedSize", \(int\)Math\.Min\(sizeInKilobytes, int\.MaxValue\), RegistryValueKind\.DWord\)/);
  assert.equal(constant('DisplayName'), 'Kosmos');
  assert.match(SOURCE, /internal const string PublisherLegalName = "";/, 'a Publisher was named before Josh gave the certificate\'s legal company name');
  assert.match(register, /if \(PublisherLegalName\.Length > 0\) key\.SetValue\("Publisher", PublisherLegalName, RegistryValueKind\.String\);\s*else key\.DeleteValue\("Publisher", false\);/);
  assert.equal([...CODE.matchAll(/"Publisher"/g)].length, 2, 'Publisher is written somewhere other than behind the certificate constant');
});

test('🛑 --uninstall is decided first, confirms before any action, and never deletes the folder it runs from', () => {
  const main = method('Main');
  const uninstallAt = main.indexOf('if (wantsUninstall) return Uninstall(here, node);');
  assert.ok(uninstallAt > -1 && uninstallAt < main.indexOf('if (!File.Exists(node))') && uninstallAt < main.indexOf('IsKosmosBuild(here)'),
    '--uninstall is not decided before the launch, the move offer and the Start menu refresh');
  assert.equal(constant('RemoveQuestion'), 'Remove Kosmos from this PC? Your agents will stop.');
  assert.equal(constant('RemoveChatsQuestion'), 'Also delete your agents\' chats and settings?');
  const body = method('Uninstall');
  const refuseAt = body.indexOf('if (!showMessageBoxes)');
  const firstAsk = body.indexOf('if (!AskYesNo(RemoveQuestion)) return 0;');
  const secondAsk = body.indexOf('bool alsoDeleteChats = AskYesNo(RemoveChatsQuestion);');
  const helperAt = body.indexOf('RunEngineHelper(');
  assert.ok(refuseAt > -1 && refuseAt < firstAsk, 'with nobody to ask, --uninstall does not stop before the question');
  assert.match(body.slice(refuseAt, firstAsk), /Console\.Error\.WriteLine\(UninstallNeedsAPersonMessage\);\s*return UninstallNotConfirmedExitCode;/);
  assert.ok(firstAsk > -1 && secondAsk > firstAsk && helperAt > secondAsk, 'something runs before both questions are answered');
  assert.ok(body.indexOf('RemoveStartMenuShortcut()') > helperAt && body.indexOf('RemoveUninstallEntry()') > helperAt,
    'the shortcut or the Apps entry goes before the tasks and folders');
  assert.match(body, /if \(leftBehind\.Count == 0\)\s*\{\s*string entryProblem = RemoveUninstallEntry\(\);/, 'the Apps entry goes even when something was left behind, so the person cannot try again');
  assert.match(body, /"Kosmos is removed\. You can now delete the folder " \+ here \+ "\.\\n\\n" \+ CannotDeleteOwnFolder/);
  assert.match(body, /"--uninstall" \+ \(alsoDeleteChats \? " --delete-data" : ""\) \+ " --root " \+ QuoteArgument\(here\)/, 'the chats are deleted without the yes');
  assert.match(method('AskYesNo'), /MessageBoxDefaultButton\.Button2/, 'a removal question defaults to Yes');
  assert.match(method('AskYesNo'), /MB_YESNO \| MB_ICONQUESTION \| MB_DEFBUTTON2/, 'the fallback removal question defaults to Yes');
  assert.doesNotMatch(CODE, /MoveFileEx|MOVEFILE_DELAY_UNTIL_REBOOT|RunOnce|cmd(\.exe)?"?,? *"?\/c|Directory\.Delete\(|ping -n/i,
    'the launcher tries to delete its own folder, or anything at all');
});

test('the engine helpers are armed only after a question, and speak the flags and report tags the launcher uses', () => {
  const helper = method('RunEngineHelper');
  assert.equal(constant('ConfirmedFlag'), '--yes');
  assert.match(helper, /" --report " \+ QuoteArgument\(report\) \+ " " \+ ConfirmedFlag\)/);
  assert.doesNotMatch(helper, /Redirect(StandardOutput|StandardError|StandardInput)\s*=\s*true/, 'the helper\'s output is redirected, so a grandchild could hang the wait');
  assert.match(helper, /h\.CreateNoWindow = true;/);
  /* Exactly two callers, each after its question. */
  assert.equal([...CODE.matchAll(/RunEngineHelper\(/g)].length, 3, 'RunEngineHelper is called from somewhere new');
  const offer = method('OfferToMoveOutOfATemporaryPlace');
  assert.ok(offer.indexOf('AskMoveOrKeep(MoveQuestion(place))') > -1 && offer.indexOf('RunEngineHelper(') > offer.indexOf('if (answer != MoveAnswer.Move) return false;'),
    'the move runs before the person chose Move Kosmos');

  /* The flags the launcher passes are ones the engine's CLIs accept (usage is exit 64). */
  const uninstaller = require('./engine/win32uninstall');
  const relocator = require('./engine/win32relocate');
  assert.equal(constant('UninstallHelperScript'), 'win32uninstall.js');
  assert.equal(constant('RelocateHelperScript'), 'win32relocate.js');
  const fakeUninstall = () => ({ ok: true, done: [], left: [], notes: [] });
  const report = path.join(os.tmpdir(), 'kosmos-flags-' + process.pid + '.txt');
  try {
    assert.notEqual(uninstaller.cliMain(['--uninstall', '--delete-data', '--root', 'C:\\K', '--report', report, '--yes'], { uninstall: fakeUninstall, write: () => {} }), 64);
  } finally { fs.rmSync(report, { force: true }); }
  return relocator.cliMain(['--move', '--from', 'C:\\A', '--to', 'C:\\B', '--port', '16180', '--report', report, '--yes'],
    { relocate: async () => ({ ok: false, action: 'refused', because: 'x' }), write: () => {} })
    .then((code) => {
      fs.rmSync(report, { force: true });
      assert.notEqual(code, 64);
      assert.match(method('Uninstall'), /"LEFT "/);
      assert.match(method('Uninstall'), /"NOTE "/);
      assert.match(uninstaller.reportText({ done: [], left: ['a'], notes: ['b'] }), /^LEFT a\r\nNOTE b\r\n$/);
      for (const tag of ['MOVED ', 'SAME ', 'REFUSED ']) assert.ok(offer.includes('"' + tag + '"'), 'the launcher does not read ' + tag);
      assert.match(relocator.reportText({ ok: true, action: 'moved', target: 'T' }), /^MOVED T/);
      assert.match(relocator.reportText({ ok: true, action: 'already-there', target: 'T' }), /^SAME T/);
      assert.match(relocator.reportText({ ok: false, because: 'x' }), /^REFUSED x/);
    });
});

test('W-06: the move is offered only to a real build with a person, before anything starts, in Windows\' own words', () => {
  const main = method('Main');
  const buildAt = main.indexOf('if (IsKosmosBuild(here))');
  assert.ok(buildAt > main.indexOf('if (!File.Exists(server))') && buildAt < main.indexOf('Process.Start('), 'the build check is not between the app check and the first start');
  assert.match(main, /if \(IsKosmosBuild\(here\)\)\s*\{\s*if \(showMessageBoxes && OfferToMoveOutOfATemporaryPlace\(here, node, port\)\) return 0;\s*RefreshWindowsRegistration\(here\);\s*\}/);
  assert.match(method('MoveQuestion'), /"Kosmos is running from " \+ place \+ "\. If that folder is cleaned up, Kosmos stops working\. Move Kosmos to its own folder now\?"/);
  assert.equal(constant('MoveButton'), 'Move Kosmos');
  assert.equal(constant('KeepButton'), 'Keep it here');
  const offer = method('OfferToMoveOutOfATemporaryPlace');
  assert.match(offer, /if \(answer == MoveAnswer\.Keep\) \{ RememberPlaceKept\(here\); return false; \}/, 'Keep it here is not remembered');
  assert.match(offer, /if \(place == null \|\| PlaceWasKept\(here\)\) return false;/, 'a folder already kept is asked again');
  assert.match(offer, /new ProcessStartInfo\(Path\.Combine\(target, "Kosmos\.exe"\)\)/, 'the relaunch is not the moved exe');
  assert.match(SOURCE, /FOLDERID_Downloads = new Guid\("374DE290-123F-4565-9164-39C4925E467B"\)/);
  assert.match(SOURCE, /FOLDERID_Desktop = new Guid\("B4BFCC3A-DB2C-424C-B029-7FE99A87C641"\)/);
  assert.match(SOURCE, /FOLDERID_UserProgramFiles = new Guid\("5CD7AEE2-2219-4A67-B85D-6C9CE15660CB"\)/);
  assert.match(SOURCE, /OneDriveVariables = \{ "OneDrive", "OneDriveConsumer", "OneDriveCommercial" \};/);
  assert.match(SOURCE, /\[DllImport\("shell32\.dll"\)\]\s*static extern int SHGetKnownFolderPath/, 'the Desktop is not read through the Known Folder API');
});

test('the build size counts exactly the folders the updater calls a build\'s', () => {
  const m = SOURCE.match(/static readonly string\[\] SizedFolders = \{([^}]*)\};/);
  assert.ok(m, 'SizedFolders is gone');
  const sized = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  const folders = require('./engine/win32update').ENTRIES.filter((entry) => !/\.[A-Za-z]+$/.test(entry));
  assert.deepEqual([...sized].sort(), [...folders].sort(), 'the launcher and the updater disagree about which folders a build has');
});

/* ---- the probe: the real source, compiled in scratch, pointed at test places ---- */

const PROBE_SOURCE = `
using System;
using System.IO;
using System.Linq;
class InstallerProbe {
  static string Or(string v) { return v == "-" ? null : v; }
  static int Main(string[] a) {
    switch (a[0]) {
      case "shortcut":
        KosmosLauncher.startMenuProgramsFolder = () => a[1];
        Console.Write(KosmosLauncher.RefreshStartMenuShortcut(a[2], a[3]) ?? "OK");
        return 0;
      case "unshortcut":
        KosmosLauncher.startMenuProgramsFolder = () => a[1];
        Console.Write(KosmosLauncher.RemoveStartMenuShortcut() ?? "OK");
        return 0;
      case "register":
      case "unregister":
        if (!a[1].StartsWith(@"Software\\KosmosTest\\", StringComparison.Ordinal)) { Console.Write("REFUSED a registry parent outside Software\\\\KosmosTest"); return 3; }
        KosmosLauncher.uninstallKeyParent = a[1];
        if (a[0] == "unregister") { Console.Write(KosmosLauncher.RemoveUninstallEntry() ?? "OK"); return 0; }
        Console.Write(KosmosLauncher.RegisterUninstallEntry(a[2], a[3], Or(a[4]), long.Parse(a[5])) ?? "OK");
        return 0;
      case "place":
        KosmosLauncher.downloadsFolder = () => Or(a[2]);
        KosmosLauncher.desktopFolder = () => Or(a[3]);
        KosmosLauncher.environmentVariable = (name) => name == "USERPROFILE" ? Or(a[4]) : name == "OneDrive" ? Or(a[5]) : name == "OneDriveCommercial" ? Or(a[6]) : null;
        KosmosLauncher.temporaryFolders = () => new[] { Or(a[7]) };
        Console.Write(KosmosLauncher.TemporaryPlaceOf(a[1]) ?? "(none)");
        return 0;
      case "knownfolders":
        Console.Write(KosmosLauncher.KnownFolderPath(KosmosLauncher.FOLDERID_Desktop) + "|" + KosmosLauncher.KnownFolderPath(KosmosLauncher.FOLDERID_Downloads) + "|" + KosmosLauncher.MoveTarget());
        return 0;
      case "kept":
        KosmosLauncher.keptPlacesFile = () => a[1];
        bool before = KosmosLauncher.PlaceWasKept(a[2]);
        bool remembered = KosmosLauncher.RememberPlaceKept(a[2]);
        Console.Write(before + "|" + remembered + "|" + KosmosLauncher.PlaceWasKept(a[2]) + "|" + KosmosLauncher.PlaceWasKept(a[3]) + "|" + KosmosLauncher.PlaceWasKept(a[2].ToUpperInvariant() + "\\\\"));
        return 0;
      case "manifest":
        string text = File.Exists(Path.Combine(a[1], "manifest.json")) ? File.ReadAllText(Path.Combine(a[1], "manifest.json")) : "";
        Console.Write(KosmosLauncher.IsKosmosBuild(a[1]) + "|" + KosmosLauncher.AppVersionFromManifest(text));
        return 0;
      case "size":
        Console.Write(KosmosLauncher.BuildSizeInKilobytes(a[1], a[2]));
        return 0;
      case "quote":
        Console.Write(KosmosLauncher.QuoteArgument(a[1]));
        return 0;
    }
    return 2;
  }
}
`;

let probeBuild = null;
function probe(t) {
  if (!fs.existsSync(CSC)) { t.skip('no .NET Framework compiler on this machine'); return null; }
  if (!probeBuild) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-installer-probe-'));
    fs.writeFileSync(path.join(dir, 'InstallerProbe.cs'), PROBE_SOURCE);
    const exe = path.join(dir, 'probe.exe');
    const built = spawnSync(CSC, ['/nologo', '/target:exe', '/main:InstallerProbe', '/out:' + exe, SOURCE_PATH, path.join(dir, 'InstallerProbe.cs')], { encoding: 'utf8', windowsHide: true });
    assert.equal(built.status, 0, 'the probe did not compile: ' + built.stdout + built.stderr);
    probeBuild = { dir, exe };
  }
  return (...args) => {
    const r = spawnSync(probeBuild.exe, args, { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    return { code: r.status, out: String(r.stdout || '').trim() + (r.stderr ? String(r.stderr).trim() : '') };
  };
}
test.after(() => { if (probeBuild) fs.rmSync(probeBuild.dir, { recursive: true, force: true }); });

function powershell(script) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  return String(r.stdout || '').trim();
}

/* The real per-user places, read by Windows' own API rather than from this process's (sandboxed)
   environment, and only ever LOOKED at. */
function realInstallFootprint() {
  const said = powershell([
    "$lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Kosmos.lnk'",
    "$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Kosmos'",
    'Write-Output ("{0}|{1}|{2}" -f (Test-Path -LiteralPath $lnk), (Test-Path -LiteralPath $key), (Get-Item -LiteralPath $lnk -ErrorAction SilentlyContinue).LastWriteTimeUtc.Ticks)',
  ].join('\r\n'));
  assert.match(said, /^(True|False)\|(True|False)\|\d*$/, 'could not look at the real Start menu and Apps entry: ' + said);
  return said;
}

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-installer-'));
}

test('W-20 probe: the shortcut is written into a temp Start Menu, points where it should, follows a new folder, and is removed', WINDOWS_ONLY, (t) => {
  const run = probe(t);
  if (!run) return;
  const before = realInstallFootprint();
  const base = scratch();
  try {
    const programs = path.join(base, 'Start Menu', 'Programs');
    const first = path.join(base, 'Downloads', 'kosmos-win-x64');
    const second = path.join(base, 'Programs', 'Kosmos');
    for (const folder of [first, second]) { fs.mkdirSync(folder, { recursive: true }); fs.copyFileSync(EXE_PATH, path.join(folder, 'Kosmos.exe')); }
    const lnk = path.join(programs, 'Kosmos.lnk');
    const readBack = () => powershell("$s = (New-Object -ComObject WScript.Shell).CreateShortcut('" + lnk.replace(/'/g, "''") + "'); Write-Output ($s.TargetPath + '|' + $s.WorkingDirectory + '|' + $s.IconLocation + '|' + $s.Description)");

    assert.deepEqual(run('shortcut', programs, path.join(first, 'Kosmos.exe'), first), { code: 0, out: 'OK' });
    assert.ok(fs.existsSync(lnk), 'no shortcut was written');
    assert.equal(readBack(), [path.join(first, 'Kosmos.exe'), first, path.join(first, 'Kosmos.exe') + ',0', 'Open Kosmos'].join('|'));

    /* Refreshed on every launch: an update extracted to a new folder moves the shortcut with it. */
    assert.deepEqual(run('shortcut', programs, path.join(second, 'Kosmos.exe'), second), { code: 0, out: 'OK' });
    assert.equal(readBack(), [path.join(second, 'Kosmos.exe'), second, path.join(second, 'Kosmos.exe') + ',0', 'Open Kosmos'].join('|'));

    assert.deepEqual(run('unshortcut', programs), { code: 0, out: 'OK' });
    assert.ok(!fs.existsSync(lnk), 'the shortcut is still there');
    assert.deepEqual(run('unshortcut', programs), { code: 0, out: 'OK' }, 'removing a shortcut that is already gone is not a success');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    assert.equal(realInstallFootprint(), before, 'CONTROL: the real Start menu shortcut or Apps entry changed while the probe ran');
  }
});

test('W-27b probe: the Apps entry is written under HKCU\\Software\\KosmosTest, every value read back with reg, then removed', WINDOWS_ONLY, (t) => {
  const run = probe(t);
  if (!run) return;
  const before = realInstallFootprint();
  const id = crypto.randomUUID();
  const parent = 'Software\\KosmosTest\\' + id;
  const regPath = 'HKCU\\' + parent + '\\Kosmos';
  const reg = (...args) => spawnSync('reg.exe', args, { encoding: 'utf8', windowsHide: true });
  const values = () => {
    const r = reg('query', regPath);
    if (r.status !== 0) return null;
    const got = {};
    for (const line of String(r.stdout).split(/\r?\n/)) {
      const m = /^\s{4}(\S+)\s{4}(REG_\w+)\s{4}(.*)$/.exec(line);
      if (m) got[m[1]] = m[2] + ' ' + m[3];
    }
    return got;
  };
  try {
    assert.equal(run('register', 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'C:\\K\\Kosmos.exe', 'C:\\K', '1', '1').code, 3,
      'the probe would write the REAL Uninstall key');
    const exe = 'C:\\Users\\sam\\AppData\\Local\\Programs\\Kosmos\\Kosmos.exe';
    const root = 'C:\\Users\\sam\\AppData\\Local\\Programs\\Kosmos';
    assert.deepEqual(run('register', parent, exe, root, '0.6.60', '98765'), { code: 0, out: 'OK' });
    assert.deepEqual(values(), {
      DisplayName: 'REG_SZ Kosmos',
      DisplayIcon: 'REG_SZ ' + exe,
      DisplayVersion: 'REG_SZ 0.6.60',
      InstallLocation: 'REG_SZ ' + root,
      UninstallString: 'REG_SZ "' + exe + '" --uninstall',
      QuietUninstallString: 'REG_SZ "' + exe + '" --uninstall',
      NoModify: 'REG_DWORD 0x1',
      NoRepair: 'REG_DWORD 0x1',
      EstimatedSize: 'REG_DWORD 0x181cd',
    }, 'the entry is not exactly what Settings > Apps needs (and no Publisher)');

    /* Refreshed: a version it cannot read is dropped rather than left stale. */
    assert.deepEqual(run('register', parent, exe, root, '-', '0'), { code: 0, out: 'OK' });
    const refreshed = values();
    assert.equal(refreshed.DisplayVersion, undefined, 'a stale version was kept');
    assert.equal(refreshed.EstimatedSize, undefined);

    assert.deepEqual(run('unregister', parent), { code: 0, out: 'OK' });
    assert.equal(values(), null, 'the entry is still there');
    assert.deepEqual(run('unregister', parent), { code: 0, out: 'OK' }, 'removing an entry that is already gone is not a success');
  } finally {
    reg('delete', 'HKCU\\' + parent, '/f');
    const rest = reg('query', 'HKCU\\Software\\KosmosTest');
    if (rest.status === 0 && !/HKEY_CURRENT_USER\\Software\\KosmosTest\\/.test(String(rest.stdout))) reg('delete', 'HKCU\\Software\\KosmosTest', '/f');
    assert.equal(realInstallFootprint(), before, 'CONTROL: the real Start menu shortcut or Apps entry changed while the probe ran');
  }
});

test('W-06 probe: Downloads, a redirected Desktop, OneDrive and a temporary folder are each named; anywhere else is not', WINDOWS_ONLY, (t) => {
  const run = probe(t);
  if (!run) return;
  const profile = 'C:\\ProbeUsers\\sam';
  const places = [
    /* downloads (Known Folder), desktop (Known Folder), USERPROFILE, OneDrive, OneDriveCommercial, TEMP */
    'D:\\Moved\\Downloads', profile + '\\OneDrive\\Desktop', profile, profile + '\\OneDrive', 'E:\\OneDrive - Contoso', profile + '\\AppData\\Local\\Temp',
  ];
  const placeOf = (folder) => run('place', folder, ...places).out;
  assert.equal(placeOf(profile + '\\Downloads\\kosmos-win-x64'), 'your Downloads folder', '%USERPROFILE%\\Downloads is not caught');
  assert.equal(placeOf('D:\\Moved\\Downloads\\kosmos-win-x64'), 'your Downloads folder', 'a Downloads folder moved elsewhere is not caught');
  assert.equal(placeOf(profile + '\\Downloads'), 'your Downloads folder');
  assert.equal(placeOf(profile + '\\OneDrive\\Desktop\\Kosmos'), 'your Desktop', 'a OneDrive-redirected Desktop is not named as the Desktop');
  assert.equal(placeOf(profile + '\\OneDrive\\Documents\\Kosmos'), 'your OneDrive folder');
  assert.equal(placeOf('E:\\OneDrive - Contoso\\Apps\\Kosmos'), 'your OneDrive folder', '%OneDriveCommercial% is not caught');
  assert.equal(placeOf(profile + '\\AppData\\Local\\Temp\\7zO1A2B\\Kosmos'), 'a temporary folder');
  /* CONTROLS: the right place, a sibling whose name only starts the same, and a drive root. */
  assert.equal(placeOf(profile + '\\AppData\\Local\\Programs\\Kosmos'), '(none)');
  assert.equal(placeOf(profile + '\\DownloadsArchive\\Kosmos'), '(none)', 'a sibling that merely starts with Downloads was caught');
  assert.equal(run('place', 'C:\\Tools\\Kosmos', '-', '-', '-', 'C:\\', '-', '-').out, '(none)', 'OneDrive set to a whole drive claimed every folder on it');
});

test('W-06 probe: the real Known Folder Desktop is the one Windows reports, redirected or not, and the move goes to Programs\\Kosmos', WINDOWS_ONLY, (t) => {
  const run = probe(t);
  if (!run) return;
  const [desktop, downloads, target] = run('knownfolders').out.split('|');
  const windowsSays = powershell("Write-Output ([Environment]::GetFolderPath('Desktop') + '|' + [Environment]::GetFolderPath('LocalApplicationData'))").split('|');
  assert.equal(desktop.toLowerCase(), windowsSays[0].toLowerCase(), 'the launcher reads a different Desktop than Windows reports');
  assert.ok(downloads && path.win32.isAbsolute(downloads), 'no Downloads folder: ' + downloads);
  assert.equal(target.toLowerCase(), path.win32.join(windowsSays[1], 'Programs', 'Kosmos').toLowerCase());
  t.diagnostic('Desktop on this machine: ' + desktop + (/OneDrive/i.test(desktop) ? ' (redirected by OneDrive)' : ''));
});

test('probe: Keep it here is remembered for that folder only, whatever its case or trailing slash', WINDOWS_ONLY, (t) => {
  const run = probe(t);
  if (!run) return;
  const base = scratch();
  try {
    const memory = path.join(base, 'Kosmos', 'launcher', 'kept-here.txt');
    const folder = path.join(base, 'Downloads', 'kosmos-win-x64');
    assert.equal(run('kept', memory, folder, path.join(base, 'Desktop', 'Kosmos')).out, 'False|True|True|False|True');
    assert.equal(fs.readFileSync(memory, 'utf8'), folder + '\r\n');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('probe: a real build names kosmos and win32 at the top of its manifest, and its version is Kosmos\'s, not Node\'s', WINDOWS_ONLY, (t) => {
  const run = probe(t);
  if (!run) return;
  const base = scratch();
  try {
    const write = (name, text) => { const dir = path.join(base, name); fs.mkdirSync(dir); if (text !== null) fs.writeFileSync(path.join(dir, 'manifest.json'), text); return dir; };
    assert.equal(run('manifest', write('nodeFirst', '{ "node": { "version": "v26.1.0" }, "product": "kosmos", "platform": "win32", "version": "0.6.60" }')).out, 'True|0.6.60');
    /* The build script's own shape. */
    const built = fs.readFileSync(path.join(REPO, 'tools', 'build-kosmos-windows.sh'), 'utf8').match(/cat > "\$STAGE\/manifest\.json" <<JSON\n([\s\S]*?)\nJSON/)[1]
      .replace('$ARCH', 'x64').replace('$_ver', '0.6.61').replace('$SOURCE_SHA', 'abc').replace('$SOURCE_DIRTY', 'false').replace('$NODE_VERSION', '26.1.0').replace('$NODE_SHA', 'def');
    assert.equal(run('manifest', write('buildScript', built)).out, 'True|0.6.61', 'the build script\'s manifest is not read as a real build with its version');
    assert.equal(run('manifest', write('none', null)).out, 'False|', 'a folder with no manifest is a real build');
    assert.equal(run('manifest', write('mac', '{"product":"kosmos","platform":"darwin","version":"1"}')).out, 'False|1');
    assert.equal(run('manifest', write('nested', '{"x":{"product":"kosmos","platform":"win32"}}')).out, 'False|', 'nested keys were read as the manifest\'s own');
    assert.equal(run('manifest', write('escaped', '{"product":"kos\\u006dos","platform":"win32","version":"0.6.\\"60"}')).out, 'True|0.6."60');
    assert.equal(run('manifest', write('broken', '{"product":"kosmos","platform":"win')).out, 'False|');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('probe: the size Settings > Apps shows counts the build\'s folders and the exe, never the rest of the folder', WINDOWS_ONLY, (t) => {
  const run = probe(t);
  if (!run) return;
  const base = scratch();
  try {
    const put = (rel, bytes) => { fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), Buffer.alloc(bytes)); };
    put('app\\server.js', 3000);
    put('app\\engine\\deep\\x.js', 5000);
    put('bin\\kosmos-cli.js', 1024);
    put('runtime\\node.exe', 8192);
    put('Kosmos.exe', 2048);
    put('Downloads-junk.iso', 10 * 1024 * 1024);
    put('Projects\\garden\\big.bin', 1024 * 1024);
    assert.equal(run('size', base, path.join(base, 'Kosmos.exe')).out, String(Math.ceil((3000 + 5000 + 1024 + 8192 + 2048) / 1024)));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('probe: an argument that ends in a backslash cannot escape its closing quote', WINDOWS_ONLY, (t) => {
  const run = probe(t);
  if (!run) return;
  assert.equal(run('quote', 'C:\\').out, '"C:\\\\"');
  assert.equal(run('quote', 'C:\\Users\\sam\\Kosmos').out, '"C:\\Users\\sam\\Kosmos"');
});

/* ---- the shipped exe, where it provably does nothing -------------------------- */

test('🛑 Kosmos.exe --uninstall with nobody to confirm does nothing at all, and says why', WINDOWS_ONLY, () => {
  const before = realInstallFootprint();
  const base = scratch();
  try {
    const folder = path.join(base, 'Kosmos');
    const marker = path.join(base, 'the-helper-ran');
    fs.mkdirSync(path.join(folder, 'runtime'), { recursive: true });
    fs.mkdirSync(path.join(folder, 'app', 'engine'), { recursive: true });
    fs.copyFileSync(EXE_PATH, path.join(folder, 'Kosmos.exe'));
    /* A real node and a stand-in helper that leaves a marker, so a launcher that ran it anyway
       would be caught rather than failing to start an empty file. */
    fs.copyFileSync(process.execPath, path.join(folder, 'runtime', 'node.exe'));
    fs.writeFileSync(path.join(folder, 'app', 'engine', 'win32uninstall.js'), "require('node:fs').writeFileSync(" + JSON.stringify(marker) + ", process.argv.join(' '));\n");
    const env = { ...process.env };
    delete env.PORT;
    const r = spawnSync(path.join(folder, 'Kosmos.exe'), ['--uninstall', '--console'], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, windowsHide: true, encoding: 'utf8' });
    assert.equal(r.error, undefined, 'Kosmos.exe did not run: ' + (r.error && r.error.message));
    const said = (r.stdout || '') + (r.stderr || '');
    assert.equal(r.status, 2, said);
    assert.ok(said.includes(constant('UninstallNeedsAPersonMessage').slice(0, 60)), said);
    assert.ok(!fs.existsSync(marker), 'the uninstall helper ran with nobody to confirm it');
    assert.ok(!said.includes('Starting Kosmos'), '--uninstall went on to launch Kosmos');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    assert.equal(realInstallFootprint(), before, 'CONTROL: the real Start menu shortcut or Apps entry changed');
  }
});
