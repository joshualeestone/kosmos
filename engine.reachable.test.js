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
  setChannel: 'test seam (#570 7c-4): engine/chat.js\'s twin of setRunner for Windows agents, injecting the supervisor-channel sayer so a suite never reaches a real agent pipe. Clearing it re-arms dry-run, the same interlock as setRunner.',
  setSpawn: 'test seam (#570): injects engine/win32launch.js\'s spawn, so a suite never starts a real agent and a Mac can drive the win32 arm. Named here rather than passing by luck: "setSpawn" is unique to that file, while its siblings (setRunner, setAnchorer) escape only by colliding with other files\' seams.',
  superviseStreaming: 'engine/win32supervisor.js (#570 7c-1): the supervisor that HOLDS a streaming agent\'s pipes -- the other half of launchStreaming, and the thing that will carry delivery. Unwired for the same reason and on the same card: the Scheduled Task still runs supervise(), and swapping the entry point is slice 7c-2. Landed with its own arms first because the properties that matter here (a death is one death; the throttle limps; every restart is a --resume, never a fresh id) are cheaper to pin now than to debug through a task later.',
  launchStreaming: 'engine/win32launch.js (#570 7c-1): the streaming launch -- `claude -p --input-format stream-json` with the pipes held -- which is the substrate for MESSAGING a Windows agent. Deliberately NOT wired yet: create.js and win32supervisor.js still use the detached launch(), and the wiring is slice 7c-2 (.claude/plans/WINDOWS-ROADMAP.md §3). Landed and tested on its own first because this lane has repeatedly shipped a green suite over a path production could not take. An excuse with a named next slice, not an orphan -- if 7c is abandoned, this export goes with it.',
  setAnchorer: 'test seam (#570): injects engine/win32job.js\'s anchor step, so a suite never copies the 92 MB interpreter and a Mac is never asked to write a Windows path -- both of which happen the moment installJob is driven with platform:"win32", which is exactly how this branch is asserted. Named here rather than passing by luck: "setAnchorer" is unique to that file, while its sibling setRunner escapes only by colliding with every other file\'s runner seam.',
  // readPointer's excuse was removed in win32-update-stage: engine/win32update.js's prepare()
  // now reads the pointer (B0: it must name the folder being updated), so it has a real caller
  // and the #265 orphan guard protects it again.
  setChecker: 'test seam (#1930): injects the live claude-auth checker so authprobe tests do not spawn a real subprocess',
  resetForTest: 'test seam (#1930): clears the authprobe per-account cache between tests',
  setPauser: 'test seam: observes the codex Enter gap without sleeping (#571)',
  setDryRun: 'test seam: keeps suites off real panes',
  setClaudeProbe: 'test seam: injects the claude -p liveness probe so tests do not spawn a real claude (#1916)',
  resetForTests: 'test seam',
  dispatch: 'test-only export (#988): engine/updating.js exports its real protocol dispatch so an arm can cover it. Named here rather than passing by luck: it otherwise survives only by colliding with boardauth/server, which is what the setRelay excuse warns against',
  underTest: 'test-only export (#988): engine/updating.js exports its test-context predicate for its own arms; production inlines the check. Named here rather than passing by luck: it otherwise survives only by colliding with ping/feedbacksend (notify.js, a third definer, was deleted in #2623)',
  setRequestFactory: 'test seam (#988): replaces the coordinator TRANSPORT only, so enrolment, the certificate read and the URL derivation still run under test',
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
  setProbeTtlForTests: 'test seam: ages the willInstall probe cache instead of sleeping 60s (#1556)',
  setUnansweredAfterForTests: 'test seam (#185 unanswered constant)',
  setChatgptTimers: 'test seam (#2338): shrinks the ChatGPT-subscription sign-in watchdog + reap TTL so the abandoned-child and session-reap tests run in ms instead of minutes (never wired to a screen)',
  setBase: 'test seam (update feed base url)',
  setInstallRunner: 'test seam (update installer)',
  setInstalledRoot: 'test seam (update root)',
  setAutoPref: 'test seam (auto-update preference file)',
  setPlatform: 'test seam (win32-update-check): engine/update.js\'s platform for the pointer, manifest and channel rules, so the Windows arm is asserted from a Mac and the Mac contract (update.test.js) is pinned to darwin on the Windows box. Production reads process.platform.',
  setWindowsBundleRoot: 'test seam (win32-update-check): engine/update.js\'s answer to "is this a Windows bundle", so the manual-offer arm runs without a real runtime\\node.exe layout. Production asks win32board.bundleRoot().',
  projectsFor: 'superseded reader: list()/get() carry the same join; kept for its tests until they migrate (#265 sweep)',
  currentChildPid: 'test seam: reads the tunnel supervisor child pid to assert its lifetime deterministically',
  setRelay: 'engine/remote.js: dormant until the Kosmos-team Settings surface wires the self-host relay field; validated here so garbage is refused at set time. Its siblings (setOn, status, ...) escape this sweep only because their names collide with words in other files; setRelay is unique, so it is named here rather than passing by luck.',
  setTransport: 'test seam (#2296): injects the blob list/get transport so engine/feedbackpull.js tests never hit the network or the real secrets map. Named here because "setTransport" is unique to this file; production pull() uses the default fetch transport.',
  setSender: 'test seam (#2037): engine/feedbacksend.js injects a fake sender so the daily-report send tests never hit the network; production uses global fetch. Named here from #2623 onward: it used to escape this sweep by a name-collision with engine/notify.js and engine/ping.js, both of which had a setSender -- #2623 deleted notify.js and ping.js\'s sender, so feedbacksend.js is now the sole definer and the collision cover is gone. A test seam, not an orphan.',
  setPlatformForTests: 'test seam (#1704 PR3): engine/worldstarts.js picks the platform arm for a caller that does not pass one. The switch route never passes one, so server.world-switch-agents-1704.test.js states the Mac arm through this and drives it with remove.setRunner from any host. Production uses process.platform.',
  // setActiveWorld's excuse was removed in slice 2b-ii: POST /api/worlds/active
  // (server.js) is now a real caller, so the #265 orphan guard protects it again.
  // checkLive's excuse was removed in the #2420 listing slice because it is no longer
  // TRUE, not because the guard gained coverage. accounts.listLiveNow() now calls
  // claudeaccounts.checkLive for an api-key Claude row (the live-badge reader for a
  // stored api-key account), so it is no longer "genuinely dormant" -- and an excuse
  // is a claim, so a discharged one is removed to keep the EXCUSED set honest.
  // ⚠️ The #265 sweep does NOT independently re-verify this: "checkLive" collides by
  // name with subscription.js/openaiaccounts.js, so it could never have been flagged
  // as an orphan anyway (the old excuse said exactly this), and it could not flag a
  // future regression that dropped the real caller either. What protects it is the
  // genuine caller existing, not the sweep. (forgetKey and unwireApiKeyHelper were
  // already reachable via server.js's failed-store cleanup.)
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
