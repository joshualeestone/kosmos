'use strict';
/**
 * THE FOLDERS A PERSON COULD ADOPT, NOT JUST HOW MANY (#1531).
 *
 * `found()` already computed these paths in order to tally
 * `noInstructionsFolderPresent`, and then threw them away. So a screen could learn
 * that ONE folder qualified and never which one, and **you cannot offer a count for
 * adoption.**
 *
 * 🛑 THE SHIP CRITERION FOR #1493 MOVED BECAUSE OF THIS FIELD, so the arms below are
 * written against the new one: a correct build shows **ONE agent AND ONE
 * unidentified folder offered**. "Shows 1" was the old target and gating on it now
 * would pass a build that offers nobody anything.
 *
 * ⭐ NO NAME IS CARRIED AND THAT IS THE FEATURE. Extraction was measured on a real
 * machine and no name is cleanly pullable from a transcript, so the screen asks
 * instead of guessing. `path.basename(dir)` is the obvious thing to put here and it
 * is exactly wrong: it looks like knowledge and is a guess. The negative arm below
 * exists to keep it out.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-adoptable-1531-'));
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'claude');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');

const discover = require('./discover');

test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

/* A project folder whose transcript points at `cwd`. `claudeMd === null` means the
   working folder exists and holds no instruction file, which is the adoptable case.
   `gone: true` deletes the working folder after seeding, which is the case that must
   NOT be offered. */
function seed(folderKey, cwdName, claudeMd, { gone = false, sessions = 1 } = {}) {
  const cwd = path.join(SB, 'work', cwdName);
  fs.mkdirSync(cwd, { recursive: true });
  if (claudeMd !== null) fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), claudeMd);
  const proj = path.join(SB, 'claude', 'projects', folderKey);
  fs.mkdirSync(proj, { recursive: true });
  for (let i = 0; i < sessions; i += 1) {
    fs.writeFileSync(path.join(proj, `${folderKey}-s${i}.jsonl`),
      `{"type":"user"}\n{"cwd":${JSON.stringify(cwd)}}\n`);
  }
  if (gone) fs.rmSync(cwd, { recursive: true, force: true });
  return cwd;
}

const AGENT_CWD = seed('-Users-someone-work-workers-lilnacho', 'workers/lilnacho',
  '# lilnacho\n\nYou are **lilnacho**, a project manager.\n');
const BARE_CWD = seed('-Users-someone', 'homedir', null, { sessions: 9 });
const GONE_CWD = seed('-Users-someone-deleted', 'deleted', null, { gone: true });

test('#1531: the adoptable folder is named by PATH, not merely counted', () => {
  const r = discover.found();

  /* CONTROL FIRST: if the count is zero the list being empty proves nothing, and
     every assertion below would pass against a walk that found no folders at all. */
  assert.equal(r.skipped.noInstructionsFolderPresent, 1,
    `nothing qualified, so this test cannot tell a working field from a missing one: ${JSON.stringify(r.skipped)}`);

  assert.deepEqual((r.adoptable || []).map((a) => a.dir), [BARE_CWD],
    `adoptable should name exactly the bare folder: ${JSON.stringify(r.adoptable)}`);
});

test('#1531: the list and the count cannot disagree', () => {
  /* Two derivations of one fact drift. Asserting they match is cheaper than
     choosing which to trust later, and it is the check that fails first if a
     future filter is applied to one and not the other. */
  const r = discover.found();
  assert.equal(r.adoptable.length, r.skipped.noInstructionsFolderPresent,
    `list ${r.adoptable.length} vs count ${r.skipped.noInstructionsFolderPresent}`);
});

test('#1531: a DELETED folder is counted but never offered, because adopting it must fail', () => {
  const r = discover.found();
  assert.equal(r.skipped.noInstructionsFolderGone, 1,
    `the deleted fixture was not seen at all: ${JSON.stringify(r.skipped)}`);
  assert.equal(r.adoptable.some((a) => a.dir === GONE_CWD), false,
    'a folder that no longer exists was offered for adoption');
});

test('#1531: an agent we CAN name is not also offered as an unnamed folder', () => {
  /* Otherwise lilnacho appears twice on the board, once as herself and once as a
     nameless folder, which is the "shows two lilnachos" failure the ship criterion
     is written to catch. */
  const r = discover.found();
  assert.equal(r.agents.length, 1, `expected one agent: ${JSON.stringify(r.agents.map((a) => a.name))}`);
  assert.equal(r.agents[0].name, 'lilnacho');
  assert.equal(r.adoptable.some((a) => a.dir === AGENT_CWD), false,
    'the named agent is ALSO being offered as an unidentified folder');
});

test('#1531: adoptable carries NO name, guessed or otherwise', () => {
  /* The whole design is never guess, always ask. A `name` here would be
     path.basename(dir), which looks like knowledge and is a guess. */
  const r = discover.found();
  for (const a of r.adoptable) {
    assert.deepEqual(Object.keys(a), ['dir'],
      `adoptable entries must carry the folder and nothing else: ${JSON.stringify(a)}`);
  }
  /* CONTROL: the agent record DOES carry a name, so this file can tell the two
     shapes apart and the assertion above is not passing on an empty list. */
  assert.equal(typeof r.agents[0].name, 'string');
});

test('#1531 THE NEW SHIP CRITERION: one agent AND one folder offered, together', () => {
  /* The old target was "shows 1". A build that shows one agent and offers nothing
     satisfies that and is the bug. Both halves, in one assertion, on purpose. */
  const r = discover.found();
  assert.deepEqual(
    { agents: r.agents.length, offered: r.adoptable.length },
    { agents: 1, offered: 1 },
  );
});
