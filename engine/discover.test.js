'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-discover-'));
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'claude');
// The dismiss flag is a data-dir file; without this the test below would write
// the operator's real "never show found agents again" answer.
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');

const discover = require('./discover');

test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

/** A working directory with an instruction file, and a Claude project folder
 *  whose transcript says it ran there. The shape a real machine has. */
function seed(folderKey, cwdName, claudeMd, { at } = {}) {
  const cwd = path.join(SB, 'work', cwdName);
  fs.mkdirSync(cwd, { recursive: true });
  if (claudeMd !== null) fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), claudeMd);
  const proj = path.join(SB, 'claude', 'projects', folderKey);
  fs.mkdirSync(proj, { recursive: true });
  const t = path.join(proj, `${folderKey}-sess.jsonl`);
  fs.writeFileSync(t, `{"type":"user"}\n{"cwd":${JSON.stringify(cwd)}}\n`);
  if (at) fs.utimesSync(t, new Date(at), new Date(at));
  return cwd;
}

test('dismiss is kept on disk in the sandbox and read back; only a missing file means not dismissed', () => {
  assert.ok(discover.DISMISS_FILE.startsWith(SB), `flag would land outside the sandbox: ${discover.DISMISS_FILE}`);
  assert.equal(discover.dismissed(), false);
  discover.dismiss();
  assert.equal(discover.dismissed(), true);
  assert.ok(fs.existsSync(discover.DISMISS_FILE));
  fs.unlinkSync(discover.DISMISS_FILE);
  assert.equal(discover.dismissed(), false);
});

test('an agent is found from its files, with nothing running', () => {
  /**
   * 🔑 THE WHOLE POINT, AND THE REASON THIS MODULE EXISTS. Nothing in this test
   * starts a process, opens a socket or mentions tmux. Josh: "maybe they just
   * closed out a Claude Code but they've connected to it and they have agents.
   * They don't have them running in the background at that exact moment."
   */
  seed('anna', 'anna', 'You are **Anna**, a copywriter.\n\nMore instructions.\n');
  const r = discover.found();
  assert.equal(r.ok, true);
  const anna = r.agents.find((a) => a.name === 'Anna');
  assert.ok(anna, `Anna was not found: ${JSON.stringify(r.agents)}`);
  assert.equal(anna.role, 'copywriter');
  assert.match(anna.dir, /work\/anna$/);
});

test('a CLAUDE.md that introduces nobody is not an agent', () => {
  /* ⚠️ EVERY REPO IN THIS ORG HAS ONE and they are project instructions. Listing
     them would bury the real agents in a list nobody trusts, which is worse than
     finding none: a wrong list is used, an empty one is questioned. */
  seed('repo', 'some-repo', '# Build notes\n\nRun yarn test before pushing.\n');
  const names = discover.found().agents.map((a) => a.name);
  assert.ok(!names.includes('some-repo'));
  assert.equal(names.filter((n) => /build notes/i.test(n)).length, 0);
});

test('a folder with instructions we cannot read an identity out of is COUNTED, not dropped (kosmos#1078)', () => {
  /**
   * 🛑 THREE SITUATIONS END ON ONE SCREEN AND ONLY THIS ONE IS KNOWABLE HERE.
   * "You have no agents", "you have some that never ran" and "you have some we
   * could not read" all render as "Create your first agent." The first two are
   * indistinguishable at this layer -- a folder is reached through Claude's own
   * records, so an agent that has never run is invisible before we get here --
   * and this one was being thrown away by a bare `continue`.
   */
  const before = discover.found();
  seed('proj-notes', 'a-code-project', '# Build notes\n\nRun yarn test before pushing.\n');
  const after = discover.found();
  assert.equal(after.unreadable, before.unreadable + 1,
    'the folder with an unreadable identity was not counted');
  assert.ok(!after.agents.some((a) => a.dir.endsWith('a-code-project')),
    'it must be COUNTED without becoming an agent');
});

test('an agent we CAN read does not also count as unreadable', () => {
  /* ⚠️ THE POSITIVE CONTROL FOR THE COUNTER. A counter that only ever goes up
     agrees with the test above on a machine where nothing is readable at all,
     which is the shape of a fixture broken end to end. */
  const before = discover.found();
  seed('readable-one', 'readable-one', 'You are **Readable**, a tester.\n');
  const after = discover.found();
  assert.ok(after.agents.some((a) => a.name === 'Readable'), 'the readable agent was not found');
  assert.equal(after.unreadable, before.unreadable, 'a readable agent moved the unreadable count');
});

