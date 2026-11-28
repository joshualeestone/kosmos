'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9254: a test browser must never read the person's login keychain. On 2026-11-27 a Chrome for Testing asked
 * for "Chromium Safe Storage", and the dialog reached the person. What launched that browser is not covered by any
 * record we hold, so this guard does not prove that launch is fixed: it keeps this repo's own launches from being one.
 *
 * Playwright adds --use-mock-keychain and --password-store=basic to every Chromium it launches (measured on this Mac:
 * the browser process carries both, and securityd logs no request), so the danger is a launch that turns those
 * defaults off, or one that runs a test browser binary itself. This reads the repo's tracked source as text and
 * refuses both shapes. The person's own Google Chrome is left alone (see RUN_ARMS).
 *
 * What text can show, stated: a launch's ignoreDefaultArgs (the JavaScript spelling) wherever the name appears, and a
 * test browser run named by a literal path, app name or bundle id, as a shell string or an argv list. A path held only
 * in a variable cannot be seen: engine/agentbrowser.js runs the headless shell that way (execP(exe, ['--version']),
 * which exits before any keychain read). A .py file is read for direct runs only (Python's ignore_default_args is
 * not matched; nothing here drives Playwright from Python). The MCP config the repo writes is pinned by
 * engine/agentbrowser.test.js. The fleet rule proposed on the card covers what no repo scan can.
 *
 *   node --test browser-launch-keychain-9254.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/* Every tracked source file, by git (so a new folder is read without listing it): .js .mjs .cjs .ts .sh .py .ps1 .swift,
   and the extensionless scripts in bin/, install/ and tools/. Not this file, whose controls name the bad shapes. */
