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
 * ⇒ **`found()` returns ONE AGENT and ONE DROP.** Not two agents, and not zero.
 * Those are the two ways the ENGINE can be wrong and they fail in opposite
 * directions: two means a bare home directory somebody once ran Claude in is being
 * reported as an agent, and zero is the bug she reported.
 *
 * 🛑 THE SHIP CRITERION IS NO LONGER "THE BUILD SHOWS ONE", AND THIS FILE MUST NOT
 * BE READ AS IF IT WERE (Splinter, 2026-08-29 18:47). Once the adoption surface
 * exists, a correct build shows TWO THINGS: lilnacho as an agent, AND the
 * unidentified folder OFFERED for adoption. **Anyone gating a cut on "shows 1" is
 * testing against a stale target.**
 *
 * ⭐ THE ASSERTIONS BELOW ARE UNAFFECTED AND THAT IS THE POINT OF SAYING THIS. They
 * are claims about `found()`, which correctly returns one agent and one
 * `noInstructionsFolderPresent`. The moved criterion is about what the BOARD DOES
 * WITH THAT DROP, which is a different layer and is not asserted here. **The
 * numbers stayed right and the sentence around them went stale**, which is the
 * shape that makes a comment a live instruction rather than a description (#1510).
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
const { execFileSync } = require('node:child_process');

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

/**
 * 🛑 HER TWO CONFIG ROOTS, WHICH THE FIXTURE ABOVE CANNOT EXERCISE (Splinter).
 *
 * Her dump shows the SAME two project folders under BOTH roots:
 *
 *   ~/.claude/projects/-Users-caseywinner-work-workers-lilnacho/       1 jsonl
 *   ~/.claude/projects/-Users-caseywinner/                             9 jsonl
 *   ~/.claude-work1/projects/-Users-caseywinner-work-workers-lilnacho/ 1 jsonl
 *   ~/.claude-work1/projects/-Users-caseywinner/                       9 jsonl
 *
 * `configRoots()` accepts both (`.claude` and `.claude-*`), so the ship gate's real
 * question is DEDUP: **does the same agent, reachable through two roots, appear
 * ONCE or TWICE?** The criterion is "the probe says N, the build shows N", and N=1.
 * ⚠️ A build showing TWO lilnachos fails that gate exactly as hard as one showing
 * zero, and the single-root fixture above passes either way.
 *
 * 📌 NOT REDUNDANT, CHECKED RATHER THAN ASSUMED. No discovery test sets more than
 * one config root: `discover.test.js` pins `AGENT_WORKFORCE_CONFIG_ROOT` seven
 * times and always to one directory, and the sibling "two project folders pointing
 * at one directory are one agent" covers dedup WITHIN a root. The across-roots walk
 * is a different loop and nothing was exercising it.
 *
 * This one sandboxes `HOME` rather than setting `AGENT_WORKFORCE_CONFIG_ROOT`,
 * because that override returns a SINGLE root and would bypass the very scan under
 * test. Same reason as the #1523 arms.
 */
test('#1493: the same agent under TWO config roots is ONE agent, not two', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1493-tworoots-'));
  const cwd = path.join(home, 'work', 'workers', 'lilnacho');
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), HER_CLAUDE_MD);
  const homeCwd = path.join(home, 'homedir');
  fs.mkdirSync(homeCwd, { recursive: true });

  for (const root of ['.claude', '.claude-work1']) {
    const named = path.join(home, root, 'projects', '-Users-caseywinner-work-workers-lilnacho');
    fs.mkdirSync(named, { recursive: true });
    fs.writeFileSync(path.join(named, 'a.jsonl'), `{"type":"user"}\n{"cwd":${JSON.stringify(cwd)}}\n`);
    const bare = path.join(home, root, 'projects', '-Users-caseywinner');
    fs.mkdirSync(bare, { recursive: true });
    for (let i = 0; i < 9; i += 1) {
      fs.writeFileSync(path.join(bare, `s${i}.jsonl`), `{"type":"user"}\n{"cwd":${JSON.stringify(homeCwd)}}\n`);
    }
  }

  const out = execFileSync(process.execPath, ['-e', `
    const d = require(${JSON.stringify(path.join(__dirname, 'discover.js'))});
    const s = require(${JSON.stringify(path.join(__dirname, 'status.js'))});
    const r = d.found();
    console.log(JSON.stringify({
      roots: s.configRoots().length,
      names: (r.agents || []).map((a) => a.displayName || a.name),
      skipped: r.skipped,
    }));`], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, AGENT_WORKFORCE_DATA: path.join(home, 'data'),
           AGENT_WORKFORCE_CONFIG_ROOT: '', CLAUDE_CONFIG_DIR: '' },
  });
  const got = JSON.parse(out.trim().split('\n').pop());

  /* CONTROL FIRST: if only one root was walked, a count of one proves nothing at
     all, because there was never a second copy to deduplicate. */
  assert.equal(got.roots, 2,
    `only ${got.roots} config root(s) were walked, so the dedup below is vacuous`);
  assert.deepEqual(got.names, ['lilnacho'],
    `the same agent under two roots resolved to ${JSON.stringify(got.names)}`);

  /* And the drops dedup on the same axis: ONE bare home folder, not one per root. */
  assert.equal(got.skipped.noInstructions, 1,
    `the same instruction-less folder was counted once per root: ${JSON.stringify(got.skipped)}`);

  fs.rmSync(home, { recursive: true, force: true });
});

