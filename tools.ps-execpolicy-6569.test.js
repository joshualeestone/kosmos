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
 * How a launch is found: by CENSUS, not by guessing which lines start PowerShell. Two reviews showed a pattern for
 * "a PowerShell start" always has holes (an args array built lines before the spawn, the executable in a variable, two
 * launches a few lines apart sharing one verdict, `start /b`). So every code line (comments stripped per file type)
 * that names a script, by a -File argument (-fi, -fil, -file, any case, quoted or bare) or a .ps1, must either carry
 * -ExecutionPolicy ON THE SAME LINE or be listed in REVIEWED below with why it is not a launch. A new reference
 * anywhere fails until someone has looked at it; an args array split over lines is flagged too, which is the safe
 * direction (put the policy beside -File, or list it). Not counted, and stated so nobody reads this as full coverage:
 * the one-letter abbreviation -f (it would take in tmux's -f / -F on nine lines today, and nothing here writes -f for
 * -File), and a script path held only in a variable with no -File and no .ps1 on any line.
 * Release and test tooling are not scanned, except tools/windows, which is, whole.
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
  const bin = walk(path.join(ROOT, 'bin'), (p) => !isTest(p));   // review 3: the supervisor, watchdog and report bridges ship
  return [...top, ...engine, ...windows, ...install, ...bin];
}

/** JS / C# comments blanked by a small tokenizer that knows strings, templates (with ${} inside) and escapes, so a "/*"
    inside a string ('Read(**\/*.pem)') never opens a comment. Review 3: a plain block-comment pattern did, and hid dozens
    of real lines, a planted launch among them. Newlines are kept, so line numbers hold. Regex literals are not tracked;
    an escaped slash is skipped. Checked against acorn's own comment ranges over all 347 runtime JS files (review 4): it
    blanks no code today. NOT covered, so nobody reads this as full coverage: a regex whose character class holds an
    unescaped "/*" (/[/*]/ is valid JS) opens a false comment and hides the lines after it until the next "*\/"; and a
    backtick inside a regex inverts template state for the rest of that line. Neither occurs in the tree. */
function stripJsComments(text) {
  let out = '';
  const stack = ['code'];   // code | sq | dq | tpl | line | block
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]; const n = text[i + 1]; const st = stack[stack.length - 1];
    const keep = (ch) => { out += ch; };
    const blank = (ch) => { out += ch === '\n' ? '\n' : ' '; };
    if (st === 'line') { if (c === '\n') { stack.pop(); keep(c); } else blank(c); continue; }
    if (st === 'block') { if (c === '*' && n === '/') { stack.pop(); blank(c); blank(n); i += 1; } else blank(c); continue; }
    if (c === '\\' && st !== 'code') { keep(c); if (n !== undefined) keep(n); i += 1; continue; }
    if (st === 'sq') { keep(c); if (c === "'" || c === '\n') stack.pop(); continue; }
    if (st === 'dq') { keep(c); if (c === '"' || c === '\n') stack.pop(); continue; }
    if (st === 'tpl') {
      if (c === '`') { stack.pop(); keep(c); continue; }
      if (c === '$' && n === '{') { stack.push('code'); keep(c); keep(n); i += 1; continue; }
      keep(c); continue;
    }
    // code
    if (c === '/' && n === '/') { stack.push('line'); blank(c); continue; }
    if (c === '/' && n === '*') { stack.push('block'); blank(c); blank(n); i += 1; continue; }
    if (c === '\\') { keep(c); if (n !== undefined) keep(n); i += 1; continue; }
    if (c === "'") { stack.push('sq'); keep(c); continue; }
    if (c === '"') { stack.push('dq'); keep(c); continue; }
    if (c === '`') { stack.push('tpl'); keep(c); continue; }
    if (c === '}' && stack.length > 1) { stack.pop(); keep(c); continue; }   // the end of a template's ${...}
    if (c === '{' && stack.length > 1) { stack.push('code'); keep(c); continue; }
    keep(c);
  }
  return out;
}

/** The text with its comments blanked (line numbers kept). JS and C# by the tokenizer above; PowerShell, .cmd, .bat, .vbs
    and shell by whole comment lines (a comment after code on the same line is left in, which can only flag more). */
