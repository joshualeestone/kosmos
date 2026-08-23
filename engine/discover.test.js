'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-discover-'));
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'claude');

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
