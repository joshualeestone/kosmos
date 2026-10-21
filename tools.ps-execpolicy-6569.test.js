'use strict';

/**
 * #6569 (a Windows feedback report, 2026-10-19): after some Windows updates PowerShell's execution policy blocks plain
 * scripts. So every place Kosmos STARTS a PowerShell script passes a policy for that one process
 * (`-ExecutionPolicy Bypass`, which changes nothing system-wide), and this test fails if a new launch site omits it.
 *
 * Surveyed 2026-10-20, so the guard has a known subject:
 * - tools/windows/setup.ps1 starts the launcher check with `-ExecutionPolicy Bypass -File` (a real site, asserted below).
 * - Every engine call into powershell.exe passes inline code (`-Command` / `-EncodedCommand`) that loads no .ps1.
 * - Scheduled tasks run node, not PowerShell; KosmosLauncher.cs runs schtasks and node.
 * - An agent's own `kosmos` call in PowerShell loads the kosmos.ps1 shim. That is the agent's shell, not a Kosmos
 *   launch, and for the codex, gemini, grok and antigravity runners the engine gives it a process-scope
 *   PSExecutionPolicyPreference=Bypass (#3380, pinned by engine/win32launch.test.js). A claude agent is deliberately
 *   left without it (its `kosmos` runs through Git Bash, which never reads a policy; also pinned there): whether a
 *   claude agent ever runs `kosmos` from a PowerShell tool is unmeasured, and is recorded on #6569 rather than changed.
 *
 * How a launch is found (review 1 caught a line-by-line first version missing a multi-line argument array): comments
 * are stripped per file type, then every code line that starts PowerShell (powershell / pwsh / Start-Process, or the
 * -NoProfile / -NonInteractive / -Command / -EncodedCommand switches that only a PowerShell argv carries) opens a window
 * of that line and the next six. The window must also hold a real process start (STARTS_PROCESS), so a sentence telling
 * a person what to run is not a launch. It is a SCRIPT launch when it passes -File in any case or abbreviation
 * (-f, -fi, -fil, -file), names a .ps1, or calls or dot-sources a quoted path ("& '...'", ". '...'"). A script launch
 * must carry -ExecutionPolicy in the same window. Not seen, and stated so nobody reads this as full coverage: a script
 * path held only in a variable and passed to pwsh as a bare first argument (no -File, no .ps1 on the lines).
 * Release and test tooling are not scanned. tools/windows is, whole: its release scripts pass today because their
 * launches are in comments.
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

/** The text with its comments blanked (line numbers kept), by the file's own comment syntax. */
function stripComments(text, file) {
  const ext = path.extname(String(file || '')).toLowerCase();
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  if (ext === '.ps1' || ext === '.psm1') return text.replace(/<#[\s\S]*?#>/g, blank).replace(/(^|\s)#.*$/gm, (m, a) => a + ' '.repeat(m.length - a.length));
  if (ext === '.cmd' || ext === '.bat') return text.replace(/^\s*(rem\b|::).*$/gim, blank);
  if (ext === '.vbs') return text.replace(/'.*$/gm, blank);
  if (ext === '.sh' || ext === '') return text.replace(/^\s*#.*$/gm, blank);
  // js, cs: block comments, then line comments that start a line (a // inside a string or URL is left alone)
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^\s*\/\/.*$/gm, blank);
}

const STARTS_PS = /powershell(\.exe)?\b|\bpwsh(\.exe)?\b|Start-Process|-NoProfile\b|-NonInteractive\b|-EncodedCommand\b|['"`\s]-Command\b/i;
const SCRIPT = /(^|[\s'"`(@,])-f(i|il|ile)?(?=['"`\s,)]|$)|\.ps1\b|[&.]\s+['"`]/im;
const POLICY = /-ExecutionPolicy\b/i;
/* Something that actually starts a process, so a sentence that TELLS a person to run PowerShell (an error message, a
   printed usage line) is not taken for a launch: a child_process call, .NET's Process.Start, PowerShell's
   Start-Process / & / Invoke-Expression, or a line of a .cmd, .bat or .sh that IS the powershell command. */
const STARTS_PROCESS = /\b(spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\s*\(|Process\.Start\b|Start-Process\b|Invoke-Expression\b|(^|[;|(]\s*)&\s|^\s*(@?\s*)?(call\s+)?(start\s+("[^"]*"\s+)?)?(powershell|pwsh)(\.exe)?\b/im;
const WINDOW = 7;

/** Every script launch in a file's text, as { line, text, policy }. */
function launchSites(text, file = 'x.js') {
  const lines = stripComments(text, file).split(/\r?\n/);
  const out = [];
  let coveredTo = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (i <= coveredTo || !STARTS_PS.test(lines[i])) continue;
    const win = lines.slice(i, i + WINDOW).join('\n');
    if (!SCRIPT.test(win) || !STARTS_PROCESS.test(win)) continue;
    out.push({ line: i + 1, text: lines[i].trim(), policy: POLICY.test(win) });
    coveredTo = i + WINDOW - 1;
  }
  return out;
}

test('#6569: every PowerShell script Kosmos starts passes an explicit per-process execution policy', () => {
  const files = runtimeFiles();
  assert.ok(files.length > 100, 'control: the runtime files were found (' + files.length + ')');
  const sites = []; const bare = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const s of launchSites(text, f)) {
      const at = path.relative(ROOT, f) + ':' + s.line;
      sites.push(at);
      if (!s.policy) bare.push(at + '  ' + s.text.slice(0, 160));
    }
  }
  assert.ok(sites.some((s) => s.startsWith(path.join('tools', 'windows', 'setup.ps1') + ':')),
    'control: the scan found the known launch site in tools/windows/setup.ps1 (found: ' + sites.join(', ') + ')');
  assert.deepEqual(bare, [], 'these start a PowerShell script with no -ExecutionPolicy; add -ExecutionPolicy Bypass (per process, nothing system-wide)');
});

test('#6569 CONTROL: the scan flags each planted launch with no policy, and passes the same launch with one', () => {
  const planted = [
    ["  cp.spawn('powershell.exe', ['-NoProfile', '-File', helper]);", 'x.js'],
    ["  cp.spawn('powershell.exe', [\n    '-NoProfile',\n    '-File', helper,\n  ]);", 'x.js'],                 // review 1: multi-line
    ["  cp.spawn('powershell.exe', ['-NoProfile', '-file', helper]);", 'x.js'],                                // review 1: any case
    ["  cp.spawn(ps, ['-NoProfile', '-f', helper]);", 'x.js'],                                                  // review 1: abbreviated
    ["  execFile(ps, ['-NoProfile', '-Command', \"& 'C:\\\\k\\\\helper.ps1'\"]);", 'x.js'],                    // review 1: a script inside -Command
    ["  execFile(ps, ['-NoProfile', path.join(dir, 'helper.ps1')]);", 'x.js'],
    ["  Start-Process powershell -ArgumentList @(\n    '-NoProfile',\n    '-File', \"`\"$x`\"\")", 'x.ps1'],
    ['  powershell.exe -NoProfile -File "%~dp0helper.ps1"', 'x.cmd'],
  ];
  for (const [t, file] of planted) {
    const s = launchSites(t, file);
    assert.equal(s.length, 1, 'not seen as a launch: ' + t);
    assert.equal(s[0].policy, false, 'read as having a policy: ' + t);
    const fixed = launchSites(t.replace('-NoProfile', '-NoProfile -ExecutionPolicy Bypass'), file);
    assert.equal(fixed.length, 1);
    assert.equal(fixed[0].policy, true, 'a launch WITH a policy was flagged: ' + t);
  }
  assert.deepEqual(launchSites("  execFile(ps, ['-NoProfile', '-NonInteractive', '-Command', script]);"), [], 'inline -Command code with no script is not a launch');
  assert.deepEqual(launchSites("  // powershell -File kosmos.ps1 hangs on an open stdin"), [], 'a comment is not a launch');
  assert.deepEqual(launchSites("  /* powershell -File kosmos.ps1\n     hangs */"), [], 'a block comment is not a launch');
  assert.deepEqual(launchSites("# powershell -File kosmos.ps1", 'x.ps1'), [], 'a PowerShell comment is not a launch');
  assert.deepEqual(launchSites('  Say "  pwsh tools/windows/publish-r2.ps1 -Zip $Zip"', 'x.ps1'), [], 'a printed usage line is not a launch');
  assert.deepEqual(launchSites("  ctx.err('run powershell -File setup.ps1 to repair it');"), [], 'an error message is not a launch');
});
