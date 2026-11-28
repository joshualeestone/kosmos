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
  return out;
}

/* Turning Playwright's defaults off wholesale, or dropping a keychain switch by name. */
const DEFAULTS_OFF = /ignoreDefaultArgs\s*:\s*true\b|ignoreAllDefaultArgs/;
const DROPS_KEYCHAIN = /ignoreDefaultArgs\s*:[^\]\n]*(?:use-mock-keychain|password-store)/;
/* Running a Chrome or Chromium app binary itself (not through Playwright's launch). */
const RUNS_CHROME = /Contents\/MacOS\/(?:Google Chrome|Chromium)|open\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*a[a-zA-Z]*\s+["']?(?:Google Chrome|Chromium)/;

function offenders(list) {
  const bad = [];
  for (const f of list) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(__dirname, f);
    if (DEFAULTS_OFF.test(src)) bad.push(rel + ': turns Playwright\'s default switches off');
    if (DROPS_KEYCHAIN.test(src)) bad.push(rel + ': drops a keychain switch');
    if (RUNS_CHROME.test(src) && !src.includes('--use-mock-keychain')) bad.push(rel + ': runs a Chrome binary without --use-mock-keychain');
  }
  return bad;
}

test('#9254: every rule fires on the shape it names, and not on the safe shapes (controls)', () => {
  assert.ok(DEFAULTS_OFF.test("chromium.launch({ ignoreDefaultArgs: true })"));
  assert.ok(DROPS_KEYCHAIN.test("ignoreDefaultArgs: ['--use-mock-keychain']"));
  assert.ok(DROPS_KEYCHAIN.test("ignoreDefaultArgs: ['--hide-scrollbars', '--password-store=basic']"));
  assert.ok(RUNS_CHROME.test('spawn("/x/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")'));
  assert.ok(RUNS_CHROME.test('open -na "Google Chrome" --args --new-window'));
  assert.ok(!DEFAULTS_OFF.test("ignoreDefaultArgs: ['--hide-scrollbars']"), 'dropping one unrelated switch is safe');
  assert.ok(!DROPS_KEYCHAIN.test("ignoreDefaultArgs: ['--enable-automation']"), 'dropping one unrelated switch is safe');
  assert.ok(!RUNS_CHROME.test("chromium.launch({ headless: true })"), 'a Playwright launch is not a direct run');
  assert.ok(!RUNS_CHROME.test('open -n "Google Chrome"'), 'open with no -a names a file, not an app');
});

test('#9254: no launch site in the repo turns the keychain switches off or runs Chrome without them', () => {
  const list = files();
  assert.ok(list.length > 200, 'CONTROL: the walk found only ' + list.length + ' files');
  assert.ok(list.some((f) => f.endsWith(path.join('docs', 'browser-checks', 'mobile-shots.js'))), 'CONTROL: the walk missed the design-shots launcher');
  assert.deepEqual(offenders(list), []);
});

test('#9254 CONTROL: the scan reports a planted bad launch', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'keychain-9254-'));
  const bad = path.join(dir, 'bad.js');
  fs.writeFileSync(bad, "const b = await chromium.launch({ ignoreDefaultArgs: true });\n");
  const direct = path.join(dir, 'direct.sh');
  fs.writeFileSync(direct, 'open -a "Google Chrome for Testing" --args --user-data-dir=/tmp/x\n');
  const fixed = path.join(dir, 'fixed.sh');
  fs.writeFileSync(fixed, 'open -a "Google Chrome for Testing" --args --use-mock-keychain --password-store=basic\n');
  assert.equal(offenders([bad, direct, fixed]).length, 2, JSON.stringify(offenders([bad, direct, fixed])));
  fs.rmSync(dir, { recursive: true, force: true });
});
