'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9254: a test browser must never read the person's login keychain. On 2026-11-27 a Chrome for Testing asked
 * for "Chromium Safe Storage", and the dialog reached the person. Playwright adds --use-mock-keychain and
 * --password-store=basic to every Chromium it launches (measured on this Mac: the browser process carries both, and
 * securityd logs no request), so the danger is a launch that turns those defaults off, or one that runs a Chrome
 * binary itself. This reads the repo's tracked source as text and refuses both shapes.
 *
 * What text can show, stated: a launch's ignoreDefaultArgs, in any spelling the name appears in, and a Chrome run
 * named by a literal path, app name or bundle id. A Chrome path held only in a variable cannot be seen; the fleet
 * rule on the card covers what no repo scan can.
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
const DEFAULTS_OFF = /ignoreAllDefaultArgs\s*:\s*true|ignoreAllDefaultArgs\s*=(?!=)/;
/* Running a Chrome or Chromium binary or app itself, not through Playwright's launch (case-insensitive). The keychain
   switch must be on the same call: that line or the three after it. */
const RUNS_CHROME = /contents\/macos\/(?:google chrome|chromium)|\b(?:spawn|execFile|exec)(?:Sync)?\([^)\n]*chrome-headless-shell\b|\bopen\s+(?:-[a-z]+\s+)*-[a-z]*[ab][a-z]*\s+\\?["']?(?:\/[^\s"'\\]*\/)?(?:google chrome|chromium|com\.google\.chrome|org\.chromium)/i;

function offenders(list) {
  const bad = [];
  for (const f of list) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(__dirname, f) || f;
    if (DEFAULTS_OFF.test(src)) bad.push(rel + ': turns every default switch off (ignoreAllDefaultArgs)');
    for (const v of dropValues(src)) if (unsafeDrop(v)) bad.push(rel + ': ignoreDefaultArgs drops more than a safe switch: ' + v.trim().slice(0, 80));
    const lines = src.split('\n');
    lines.forEach((l, i) => {
      if (RUNS_CHROME.test(l) && !lines.slice(i, i + 4).join('\n').includes('--use-mock-keychain')) bad.push(rel + ':' + (i + 1) + ': runs a Chrome binary without --use-mock-keychain');
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
  for (const l of ['spawn("/x/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")', 'open -na "Google Chrome" --args --new-window',
    "open -a 'google chrome'", 'open -b com.google.Chrome', 'open -a /Applications/Chromium.app/', "execFile('/x/chrome-headless-shell', [])",
    "spawnSync('/x/chrome-headless-shell', [])", "exec('/x/chrome-headless-shell --version')", 'open -b org.chromium.Chromium',
    'run("/x/Chromium.app/Contents/MacOS/Chromium")', 'execSync("open -a \\"Google Chrome\\" https://x")']) {
    assert.ok(RUNS_CHROME.test(l), 'missed: ' + l);
  }
  assert.ok(!RUNS_CHROME.test('chromium.launch({ headless: true })'), 'a Playwright launch is not a direct run');
  assert.ok(!RUNS_CHROME.test('open -n "Google Chrome"'), 'open with no -a or -b names a file, not an app');
  assert.ok(DEFAULTS_OFF.test('launch({ ignoreAllDefaultArgs: true })') && !DEFAULTS_OFF.test('launch({ ignoreAllDefaultArgs: false })'));
  assert.ok(DEFAULTS_OFF.test('opts.ignoreAllDefaultArgs = true') && !DEFAULTS_OFF.test('if (opts.ignoreAllDefaultArgs === true) {}'));
});

test('#9254: the Playwright MCP config the repo writes launches the headless shell through Playwright, no profile', () => {
  const { configFor } = require('./engine/agentbrowser');
  const servers = configFor({ platform: 'darwin', executablePath: '/x/chrome-headless-shell', node: 'n', cli: 'c', outputDir: 'o' }).mcpServers;
  const args = servers[Object.keys(servers)[0]].args;
  assert.deepEqual(args.slice(1, 5), ['--browser', 'chromium', '--executable-path', '/x/chrome-headless-shell'], 'the Mac browser is not Playwright\'s chromium at the given shell: ' + JSON.stringify(args));
  assert.ok(args.includes('--isolated'), 'the MCP browser is not isolated: ' + JSON.stringify(args));
  assert.ok(!args.some((a) => /user-data-dir|--profile/.test(a)), 'the MCP browser was given a profile: ' + JSON.stringify(args));
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
    const next = put('next.sh', 'open -a "Google Chrome for Testing" --args \\\n  --use-mock-keychain --password-store=basic\n');
    const got = offenders([all, drops, direct, fixed, far, next]);
    assert.equal(got.length, 4, JSON.stringify(got));
    assert.ok(!got.some((x) => x.startsWith(path.relative(__dirname, next))), 'the switch on the next line of the same call was not read');
    assert.ok(!got.some((x) => x.startsWith(path.relative(__dirname, fixed))), 'the fixed launch was reported');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
