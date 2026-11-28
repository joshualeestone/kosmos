'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9254: a test browser must never read the person's login keychain. On 2026-11-27 a Chrome for Testing asked
 * for "Chromium Safe Storage", and the dialog reached the person. Playwright adds --use-mock-keychain and
 * --password-store=basic to every Chromium it launches (measured on this Mac: the browser process carries both, and
 * securityd logs no request), so the danger is a launch that turns those defaults off, or one that runs a Chrome
 * binary itself. This reads every launch site in the repo as text and refuses both shapes.
 *
 *   node --test browser-launch-keychain-9254.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOTS = ['docs', 'tools', 'test-support', 'engine', 'bin', 'install', 'native-app'];
const EXT = /\.(js|mjs|cjs|sh|ts)$/;
const SELF = path.basename(__filename);
function files() {
  const out = [];
  const walk = (dir) => {
    let names;
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of names) {
      if (d.name === 'node_modules' || d.name.startsWith('.')) continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (EXT.test(d.name) || d.name === 'kosmos') out.push(p);
    }
  };
  for (const r of ROOTS) walk(path.join(__dirname, r));
  // The repo root too (its tests and scripts), not recursively, and not this file, whose controls name the bad shapes.
  for (const d of fs.readdirSync(__dirname, { withFileTypes: true })) {
    if (d.isFile() && EXT.test(d.name) && d.name !== SELF) out.push(path.join(__dirname, d.name));
  }
  return out;
}

/* Switches a launch may drop: neither touches the keychain. Anything else in an ignoreDefaultArgs value, or a value that
   is not a plain list of such strings (a variable, a spread, true), is refused. */
const SAFE_DROPS = new Set(['--hide-scrollbars', '--enable-automation']);
/* The text of the value after each `ignoreDefaultArgs:` (any quoting), up to the end of that property: brackets and
   parentheses are counted, so a multi-line array or a ternary is read whole. */
function dropValues(src) {
  const out = [];
  const re = /['"]?ignoreDefaultArgs['"]?\s*:/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote = null;
    const start = i;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
      else if (c === ',' && depth === 0) break;
    }
    out.push(src.slice(start, i));
  }
  return out;
}
function unsafeDrop(value) {
  // A comparison inside a ternary (engine === 'chromium') chooses between lists; it is not a dropped switch.
  const v = value.replace(/[!=]==?\s*(['"])[^'"]*\1/g, '');
  if (!v.includes('[') || v.includes('...')) return true;   // not a plain list: a variable, true, a spread
  const strs = [...v.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map((x) => x[2]);
  if (/\b(?:true|[A-Za-z_$][\w$]*)\s*(?=[,\]])/.test(v.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""'))) return true;   // a bare name in the list
  return strs.some((x) => !SAFE_DROPS.has(x));
}
const DEFAULTS_OFF = /ignoreAllDefaultArgs/;
/* Running a Chrome or Chromium binary or app itself, not through Playwright's launch (case-insensitive). The keychain
   switch must be on the same call: that line or the three after it. */
const RUNS_CHROME = /contents\/macos\/(?:google chrome|chromium)|\b(?:spawn|execFile|exec)(?:Sync)?\([^)\n]*chrome-headless-shell['"`]|\bopen\s+(?:-[a-z]+\s+)*-[a-z]*[ab][a-z]*\s+["']?(?:\/[^\s"']*\/)?(?:google chrome|chromium|com\.google\.chrome|org\.chromium)/i;

function offenders(list) {
  const bad = [];
  for (const f of list) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(__dirname, f) || f;
    if (DEFAULTS_OFF.test(src)) bad.push(rel + ': turns every Playwright default switch off');
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
  assert.ok(!unsafe("launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })"), 'one safe switch');
  assert.ok(!unsafe("launch({ ignoreDefaultArgs: eng === 'chromium' ? ['--hide-scrollbars'] : [] })"), 'a ternary of safe lists');
  assert.ok(!unsafe("launch({ ignoreDefaultArgs: ['--enable-automation'], args: ['--x'] })"), 'the next property is not read as the value');
  for (const l of ['spawn("/x/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")', 'open -na "Google Chrome" --args --new-window',
    "open -a 'google chrome'", 'open -b com.google.Chrome', 'open -a /Applications/Chromium.app/', "execFile('/x/chrome-headless-shell', [])"]) {
    assert.ok(RUNS_CHROME.test(l), 'missed: ' + l);
  }
  assert.ok(!RUNS_CHROME.test('chromium.launch({ headless: true })'), 'a Playwright launch is not a direct run');
  assert.ok(!RUNS_CHROME.test('open -n "Google Chrome"'), 'open with no -a or -b names a file, not an app');
});

test('#9254: the Playwright MCP config the repo writes launches the headless shell through Playwright, no profile', () => {
  const { configFor } = require('./engine/agentbrowser');
  const args = configFor({ platform: 'darwin', executablePath: '/x/chrome-headless-shell', node: 'n', cli: 'c', outputDir: 'o' }).mcpServers[Object.keys(configFor({ platform: 'darwin', executablePath: '/x/chrome-headless-shell', node: 'n', cli: 'c', outputDir: 'o' }).mcpServers)[0]].args;
  assert.deepEqual(args.slice(1, 5), ['--browser', 'chromium', '--executable-path', '/x/chrome-headless-shell'], 'the Mac browser is not Playwright\'s chromium at the given shell: ' + JSON.stringify(args));
  assert.ok(args.includes('--isolated'), 'the MCP browser is not isolated: ' + JSON.stringify(args));
  assert.ok(!args.some((a) => /user-data-dir|--profile|--browser=?chrome$/.test(a)), 'the MCP browser was given a profile or the real Chrome: ' + JSON.stringify(args));
});

test('#9254: no launch site in the repo turns the keychain switches off or runs Chrome without them', () => {
  const list = files();
  assert.ok(list.length > 200, 'CONTROL: the walk found only ' + list.length + ' files');
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
    const got = offenders([all, drops, direct, fixed, far]);
    assert.equal(got.length, 4, JSON.stringify(got));
    assert.ok(!got.some((x) => x.startsWith(path.relative(__dirname, fixed))), 'the fixed launch was reported');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