const SRC = /\.(js|mjs|cjs|ts|sh|py|ps1|swift)$/;
const SELF = path.basename(__filename);
function files() {
  const listed = require('node:child_process').execFileSync('git', ['-C', __dirname, 'ls-files', '-z'], { maxBuffer: 64 * 1024 * 1024 })
    .toString().split('\0').filter(Boolean);
  return listed
    .filter((f) => !f.split('/').includes('node_modules') && f !== SELF)
    .filter((f) => SRC.test(f) || /^(?:bin|install|tools)\/[^.]+$/.test(f))
    .map((f) => path.join(__dirname, f))
    .filter((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
}

/* Switches a launch may drop: neither touches the keychain. */
const SAFE_DROPS = new Set(['--hide-scrollbars', '--enable-automation']);
const STR = String.raw`(?:'[^'\\]*'|"[^"\\]*")`;
const LIST = String.raw`\[\s*(?:${STR}\s*,\s*)*(?:${STR}\s*)?\]`;
/* A safe value is ONLY a literal list of strings, or a ternary choosing between two such lists. */
const SAFE_SHAPE = new RegExp(String.raw`^\s*(?:${LIST}|[^?\[\]]*\?\s*${LIST}\s*:\s*${LIST})\s*$`);
/* Each place the name appears, and the value given there (or null where none can be read: shorthand, a spread of an
   options object, a name passed along). Brackets and parentheses are counted, so a multi-line value is read whole. */
function dropValues(src) {
  const out = [];
  const re = /ignoreDefaultArgs/g;
  let m;
  while ((m = re.exec(src))) {
    const rest = src.slice(m.index + m[0].length);
    const head = /^['"\]]*\s*(:|=(?!=))/.exec(rest);
    if (!head) { out.push(null); continue; }
    let i = m.index + m[0].length + head[0].length;
    const start = i;
    let depth = 0;
    let quote = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
      else if ((c === ',' || c === ';') && depth === 0) break;
      // A newline ends the value unless the next line goes on with it (a ternary's ? or :, or a call on the list).
      else if (c === '\n' && depth === 0 && !/^\s*[?:.]/.test(src.slice(i + 1, i + 40))) break;
    }
    out.push(src.slice(start, i));
  }
  return out;
}
function unsafeDrop(value) {
  if (value === null) return true;
  const v = value.replace(/[!=]==?\s*(['"])[^'"]*\1/g, '');   // a comparison in a ternary's condition chooses a list
  if (!SAFE_SHAPE.test(v)) return true;
  const strs = [...v.matchAll(/'([^'\\]*)'|"([^"\\]*)"/g)].map((x) => x[1] !== undefined ? x[1] : x[2]);
  return strs.some((x) => !SAFE_DROPS.has(x));
}
/* Playwright's own internal field for every default off (its client turns ignoreDefaultArgs: true into it, and
   launchServer passes it through); not in its typed API, so only code reaching past the API would write it. */
const DEFAULTS_OFF = /ignoreAllDefaultArgs\s*:\s*true|ignoreAllDefaultArgs\s*=(?!=)/;
/* Running a TEST browser (Chrome for Testing, Chromium, the headless shell) itself, not through Playwright's launch.
   The person's own Google Chrome is not one: it already has its own keychain access, and a mock keychain against their
   profile would only lose their saved logins, so `open -a "Google Chrome" <url>` is fine. Case-insensitive; the
   keychain switch must be on the same call (that line or the three after it). */
const TEST_BROWSER = String.raw`(?:(?:google )?chrome for testing|chromium|chrome-headless-shell|org\.chromium|com\.google\.chrome\.for\.testing)`;
const ROOTED = String.raw`(?:\/|\$HOME\/|\$\{HOME\}\/|~\/)`;   // a path from the root or the home folder
const RUN_ARMS = [
  String.raw`contents\/macos\/${TEST_BROWSER}`,                                            // the binary inside an app
  String.raw`['"]contents['"]\s*,\s*['"]macos['"]\s*,\s*['"]${TEST_BROWSER}`,               // the same, by path.join
  String.raw`\b(?:spawn|execFile|exec)(?:Sync)?\(\s*[^)\n]*chrome-headless-shell\b`,       // the headless shell run
  String.raw`\b(?:spawn|execFile|exec)(?:Sync)?\(\s*[\w.]*executablePath\(\)`,             // Playwright's own binary, run raw
  String.raw`\bopen\s+(?:-[a-z]+\s+)*-[a-z]*[ab][a-z]*\s+\\?["']?(?:${ROOTED}[^"'\\]*\/)?${TEST_BROWSER}`,   // open -a/-b an app
  String.raw`\bopen\s+(?:-[a-z]+\s+)*\\?["']?${ROOTED}[^"'\\\n]*${TEST_BROWSER}[^"'\\\n]*\.app`,   // open a .app by its path (prose is neither)
  String.raw`['"](?:[^'"\s]*\/)?open['"]\s*,\s*\[[^\]]*?['"](?:${ROOTED}[^'"]*\/)?${TEST_BROWSER}`,   // its argv form, open or /usr/bin/open
];
const RUNS_CHROME = new RegExp(RUN_ARMS.join('|'), 'i');
/* A shell's escaped space (Google\ Chrome\ for\ Testing) is read as the space it stands for. */
const runsChrome = (line) => RUNS_CHROME.test(line.replace(/\\ /g, ' '));

function offenders(list) {
  const bad = [];
  for (const f of list) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(__dirname, f) || f;
    if (DEFAULTS_OFF.test(src)) bad.push(rel + ': turns every default switch off (ignoreAllDefaultArgs)');
    for (const v of dropValues(src)) if (unsafeDrop(v)) bad.push(rel + ': ignoreDefaultArgs drops more than a safe switch: ' + (v === null ? '(no value it can read)' : v.trim().slice(0, 80)));
    const lines = src.split('\n');
    lines.forEach((l, i) => {
      if (runsChrome(l) && !lines.slice(i, i + 4).join('\n').includes('--use-mock-keychain')) bad.push(rel + ':' + (i + 1) + ': runs a Chrome binary without --use-mock-keychain');
    });
  }
  return bad;
}

test('#9254: every rule fires on the shape it names, and not on the safe shapes (controls)', () => {
  const unsafe = (code) => dropValues(code).some(unsafeDrop);
  assert.ok(unsafe("launch({ ignoreDefaultArgs: true })"), 'true');
  assert.ok(unsafe("launch({ ignoreDefaultArgs: x })"), 'a variable');
  assert.ok(unsafe("launch({ 'ignoreDefaultArgs': ['--use-mock-keychain'] })"), 'a quoted key');
  assert.ok(unsafe("launch({ ignoreDefaultArgs: [\n  '--hide-scrollbars',\n  '--use-mock-keychain',\n] })"), 'a multi-line array');
  assert.ok(unsafe("launch({ ignoreDefaultArgs: [...ALL] })"), 'a spread');
  assert.ok(unsafe("launch({ ignoreDefaultArgs: ['--hide-scrollbars', '--password-store=basic'] })"), 'a keychain switch beside a safe one');
  assert.ok(DEFAULTS_OFF.test('launch({ ignoreAllDefaultArgs: true })'));
  assert.ok(unsafe("launch({ ignoreDefaultArgs: ['--hide-scrollbars', x] })"), 'a bare name in the list');
  assert.ok(unsafe("launch({ ignoreDefaultArgs: a ? ['--hide-scrollbars'] : ALL })"), 'a ternary with a variable arm');
  assert.ok(unsafe("launch({ ignoreDefaultArgs: ['--hide-scrollbars'].concat(EXTRA) })"), 'a list extended by a call');
  assert.ok(unsafe("launch({ ignoreDefaultArgs })"), 'shorthand');
  assert.ok(unsafe("opts.ignoreDefaultArgs = ['--use-mock-keychain'];"), 'an assignment');
  assert.ok(unsafe("launch({ ignoreDefaultArgs: cond ? ['--hide-scrollbars']\n  : true })"), 'a ternary whose second arm is on the next line');
  assert.ok(unsafe("launch({ ignoreDefaultArgs: ['--hide-scrollbars']\n  .concat(['--use-mock-keychain']) })"), 'a call on the next line');
  assert.ok(unsafe("launch({ ignoreDefaultArgs: cond ? ['--hide-scrollbars'] })"), 'a ternary with one arm');
  assert.ok(!unsafe("x.ignoreDefaultArgs = ['--hide-scrollbars']; launch(x);"), 'a safe assignment ended by a semicolon');
  assert.ok(!unsafe("x.ignoreDefaultArgs = ['--hide-scrollbars']\nlaunch(x)"), 'a safe assignment ended by a newline');
  assert.ok(!unsafe("launch({ ignoreDefaultArgs: wide\n    ? ['--hide-scrollbars']\n    : [] })"), 'a ternary written across lines');
  assert.ok(!unsafe("launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })"), 'one safe switch');
  assert.ok(!unsafe("launch({ ignoreDefaultArgs: eng === 'chromium' ? ['--hide-scrollbars'] : [] })"), 'a ternary of safe lists');
  assert.ok(!unsafe("launch({ ignoreDefaultArgs: ['--enable-automation'], args: ['--x'] })"), 'the next property is not read as the value');
  for (const l of ['spawn("/x/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")', 'open -na "Google Chrome for Testing" --args --new-window',
    "open -a 'chromium'", 'open -b com.google.chrome.for.testing', 'open -a /Applications/Chromium.app/', "execFile('/x/chrome-headless-shell', [])",
    "spawnSync('/x/chrome-headless-shell', [])", "exec('/x/chrome-headless-shell --version')", 'open -b org.chromium.Chromium',
    'run("/x/Chromium.app/Contents/MacOS/Chromium")', 'execSync("open -a \\"Google Chrome for Testing\\" https://x")',
    "execFileSync('open', ['-a', 'Google Chrome for Testing', '--args', '--new-window'])", "spawn('open', ['-na', '/Applications/Chromium.app'])",
    'open "/x/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app"', "spawn('open', ['/x/Google Chrome for Testing.app'])",
    "spawn(path.join(dir, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'), [])",
    'spawn(chromium.executablePath(), ["--headless"])', "spawn('/usr/bin/open', ['-a', 'Chromium'])",
    'open "$HOME/Library/Caches/ms-playwright/chromium-1200/chrome-mac-arm64/Google Chrome for Testing.app"',
    'open ~/Library/Caches/ms-playwright/chromium-1200/chrome-mac-arm64/Google\\ Chrome\\ for\\ Testing.app',
    'open -a "${HOME}/x/Google Chrome for Testing.app" --args --x']) {
    assert.ok(runsChrome(l), 'missed: ' + l);
  }
  assert.ok(!RUNS_CHROME.test('chromium.launch({ headless: true })'), 'a Playwright launch is not a direct run');
  // The person's own Chrome is not a test browser: a mock keychain there would lose their saved logins.
  for (const l of ['open -a "Google Chrome" https://x', 'open -b com.google.Chrome', 'open -a Chrome https://x', "execFileSync('open', ['-a', 'Google Chrome', url])"]) {
    assert.ok(!runsChrome(l), 'the person\'s own Chrome was refused: ' + l);
  }
  // Prose that names a test browser is not a launch.
  for (const l of ['// we open Chromium once per run', 'throw new Error("cannot open chromium-profile dir")']) {
    assert.ok(!runsChrome(l), 'prose was read as a launch: ' + l);
  }
  assert.ok(RUNS_CHROME.test('open -a "Chrome for Testing"'), 'the short app name was missed');
  assert.ok(DEFAULTS_OFF.test('launch({ ignoreAllDefaultArgs: true })') && !DEFAULTS_OFF.test('launch({ ignoreAllDefaultArgs: false })'));
  assert.ok(DEFAULTS_OFF.test('opts.ignoreAllDefaultArgs = true') && !DEFAULTS_OFF.test('if (opts.ignoreAllDefaultArgs === true) {}'));
});

test('#9254: no launch site in the repo turns the keychain switches off or runs Chrome without them', () => {
  const list = files();
  assert.ok(list.length > 2000, 'CONTROL: git listed only ' + list.length + ' source files');
  assert.ok(list.some((f) => f.endsWith(path.join('docs', 'browser-checks', 'mobile-shots.js'))), 'CONTROL: the walk missed the design-shots launcher');
  assert.deepEqual(offenders(list), []);
});

test('#9254 CONTROL: the scan reports each planted bad launch, and not the safe one', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'keychain-9254-'));
  try {
    const put = (name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; };
    const all = put('all.js', "const b = await chromium.launch({ ignoreAllDefaultArgs: true });\n");
    const drops = put('drops.js', "const b = await chromium.launch({ ignoreDefaultArgs: ['--use-mock-keychain'] });\n");
    const direct = put('direct.sh', 'open -a "Google Chrome for Testing" --args --user-data-dir=/tmp/x\n');
    const fixed = put('fixed.sh', 'open -a "Google Chrome for Testing" --args --use-mock-keychain --password-store=basic\n');
    const far = put('far.sh', 'open -a "Google Chrome for Testing" --args --user-data-dir=/tmp/x\n\n\n\n\n# later: --use-mock-keychain\n');
    const named = put('named.js', '// ignoreDefaultArgs is never set here\nlaunch({ ignoreDefaultArgs })\n');
    const next = put('next.sh', 'open -a "Google Chrome for Testing" --args \\\n  --use-mock-keychain --password-store=basic\n');
    const got = offenders([all, drops, direct, fixed, far, next, named]);
    assert.equal(got.length, 6, JSON.stringify(got));   // named.js twice: the comment and the shorthand, each with no value
    assert.ok(!got.some((x) => x.startsWith(path.relative(__dirname, next))), 'the switch on the next line of the same call was not read');
    assert.ok(!got.some((x) => x.startsWith(path.relative(__dirname, fixed))), 'the fixed launch was reported');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
