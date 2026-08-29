'use strict';
/**
 * THE SHAPE OF A REAL MACHINE THAT SAW NO AGENTS (#1493), RUN THROUGH THE REAL
 * `found()` RATHER THAN A PROBE THAT REIMPLEMENTS IT.
 *
 * 🔑 Reconstructed from what Splinter read off the reporter's disk: TWO project
 * folders, and only one of them is an agent.
 *
 *   -Users-<user>-work-workers-lilnacho   1 transcript,  CLAUDE.md naming her
 *   -Users-<user>                         9 transcripts, NO CLAUDE.md at all
 *
 * ⇒ **A correct build shows ONE. Not two, and not zero.** Those are the two ways
 * this can be wrong and they fail in opposite directions: two means a bare home
 * directory somebody once ran Claude in is being offered as an agent, and zero is
 * the bug she actually reported.
 *
 * 🛑 THE SECOND FOLDER IS THE WHOLE TEST, WHICH IS WHY IT CARRIES NINE
 * TRANSCRIPTS AND NOT ONE. A single-transcript folder with no CLAUDE.md is
 * already covered elsewhere; nine is what her disk had, and it is the shape that
 * makes "we found nothing" plausible to a person, because the machine visibly has
 * a lot of history on it and still offers them nobody.
 *
 * ⚠️ WHAT THIS DOES AND DOES NOT CLAIM, pre-registered rather than decided after
 * the fact. It asserts the SHAPE resolves to one agent on today's engine, and it
 * asserts WHICH drop bucket the second folder lands in. It is NOT a reproduction
 * of her original failure: that defect was fixed on 2026-08-28 and this fixture is
 * run against today's build. The dedicated arm at the bottom is what separates
 * those two claims, and it is measured, not assumed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-lilnacho-1493-'));
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'claude');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');

const discover = require('./discover');
const status = require('./status');

test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

/* Same shape as discover.test.js's `seed`, extended for a folder that carries
   several sessions. `claudeMd === null` means the working folder exists and holds
   no instruction file, which is her second folder exactly. */
function seed(folderKey, cwdName, claudeMd, { transcripts = 1 } = {}) {
  const cwd = path.join(SB, 'work', cwdName);
  fs.mkdirSync(cwd, { recursive: true });
  if (claudeMd !== null) fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), claudeMd);
  const proj = path.join(SB, 'claude', 'projects', folderKey);
  fs.mkdirSync(proj, { recursive: true });
  for (let i = 0; i < transcripts; i += 1) {
    fs.writeFileSync(path.join(proj, `${folderKey}-sess-${i}.jsonl`),
      `{"type":"user"}\n{"cwd":${JSON.stringify(cwd)}}\n`);
  }
  return cwd;
}

/* Her real line, quoted rather than paraphrased: the bold markers are part of what
   the parser has to survive, and a fixture written as plain text would test a
   string she does not have. */
const HER_CLAUDE_MD = '# lilnacho\n\nYou are **lilnacho**, a project manager.\n';

seed('-Users-someone-work-workers-lilnacho', 'lilnacho', HER_CLAUDE_MD);
seed('-Users-someone', 'someone-home', null, { transcripts: 9 });

test('#1493: her shape resolves to exactly ONE agent, not two and not zero', () => {
  const r = discover.found();
  const names = (r.agents || []).map((a) => a.displayName || a.name);

  /* CONTROL FIRST, and it is not decoration: if the fixture produced no agents at
     all, every assertion below would pass for the wrong reason and this file would
     read as proof of a build that finds nobody. */
  assert.notEqual(names.length, 0,
    'the fixture found NOBODY, so this test cannot tell a correct build from the bug it is about');
  assert.deepEqual(names, ['lilnacho'],
    `expected exactly her, got ${JSON.stringify(names)}`);
});

test('#1493: the nine-transcript folder with no CLAUDE.md is DROPPED, and counted as present rather than gone', () => {
  const r = discover.found();
  /* The gone/present split (#1517) exists so this exact case is legible: a folder
     whose working directory is still on disk and simply holds no instruction file
     is a different fact from one whose directory was deleted, and only the first is
     a candidate somebody could act on. */
  assert.equal(r.skipped.noInstructions, 1, `noInstructions: ${JSON.stringify(r.skipped)}`);
  assert.equal(r.skipped.noInstructionsFolderPresent, 1,
    `her home folder is on disk, so it must count as PRESENT: ${JSON.stringify(r.skipped)}`);
  assert.equal(r.skipped.noInstructionsFolderGone, 0,
    `nothing was deleted in this fixture, so GONE must be 0: ${JSON.stringify(r.skipped)}`);
});

test('#1493: her actual line, bold markers and all, is what makes her an agent', () => {
  /* 🛑 THE BOLD MARKERS ARE LOAD-BEARING, AND I HAD THIS BACKWARDS. I first wrote
     that they are something the parser has to SURVIVE. Measured, they are what
     SAVES her:

       You are **lilnacho**, a project manager.   -> lilnacho, project manager
       You are lilnacho, a project manager.       -> NULL
       You are Lilnacho, a project manager.       -> Lilnacho, project manager
       You are lilnacho.                          -> NULL

     ⇒ A LOWERCASE NAME WITH NO BOLD MARKERS NAMES NOBODY. Either the markers or a
     capital letter carries it, and she happened to have the markers. Somebody who
     writes the same sentence in plain lowercase is dropped, and the screen they
     get is "we found no agents", which is #1493's exact symptom.

     📌 Carded rather than widened here. The heuristic is deliberately narrow and
     loosening it risks naming somebody out of ordinary prose, which #1168 and
     #1361 are both regressions of. This arm pins the CURRENT behaviour so the
     dependency is visible instead of incidental. */
  const id = status.identityFromText(HER_CLAUDE_MD);
  assert.ok(id && id.displayName, 'her own line no longer names anybody');
  assert.equal(id.displayName, 'lilnacho');

  /* And the negative arm, so the predicate is not simply saying yes to everything:
     her second folder's absence of any instruction file must NOT produce a name. */
  const none = status.identityFromText('# notes\n\nsome scratch text about a project.\n');
  assert.ok(!none || !none.displayName,
    'the predicate names somebody from prose that introduces nobody, so the arm above proves nothing');

  /* THE DEPENDENCY, PINNED. If a future change makes the plain lowercase form work,
     this assertion fails and whoever made it should DELETE this line and say so on
     #1493, because that is a fix and not a regression. Pinning it is how the
     dependency stops being invisible; it is not an endorsement of it. */
  const plainLower = status.identityFromText('# lilnacho\n\nYou are lilnacho, a project manager.\n');
  assert.ok(!plainLower || !plainLower.displayName,
    'the plain lowercase form now names somebody: that is an improvement, delete this arm and note it on #1493');
  const capital = status.identityFromText('# Lilnacho\n\nYou are Lilnacho, a project manager.\n');
  assert.equal(capital && capital.displayName, 'Lilnacho',
    'a capitalised name must still work, or the arm above is measuring something other than case');
});