test('two session families over ONE unreadable directory count once', () => {
  /**
   * 🛑 THE FIRST VERSION OF THIS COUNTER WAS WRONG AND ITS OWN COMMENT DENIED
   * IT. The de-dupe above tests `byDir`, which only ever holds folders that
   * RESOLVED to an agent -- so an unreadable directory reached through two
   * project folders passed the de-dupe twice and was counted twice, while the
   * comment beside it said "cannot count it twice". Found by writing this test
   * for the sentence rather than for the code.
   */
  const before = discover.found();
  seed('twin-a', 'twin-dir', '# Notes\n\nNothing here introduces anybody.\n');
  seed('twin-b', 'twin-dir', '# Notes\n\nNothing here introduces anybody.\n');
  const after = discover.found();
  assert.equal(after.unreadable, before.unreadable + 1,
    'one directory reached twice was counted twice');
});

test('a machine we could not look at reports unreadable 0, never undefined', () => {
  /* Both refusal arms carry the field, so a caller never has to tell "none" from
     "we did not say". Same rule as `agents: []` on those arms. */
  const had = process.env.AGENT_WORKFORCE_CONFIG_ROOT;
  process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'nowhere-at-all-either');
  try {
    const r = discover.found();
    assert.equal(r.ok, false);
    assert.equal(r.unreadable, 0);
  } finally { process.env.AGENT_WORKFORCE_CONFIG_ROOT = had; }
});

test('a folder Claude ran in with no instruction file is not an agent', () => {
  seed('bare', 'bare-dir', null);
  const dirs = discover.found().agents.map((a) => a.dir);
  assert.ok(!dirs.some((d) => d.endsWith('bare-dir')));
});

test('two project folders pointing at one directory are one agent', () => {
  /* A directory Claude has run in under two session families still holds one
     agent, and a list that showed it twice would make the count a lie. */
  seed('dup-a', 'dupe', 'You are **Dupe**, a tester.\n');
  seed('dup-b', 'dupe', 'You are **Dupe**, a tester.\n');
  const hits = discover.found().agents.filter((a) => a.name === 'Dupe');
  assert.equal(hits.length, 1);
});

test('the newest transcript decides where a folder ran', () => {
  /* A project folder accumulates sessions; the current answer is the last one.
     Seeded oldest-last so a reader that took the first file would fail. */
  const now = Date.now();
  seed('moved', 'moved-new', 'You are **Moved**, a wanderer.\n', { at: now });
  const proj = path.join(SB, 'claude', 'projects', 'moved');
  const old = path.join(proj, 'older.jsonl');
  fs.writeFileSync(old, `{"cwd":${JSON.stringify(path.join(SB, 'work', 'gone'))}}\n`);
  fs.utimesSync(old, new Date(now - 900000), new Date(now - 900000));
  const hit = discover.found().agents.find((a) => a.name === 'Moved');
  assert.ok(hit, 'the folder resolved to the older session, or to nothing');
  assert.match(hit.dir, /moved-new$/);
});

test('a machine we cannot read answers ok:false, never an empty list', () => {
  /**
   * 🛑 THE DISTINCTION THIS WHOLE CODEBASE EXISTS FOR. "We found none" and "we
   * could not look" are different sentences, and the screen that conflates them
   * tells somebody with two hundred agents that they have none.
   */
  const had = process.env.AGENT_WORKFORCE_CONFIG_ROOT;
  process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'nowhere-at-all');
  try {
    const r = discover.found();
    assert.equal(r.ok, false);
    assert.deepEqual(r.agents, []);
    assert.match(r.because, /could not read/i);
  } finally { process.env.AGENT_WORKFORCE_CONFIG_ROOT = had; }
});

test('CONTROL: the fixture is really being read', () => {
  /* Without this, every absence above passes on a discovery that found nothing
     at all -- the shape of a test that stopped exercising its subject. */
  const r = discover.found();
  assert.ok(r.agents.length >= 3, `only ${r.agents.length} agents; the fixture stopped seeding`);
});

