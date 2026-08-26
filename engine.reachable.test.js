/**
 * Engine complete, tested, unreachable — detectable (#265).
 *
 * Angel's diagnosis: the engine is written first and carefully, and the screen
 * is a separate act nobody re-checks was performed. Four features shipped that
 * way (assignPart, restart, commitments, owesReply): tests green, engine
 * documented, no person able to reach any of it — and one of them the product
 * actively DENIED having.
 *
 * The signature is greppable: an exported engine name that its own tests
 * exercise and NOTHING else references. This test computes that list and
 * fails on any name not explicitly excused below, so the fifth instance is
 * caught the week it is written rather than found by a person.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/* Test seams and re-exports, excused BY NAME WITH A REASON. An entry here is
   a claim someone can check; do not add names to quiet the test without one. */
const EXCUSED = {
  setRunner: 'test seam: injects the tmux runner',
  setPauser: 'test seam: observes the codex Enter gap without sleeping (#571)',
  setDryRun: 'test seam: keeps suites off real panes',
  resetForTests: 'test seam',
  agePartWritesForTests: 'test seam: ages the parts records instead of shortening the hour (#803)',
  ageMemberChangesForTests: 'test seam: ages the membership records instead of shortening the hour (#803)',
  setPaneSource: 'test seam: keeps status reads off the real machine',
  setRenderer: 'test seam (attachments preview)',
  setRevealRunner: 'test seam (projects reveal)',
  setSessionSource: 'test seam: keeps session reads off the real machine',
  setTickInterval: 'test seam (connect pacing)',
  setUnknownGrace: 'test seam (connect pacing)',
  setAbandonedSigninMs: 'test seam (connect pacing, #727 item 4 abandoned-signin bound)',
  setFreshnessForTests: 'test seam',
  setUnansweredAfterForTests: 'test seam (#185 unanswered constant)',
  setBase: 'test seam (update feed base url)',
  setInstallRunner: 'test seam (update installer)',
  setInstalledRoot: 'test seam (update root)',
  setAutoPref: 'test seam (auto-update preference file)',
  projectsFor: 'superseded reader: list()/get() carry the same join; kept for its tests until they migrate (#265 sweep)',
  currentChildPid: 'test seam: reads the tunnel supervisor child pid to assert its lifetime deterministically',
  setRelay: 'engine/remote.js: dormant until the Kosmos-team Settings surface wires the self-host relay field; validated here so garbage is refused at set time. Its siblings (setOn, status, ...) escape this sweep only because their names collide with words in other files; setRelay is unique, so it is named here rather than passing by luck.',
};

const engineDir = path.join(__dirname, 'engine');
const engineFiles = fs.readdirSync(engineDir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

/* Every non-test source a caller could live in. */
const CALLER_FILES = [
  ...engineFiles.map((f) => path.join('engine', f)),
  'server.js',
  path.join('web', 'index.html'),
  path.join('install', 'kosmos'),
  path.join('install', 'setup.sh'),
  ...fs.readdirSync(path.join(__dirname, 'tools')).map((f) => path.join('tools', f)),
  ...fs.readdirSync(path.join(__dirname, 'test-support')).map((f) => path.join('test-support', f)),
].filter((f) => { try { return fs.statSync(path.join(__dirname, f)).isFile(); } catch { return false; } });

const read = (f) => { try { return fs.readFileSync(path.join(__dirname, f), 'utf8'); } catch { return ''; } };
const testFiles = [
  ...fs.readdirSync(engineDir).filter((f) => f.endsWith('.test.js')).map((f) => path.join('engine', f)),
  ...fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).map((f) => f),
];
const testBlob = testFiles.map(read).join('\n');
const sources = CALLER_FILES.map((f) => ({ f, text: read(f) }));

function exportedNames(text) {
  const m = text.match(/module\.exports = \{([\s\S]*?)\n\};/);
  if (!m) return [];
  return [...m[1].matchAll(/(?:^|[,{\n])\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?=[,:}\n])/g)]
    .map((x) => x[1])
    .filter((n) => !['module', 'exports'].includes(n));
}

test('no engine export is tested, excused by nobody, and reachable from nowhere', () => {
  const orphans = [];
  for (const f of engineFiles) {
    const rel = path.join('engine', f);
    const text = read(rel);
    for (const name of exportedNames(text)) {
      if (EXCUSED[name]) continue;
      /* Short and generic names (FILE, LOG, get, list...) collide with
         unrelated words in a plain-text grep; a word-boundary search plus a
         5+ character floor keeps the check about the class it hunts (the
         four instances were assignPart, restart, commitments, owesReply --
         all long, specific names). */
      if (name.length < 5) continue;
      const word = new RegExp('\\b' + name + '\\b');
      const tested = word.test(testBlob);
      if (!tested) continue;
      const callers = sources.filter((s2) => s2.f !== rel && word.test(s2.text));
      if (callers.length > 0) continue;
      /* A name its own module calls is reachable through whatever calls it;
         the signature is a capability NOTHING invokes. Count same-file
         mentions beyond the definition and the exports list: any left means
         an internal caller. */
      const mentions = (text.match(new RegExp('\\b' + name + '\\b', 'g')) || []).length;
      const defs = (text.match(new RegExp('function ' + name + '\\b', 'g')) || []).length
        + (text.match(new RegExp('(const|let) ' + name + '\\b', 'g')) || []).length;
      const exportsBlock = text.match(/module\.exports = \{[\s\S]*?\n\};/);
      const inExports = exportsBlock ? (exportsBlock[0].match(new RegExp('\\b' + name + '\\b', 'g')) || []).length : 0;
      if (mentions - defs - inExports > 0) continue;
      orphans.push(rel + ' exports ' + name);
    }
  }
  assert.deepEqual(orphans, [],
    'tested, exported, and reachable from nowhere -- the #265 signature. Wire it to a screen, or excuse it here with a reason someone can check.');
});