/**
 * 🛑 THE SHAPE THAT ACTUALLY PRODUCES HER SYMPTOM, PINNED AS A GAP (Splinter's
 * reframe). CONSTRUCTED, NOT SAMPLED, and that distinction is the whole reason it
 * exists: nobody here can see her disk, but the shape can be built and measured.
 *
 * If a person sets their agents up by running Claude IN THEIR HOME rather than in
 * per-agent folders, then **every agent shares ONE cwd and none of them has a
 * `CLAUDE.md`**. Measured on that shape:
 *
 *   agents found : []
 *   skipped      : noInstructions 1, noInstructionsFolderPresent 1
 *
 * ⇒ **"We found no agents on this computer", which is exactly what she reported**,
 * while three agents live in those transcripts and not one is reachable. Discovery
 * reads the identity FILE, and there is no file.
 *
 * ✅ AND HER DISK WAS THEN CONFIRMED TO HAVE THIS SHAPE (Splinter, 2026-08-29 18:26),
 * so this is a diagnosis and not only a reproduction. **The order it happened in is
 * the part worth keeping: the shape was CONSTRUCTED here and measured to produce the
 * symptom BEFORE anybody could look at her machine.** Nothing on this fleet could
 * have sampled it, because every machine here has the CLAUDE.md that makes the case
 * vanish.
 *
 * 📌 Written first as "a sufficient explanation, not a diagnosis", which was the
 * honest claim at the time. Updating it rather than leaving the hedge, because a
 * justification that outlives its premise is a live instruction (#1510).
 *
 * ✅ AND THE RECOVERABILITY QUESTION IS NOW SETTLED: EXTRACTION IS DEAD, measured on
 * her actual disk (Splinter, 2026-08-29). No name is cleanly pullable from those
 * transcripts. **That does not weaken this test, it simplifies the feature it
 * guards**: the design is the small one, never guess a name, ask for it. So the
 * folder is offered with an EMPTY editable field and nothing is asserted about who
 * lives there.
 *
 * 📌 Written first as "not a claim that the names are recoverable", which was the
 * honest hedge while it was open. Updating rather than leaving it, for the same
 * reason as the paragraph above.
 *
 * 📌 THIS TEST EXISTS TO BE DELETED. Whoever teaches discovery to read a transcript
 * for an identity should change these assertions rather than work around them, and
 * will find this paragraph when they do.
 */
test('#1493 GAP: one shared cwd with no CLAUDE.md yields ZERO agents, whatever the transcripts say', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1493-onecwd-'));
  const cwd = path.join(home, 'caseywinner');
  fs.mkdirSync(cwd, { recursive: true });
  const proj = path.join(home, '.claude', 'projects', '-Users-caseywinner');
  fs.mkdirSync(proj, { recursive: true });
  const who = ['lilnacho', 'josh', 'sarah'];
  for (let i = 0; i < 9; i += 1) {
    fs.writeFileSync(path.join(proj, `s${i}.jsonl`),
      `{"type":"user","message":{"content":"You are ${who[i % 3]}, a project manager."}}\n`
      + `{"cwd":${JSON.stringify(cwd)}}\n`);
  }

  const out = execFileSync(process.execPath, ['-e', `
    const d = require(${JSON.stringify(path.join(__dirname, 'discover.js'))});
    const r = d.found();
    console.log(JSON.stringify({ names: (r.agents || []).map((a) => a.displayName || a.name), skipped: r.skipped }));`], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, AGENT_WORKFORCE_DATA: path.join(home, 'data'),
           AGENT_WORKFORCE_CONFIG_ROOT: '', CLAUDE_CONFIG_DIR: '' },
  });
  const got = JSON.parse(out.trim().split('\n').pop());

  /* CONTROL: the fixture must actually have been read, or "zero agents" is just a
     walk that found no folders and this pins nothing. */
  assert.equal(got.skipped.noInstructions, 1,
    `the folder was not even reached: ${JSON.stringify(got.skipped)}`);
  assert.equal(got.skipped.noInstructionsFolderPresent, 1,
    `the cwd exists on disk, so it must count as PRESENT: ${JSON.stringify(got.skipped)}`);
  assert.deepEqual(got.names, [],
    'discovery now reads an identity out of a transcript, which is a FIX: delete this test and say so on #1493');

  fs.rmSync(home, { recursive: true, force: true });
});