test('an agent Kosmos already looks after is marked as already in', () => {
  /**
   * 🛑 THE FIELD THE BOARD'S PANEL FILTERS ON. Without it that panel offers
   * every agent on the Mac including the ones already added, so a person's own
   * fleet is listed back to them under "Kosmos is not looking after these".
   *
   * 🔑 BOTH HALVES ASSERTED IN ONE TEST, deliberately: the interesting claim is
   * that the flag DISCRIMINATES. "Every agent says false" and "every agent says
   * true" both pass a test that only ever looks at one of them, and this field's
   * failure mode is a stuck value.
   */
  const create = require('./create');
  const store = require('./store');

  const mine = seed('kept', 'kept', 'You are **Kept**, a writer.\n');
  const theirs = seed('loose', 'loose', 'You are **Loose**, a writer.\n');

  /* Recorded the way `connect` records it: the folder against the folder's own
     name, which is the name Kosmos files an agent under. */
  store.writeProfile(path.basename(mine), { dir: mine, displayName: 'Kept' });

  const r = discover.found();
  const kept = r.agents.find((a) => a.dir === mine);
  const loose = r.agents.find((a) => a.dir === theirs);
  assert.ok(kept && loose, 'the fixture agents were not both found');
  assert.equal(kept.already, true, 'an agent with a folder recorded against it is offered again');
  assert.equal(loose.already, false, 'an agent nothing knows about is treated as already in');

  /* And a recorded folder that points somewhere ELSE does not count: same name,
     different agent, and hiding this one would be the silence this module
     exists to end. */
  store.writeProfile(path.basename(theirs), { dir: mine, displayName: 'Loose' });
  const again = discover.found().agents.find((a) => a.dir === theirs);
  assert.equal(again.already, false, 'a record pointing at a different folder counted as this one');
  void create;
});

/* ── #1493: the three drops above #1078's, which were silent ────────────────
   Josh's sister's first install showed an empty screen with ten session files
   on disk. `found()` knew four different things about her folders and could
   report exactly one of them, because #1078's counting begins AFTER the
   CLAUDE.md read succeeds.

   Measured on this fleet's own machine, where discovery works: 44 project
   folders, 17 listed as agents, 17 dropped for no CLAUDE.md and never counted. */

test('#1493: a folder whose working directory has no CLAUDE.md is COUNTED, not silently dropped', () => {
  /* 🛑 THE ONE THAT HIT HER. It is what an ordinary folder somebody once ran
     Claude in looks like, so a new install has mostly these. */
  const before = discover.found();
  seed('proj-noinstructions', 'ran-claude-here', null);
  const after = discover.found();
  assert.equal(after.skipped.noInstructions, before.skipped.noInstructions + 1,
    'a folder with no instruction file vanished without entering any number');
  assert.ok(!after.agents.some((a) => a.dir.endsWith('ran-claude-here')),
    'it must be COUNTED without becoming an agent');
  assert.equal(after.unreadable, before.unreadable,
    'it was counted as unreadable, which means something different: unreadable is '
    + 'an instruction file we could not read a name out of, not the absence of one');
});

test('#1493: a project folder with no transcript is COUNTED', () => {
  const before = discover.found();
  fs.mkdirSync(path.join(SB, 'claude', 'projects', 'proj-empty'), { recursive: true });
  const after = discover.found();
  assert.equal(after.skipped.noTranscript, before.skipped.noTranscript + 1,
    'an empty project folder vanished without entering any number');
});

test('#1493 CONTROL: a readable agent moves none of the three counters', () => {
  /* ⚠️ THE SAME CONTROL #1078 NEEDED, for the same reason: counters that only
     ever go up agree with the tests above on a fixture that is broken end to
     end, where nothing at all resolves. */
  const before = discover.found();
  seed('drops-control', 'drops-control', 'You are **DropsControl**, a tester.\n');
  const after = discover.found();
  assert.ok(after.agents.some((a) => a.name === 'DropsControl'), 'the readable agent was not found');
  assert.equal(after.skipped.noTranscript, before.skipped.noTranscript);
  assert.equal(after.skipped.noWorkingFolder, before.skipped.noWorkingFolder);
  assert.equal(after.skipped.noInstructions, before.skipped.noInstructions);
});