function stripComments(text, file) {
  const ext = path.extname(String(file || '')).toLowerCase();
  if (ext === '.js' || ext === '.cs' || ext === '.mjs' || ext === '.cjs') return stripJsComments(text);
  const ps = ext === '.ps1' || ext === '.psm1';
  let inPsBlock = false;
  return text.split(/\r?\n/).map((t) => {
    const u = t.trim();
    if (ps) {
      if (inPsBlock) { if (/#>\s*$/.test(u)) inPsBlock = false; return ''; }
      if (u.startsWith('<#')) { inPsBlock = !/#>\s*$/.test(u); return ''; }
      return u.startsWith('#') ? '' : t;
    }
    if (ext === '.cmd' || ext === '.bat') return /^(rem\b|::)/i.test(u) ? '' : t;
    if (ext === '.vbs') return u.startsWith("'") ? '' : t;
    if (ext === '.sh' || ext === '') return u.startsWith('#') ? '' : t;
    return t;
  }).join('\n');
}

/* Review 3: the policy must be Bypass (AllSigned or Restricted still block the script, which is this card's failure), and
   a trailing // comment's text does not count. */
const POLICY = /-ExecutionPolicy['"`]?\s*,?\s*['"`]?Bypass\b/i;
const codePart = (t) => t.replace(/\s\/\/[^'"`]*$/, '');
const NAMES_SCRIPT = /(['"`])-fi(l|le)?\1|(['"`])-file\3|(^|[\s(@,])-fil?e?\b(?=\s|$)|\.ps1\b/i;

/* Lines that name a script and are NOT a launch, matched by file and the line's own trimmed text (not its number, so an
   edit elsewhere in the file does not break the match). Each says why. */
const REVIEWED = [
  ['engine/reporthook.js', "const spellings = plat === 'win32' && !/\\.[A-Za-z0-9]+$/.test(bin) ? [bin, bin + '.exe', bin + '.cmd', bin + '.ps1'] : [bin];", 'looks at which spellings of a CLI exist; a .ps1 is never run (its version is left unknown)'],
  ['engine/startimports.js', "'.ps1', '.bat', '.cmd', '.env', '.ini', '.cfg', '.conf', '.config', '.properties', '.sql', '.graphql', '.gql', '.proto', '.vue',", 'a list of file extensions an import may carry, not a launch'],
  ['engine/win32signin.js', "const SCRIPT_EXTENSIONS = Object.freeze(['.cmd', '.bat', '.ps1']);", 'the scripts a direct start cannot be, so they are refused, not run'],
  ['engine/win32update.js', "'bin/kosmos.ps1',", 'a file the update must contain; it is checked, not run'],
  ['tools/windows/publish-r2.ps1', 'Say "  pwsh tools/windows/publish-r2.ps1 -Zip $Zip   [-Sig <the .sig file, if it was sent rather than uploaded>]"', 'a printed usage line on the release PC, not a launch'],
  ['tools/windows/publish-r2.ps1', 'Say "  pwsh tools/windows/publish-r2.ps1 -Promote -ApprovedVersion <v from his go> -ApprovedSha <sha from his go> -ApprovalRef <his message\'s Slack ts or permalink>"', 'a printed usage line on the release PC, not a launch'],
];
const reviewed = (rel, text) => REVIEWED.some(([f, t]) => f === rel && t === text);   // review 3: always the exact line, never a whole file

/** Every code line in a file's text that names a script, as { line, text, policy }. */
function launchSites(text, file = 'x.js') {
  const out = [];
  stripComments(text, file).split(/\r?\n/).forEach((t, i) => {
    if (NAMES_SCRIPT.test(t)) out.push({ line: i + 1, text: t.trim(), policy: POLICY.test(codePart(t)) });
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
    for (const s of launchSites(text, f)) {
      const at = path.relative(ROOT, f) + ':' + s.line;
      sites.push(at);
      if (!s.policy && !reviewed(path.relative(ROOT, f).split(path.sep).join('/'), s.text)) bare.push(at + '  ' + s.text.slice(0, 160));
    }
  }
  assert.ok(sites.some((s) => s.startsWith(path.join('tools', 'windows', 'setup.ps1') + ':')),
    'control: the scan found the known launch site in tools/windows/setup.ps1 (found: ' + sites.join(', ') + ')');
  assert.deepEqual(bare, [], 'these lines name a PowerShell script with no -ExecutionPolicy on the line. A launch: add -ExecutionPolicy Bypass beside -File (per process, nothing system-wide). Not a launch: list it in REVIEWED with why');
});

test('#6569 CONTROL: each planted launch with no policy is flagged, the same launch with one is not', () => {
  const planted = [
    ["  cp.spawn('powershell.exe', ['-NoProfile', '-File', helper]);", 'x.js'],
    ["  cp.spawn('powershell.exe', [\n    '-NoProfile',\n    '-File', helper,\n  ]);", 'x.js'],                 // review 1: multi-line
    ["  cp.spawn('powershell.exe', ['-NoProfile', '-file', helper]);", 'x.js'],                                // review 1: any case
    ["  cp.spawn(ps, ['-NoProfile', '-fil', helper]);", 'x.js'],                                                // review 1: abbreviated
    ["  execFile(ps, ['-NoProfile', '-Command', \"& 'C:\\\\k\\\\helper.ps1'\"]);", 'x.js'],                    // review 1: inside -Command
    ["  const args = ['-NoProfile', '-File', script];\n  // ...\n  cp.spawn('powershell.exe', args);", 'x.js'],   // review 2: args built earlier
    ["  cp.spawn(PS, ['-File', script]);", 'x.js'],                                                             // review 2: executable in a variable
    ['  start "" /b powershell -NoProfile -File x.ps1', 'x.cmd'],                                                  // review 2: start /b
    ["  Start-Process powershell -ArgumentList @(\n    '-NoProfile',\n    '-File', \"`\"$x`\"\")", 'x.ps1'],
    ['  cp.exec(`powershell -NoProfile -File ${helper}`);', 'x.js'],
  ];
  for (const [t, file] of planted) {
    const bare = launchSites(t, file).filter((x) => !x.policy);
    assert.ok(bare.length >= 1, 'not flagged: ' + t);
    const fixed = t.replace("'-File'", "'-ExecutionPolicy', 'Bypass', '-File'").replace("'-file'", "'-ExecutionPolicy', 'Bypass', '-file'")
      .replace("'-fil'", "'-ExecutionPolicy', 'Bypass', '-fil'").replace(' -File', ' -ExecutionPolicy Bypass -File')
      .replace("'-Command'", "'-ExecutionPolicy', 'Bypass', '-Command'");
    assert.deepEqual(launchSites(fixed, file).filter((x) => !x.policy), [], 'a launch WITH a policy beside its script was flagged: ' + fixed);
  }
  // review 2: two launches a few lines apart each get their own verdict
  const two = launchSites("if (a) spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', a]);\nelse spawn('powershell.exe', ['-File', b]);");
  assert.deepEqual(two.map((x) => x.policy), [true, false], 'the bare launch beside a compliant one passed');
  assert.deepEqual(launchSites("  execFile(ps, ['-NoProfile', '-NonInteractive', '-Command', script]);"), [], 'inline -Command code that names no script is not a launch');
  assert.deepEqual(launchSites("  tmux(['-f', '/dev/null', 'list-panes', '-a', '-F', fmt]);"), [], "tmux's -f / -F is not -File");
  assert.deepEqual(launchSites("  // powershell -File kosmos.ps1 hangs on an open stdin"), [], 'a comment is not a launch');
  assert.deepEqual(launchSites("  /* powershell -File kosmos.ps1\n     hangs */"), [], 'a block comment is not a launch');
  assert.deepEqual(launchSites("# powershell -File kosmos.ps1", 'x.ps1'), [], 'a PowerShell comment is not a launch');
  // review 3: a "/*" inside a string must not hide the launch after it
  const glob = launchSites("const rules = ['Read(**/*.pem)'];\ncp.spawn('powershell.exe', ['-NoProfile', '-File', helper]);\nconst more = ['Edit(**/x/**)'];");
  assert.deepEqual(glob.map((x) => x.policy), [false], 'a launch after a /* inside a string was hidden');
  assert.deepEqual(launchSites("Say 'step #2'; Start-Process powershell -ArgumentList '-File', $x", 'x.ps1').map((x) => x.policy), [false], 'a # inside a PowerShell string hid the launch');
  assert.deepEqual(launchSites("spawn(ps, ['-File', x]); // no -ExecutionPolicy Bypass here").map((x) => x.policy), [false], 'a policy written in a trailing comment counted');
  assert.deepEqual(launchSites("spawn(ps, ['-ExecutionPolicy', 'AllSigned', '-File', x]);").map((x) => x.policy), [false], 'AllSigned counted as a policy that lets the script run');
  assert.deepEqual(launchSites("spawn(ps, ['-ExecutionPolicy', 'Bypass', '-File', x]);").map((x) => x.policy), [true], 'control: Bypass in the argv counts');
  assert.deepEqual(launchSites('  <#\n  powershell -File kosmos.ps1\n  #>', 'x.ps1'), [], 'a PowerShell block comment is not a launch');
  assert.equal(reviewed('engine/win32update.js', "'bin/kosmos.ps1',"), true, 'control: a reviewed line is recognised');
  assert.equal(reviewed('engine/win32update.js', "cp.spawn('powershell.exe', ['-File', 'bin/kosmos.ps1']);"), false, 'a new line in a reviewed file is not excused by the file');
});
