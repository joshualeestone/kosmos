'use strict';

/**
 * #6569 (a Windows feedback report, 2026-10-19): after some Windows updates PowerShell's execution policy blocks plain
 * scripts. So every place Kosmos STARTS a PowerShell script passes a policy for that one process
 * (`-ExecutionPolicy Bypass`, which changes nothing system-wide), and this test fails if a new launch site omits it.
 *
 * Surveyed 2026-10-20, so the guard has a known subject:
 * - tools/windows/setup.ps1 starts the launcher check with `-ExecutionPolicy Bypass -File` (a real site, asserted below).
 * - Every engine call into powershell.exe passes inline code (`-Command` / `-EncodedCommand`), which the script policy
 *   does not govern, and starts no .ps1.
 * - An agent's own `kosmos` call in PowerShell loads the kosmos.ps1 shim; that is covered by the process-scope
 *   PSExecutionPolicyPreference=Bypass the engine gives the PowerShell runners (#3380, pinned by
 *   engine/win32launch.test.js and three others), not by an argument, so it is not this test's subject.
 * - Scheduled tasks run node, not PowerShell.
 *
 * A launch site is a non-comment line in a file Kosmos runs that passes `-File` as an argument, or that names a .ps1
 * on a line which also starts PowerShell. Release and test tooling (run by hand on the release PC, or by the suite) is
 * not scanned: it is not something a person's computer runs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;

function walk(dir, keep, out = []) {
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of names) {
    if (d.name === 'node_modules' || d.name.startsWith('.')) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

const isTest = (p) => /\.test\.js$/.test(p);
/** The files a person's computer runs. */
function runtimeFiles() {
  const top = fs.readdirSync(ROOT).filter((n) => /\.js$/.test(n) && !isTest(n)).map((n) => path.join(ROOT, n));
  const engine = walk(path.join(ROOT, 'engine'), (p) => /\.js$/.test(p) && !isTest(p));
  const windows = walk(path.join(ROOT, 'tools', 'windows'), (p) => /\.(js|ps1|psm1|cs|cmd|bat|vbs|sh)$/i.test(p));
  const install = walk(path.join(ROOT, 'install'), (p) => !/\.(png|icns|jpg|gif|zip|plist)$/i.test(p));
  return [...top, ...engine, ...windows, ...install];
}

const COMMENT = /^\s*(\/\/|\/\*|\*|#|<#|REM\b|rem\b|::|')/;
const FILE_ARG = /(['"`])-File\1|(^|[\s@(,])-File(?=[\s"'`])/;
const STARTS_PS = /powershell(\.exe)?\b|pwsh(\.exe)?\b|-NoProfile|-NonInteractive/i;
const NAMES_PS1 = /\.ps1\b/i;

/** Every launch site in some text, as { line, text, policy }. */
function launchSites(text) {
  const out = [];
  text.split(/\r?\n/).forEach((t, i) => {
    if (COMMENT.test(t)) return;
    const site = FILE_ARG.test(t) || (STARTS_PS.test(t) && NAMES_PS1.test(t) && /(['"`])-(Command|EncodedCommand)\1|\s-(Command|EncodedCommand)\s|-File/.test(t) === false && /\bspawn|execFile|exec\(|Start-Process|ArgumentList|&\s/.test(t));
    if (site) out.push({ line: i + 1, text: t.trim(), policy: /-ExecutionPolicy\b/i.test(t) });
  });
  return out;
}

test('#6569: every PowerShell script Kosmos starts passes an explicit per-process execution policy', () => {
  const files = runtimeFiles();
  assert.ok(files.length > 100, 'control: the runtime files were found (' + files.length + ')');
  const sites = []; const bare = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const s of launchSites(text)) {
      const at = path.relative(ROOT, f) + ':' + s.line;
      sites.push(at);
      if (!s.policy) bare.push(at + '  ' + s.text.slice(0, 160));
    }
  }
  assert.ok(sites.some((s) => s.startsWith(path.join('tools', 'windows', 'setup.ps1') + ':')),
    'control: the scan found the known launch site in tools/windows/setup.ps1 (found: ' + sites.join(', ') + ')');
  assert.deepEqual(bare, [], 'these start a PowerShell script with no -ExecutionPolicy; add -ExecutionPolicy Bypass (per process, nothing system-wide)');
});

test('#6569 CONTROL: the scan flags a planted launch with no policy, and passes the same launch with one', () => {
  const planted = [
    "  cp.spawn('powershell.exe', ['-NoProfile', '-File', helper]);",
    "  Start-Process powershell -ArgumentList @('-NoProfile', '-File', \"`\"$x`\"\")",
    '  powershell.exe -NoProfile -File "%~dp0helper.ps1"',
    "  execFile(ps, ['-NoProfile', path.join(dir, 'helper.ps1')]);",
  ];
  for (const t of planted) {
    const s = launchSites(t);
    assert.equal(s.length, 1, 'not seen as a launch: ' + t);
    assert.equal(s[0].policy, false, 'read as having a policy: ' + t);
    const fixed = launchSites(t.replace('-NoProfile', '-NoProfile -ExecutionPolicy Bypass').replace("'-NoProfile',", "'-NoProfile', '-ExecutionPolicy', 'Bypass',"));
    assert.equal(fixed.length, 1);
    assert.equal(fixed[0].policy, true, 'a launch WITH a policy was flagged: ' + t);
  }
  assert.deepEqual(launchSites("  execFile(ps, ['-NoProfile', '-NonInteractive', '-Command', script]);"), [], 'inline -Command code is not a script launch');
  assert.deepEqual(launchSites("  // powershell -File kosmos.ps1 hangs on an open stdin"), [], 'a comment is not a launch');
});
