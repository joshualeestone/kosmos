'use strict';
/**
 * #1329 - THE ACCEPTANCE CRITERION, pre-existing-agents column, as a standing guard.
 *
 * Josh's 2x2 (his words, 2026-08-28): "how can we get this thing functioning with
 * Claude and OpenAI and either no agents or pre-existing agents?"
 *
 *                     | no existing agents        | pre-existing agents
 *   ------------------+---------------------------+------------------------------
 *   Claude            | fresh install, CREATE      | agents already here, ADOPT
 *   OpenAI            | fresh install, CREATE      | agents already here, ADOPT
 *
 * This file guards the RIGHT-HAND (pre-existing) column at the discovery/import-screen
 * layer, for BOTH providers, using Josh's own 10-agent seed corpus
 * (kosmos-seed-agents-2026-09-07). His test, verbatim: "can we find all ten from an
 * import perspective when it hits the screen to allow us to add them in the
 * installation process?" Reported symptom at 0.6.45: only 2 of 10 showed up.
 *
 * 🔑 THE SEAM THIS FILE SITS ON. "Find all ten" has two independent halves:
 *   1. CLASSIFICATION - given the files are REACHED, does discovery classify each
 *      correctly (right name, offered vs refused)? That is THIS file, and it is my
 *      lane (#2410 Gemini, #1938 disk scan, #1652 loose import).
 *   2. LOCATION reach - do the default roots REACH the places a person drops files
 *      (Documents/Downloads/Desktop via TCC, an arbitrary "Work" folder, the home
 *      root)? That is #2414 (Ice Cream Kitty) + the TCC hatch (#2125), NOT this file.
 * Measured 2026-09-07: on main, when the 10 files are reachable, discovery classifies
 * ALL TEN correctly (9 offered with names, the negative control refused). So the
 * "only 2 of 10" symptom is a LOCATION/reach failure, not a classification one - which
 * is exactly why this guard pins classification and leaves reach to #2414.
 *
 * 🛑 WHAT THIS FILE DOES NOT AND CANNOT DO: the LEFT-HAND (no-existing-agents / CREATE)
 * column is the fresh-install clean-machine test Josh runs himself (this card's
 * priority item 2). Driving createAgent on this nine-days-deep fleet machine is "created
 * and works on a machine that is NOT fresh" (Angel/Pete established that already); it is
 * not the cell, and this file does not pretend otherwise.
 *
 * 🛑 EVERY TEST IS SANDBOXED AND NEVER TOUCHES A REAL DIRECTORY - same contract as
 * discover.scan-1938 / discover.import-1652. Fixtures are inlined (byte-faithful to the
 * corpus) so the test is hermetic and does not depend on ~/.cache; all fixtures live
 * under one mkdtemp root and scan() is pointed at it, so os.homedir() is never walked.
 *
 * ⚠️ THE FOLDER NAMES UNDER THE SCAN ROOT ARE DELIBERATELY NEUTRAL (inbox/papers/work),
 * NOT Documents/Downloads/Desktop. Those three are in SCAN_SKIP: on a real machine they
 * are reached as explicit importScan ROOTS (a root is not self-skipped), but nested as
 * CHILDREN under a test root they are skipped during descent. Using them here would hide
 * fixtures and test the skip list, not classification. (This footgun cost the first probe
 * of this card three "missing" agents - recorded so the next reader does not repeat it.)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acc-1329-'));
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'claude');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');

const discover = require('./discover');

test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

/* ── The 10-agent corpus, inlined byte-faithful to kosmos-seed-agents-2026-09-07 ──── */
const CORPUS = {
  // #1 Kosmos-created (CLAUDE.md with kosmos:* splice blocks). Found by NAME.
  baron: '# You are **Fixture Baron** (a test fixture, not a real agent)\n\n'
    + '<!-- kosmos:you:start -->\nYou report to the person who runs this computer.\n<!-- kosmos:you:end -->\n\n'
    + '<!-- kosmos:projects:start -->\n<!-- kosmos:projects:end -->\n',
  // #2 POSITIVE CONTROL - standard "You are **Name**, a role." If this is missed, discovery is broken.
  nova: '# You are **Fixture Nova**, a test agent\n\nA standard current-format agent, a bold name on a "You are **Name**, a role." line.\n',
  // #4 Codex/OpenAI convention (AGENTS.md). The file itself introduces by name.
  codex: '# You are **Fixture Codex**, an OpenAI-run agent\n\nAn agent whose identity lives in an AGENTS.md file (the Codex/OpenAI convention).\n',
  // #5 hand-written, lowercase name (#1493). Must be OFFERED, never dropped.
  pip: '# pip\n\nYou are pip, a project manager who helps organize the family\'s projects.\n',
  // #6 second-profile agent - a CLAUDE.md-shaped file Claude never recorded a session for (#1938).
  work1: '# You are **Fixture Work1**, a second-profile agent\n\nLives in a second config profile that the transcript-read does not enumerate.\n',
  // #7 NEGATIVE CONTROL - no "You are ..." line. Must NOT be offered.
  notes: '# Build Notes\n\nThis document describes the build pipeline for the web frontend: the bundler config, the test runner, and the deploy step. It belongs to nobody.\n',
  // #7b OVER-EAGER - a template that introduces a ROLE not a person. Offered (documented cost).
  rust: '# Rust starter template\n\nYou are an expert Rust developer. Write idiomatic, memory-safe code and prefer `Result` over panics.\n',
};
// The 3 Gemini CLI custom-agent files: YAML front-matter name/description + body (#2410).
const GEMINI = {
  'code-reviewer': '---\nname: code-reviewer\ndescription: Reviews code for style and best practices.\n---\nYou are a helpful assistant that reviews code for readability, performance, and best practices.\n',
  'project-explainer': '---\nname: project-explainer\ndescription: Explains the project structure.\n---\nYou are a helpful assistant that explains the project structure and purpose to new team members.\n',
  'sarah': '---\nname: sarah\ndescription: An email assistant.\n---\nYou are a helpful assistant that helps draft and refine emails.\n',
};

/** Write a loose file under the scan disk. Returns its absolute path. */
function loose(disk, rel, body) {
  const abs = path.join(disk, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
}
/** Seed the 3 Gemini agent files into a sandbox gemini-home and point discovery at it.
 *  The home is a `.gemini` DOTDIR - byte-faithful to the real Gemini CLI layout, and
 *  the reason the walk never double-collects these files: it skips dotdirs, so the
 *  ONLY path that reaches them is the #2410 agentFiles() merge (which names them from
 *  front-matter). A non-dot `gemini/` under the scan root would be walked first and win
 *  with an empty looseRow name, masking the merge entirely. */
function seedGemini(root) {
  const home = path.join(root, '.gemini');
  const agents = path.join(home, 'agents');
  fs.mkdirSync(agents, { recursive: true });
  for (const [name, body] of Object.entries(GEMINI)) fs.writeFileSync(path.join(agents, `gemini-${name}.md`), body);
  return home;
}
// The three env vars discover.js's gemini-merge gate reads (`!explicit || geminiHomeOverridden`)
// AND geminisession.HOME() honours. A helper that manages only one of them leaves the other two
// free to point the merge at a real home on a CI box that has them ambiently exported.
const GEMINI_HOME_VARS = ['AGENT_WORKFORCE_GEMINI_HOME', 'GEMINI_CLI_HOME', 'AGENT_WORKFORCE_HOME'];
function withGeminiHome(home, fn) {
  // Set the canonical override AND clear the other two, so the fixture home is the ONLY one the
  // gate can see - a stray ambient GEMINI_CLI_HOME must not shadow or double the fixture.
  const prev = GEMINI_HOME_VARS.map((v) => [v, process.env[v]]);
  process.env.AGENT_WORKFORCE_GEMINI_HOME = home;
  delete process.env.GEMINI_CLI_HOME;
  delete process.env.AGENT_WORKFORCE_HOME;
  try { return fn(); } finally {
    for (const [v, val] of prev) { if (val === undefined) delete process.env[v]; else process.env[v] = val; }
  }
}
// Run fn with EVERY gemini-home override cleared, so the merge gate is deterministically off
// regardless of ambient CI env - used by the Part C perturbation arm.
function withNoGeminiHome(fn) {
  const prev = GEMINI_HOME_VARS.map((v) => [v, process.env[v]]);
  for (const v of GEMINI_HOME_VARS) delete process.env[v];
  try { return fn(); } finally {
    for (const [v, val] of prev) { if (val === undefined) delete process.env[v]; else process.env[v] = val; }
  }
}
const impByBase = (r, base) => (r.importable || []).find((c) => path.basename(c.file) === base);
const impNames = (r) => (r.importable || []).map((c) => c.name);

/* ───────────────────────────────────────────────────────────────────────────────────
   PART A - Josh's literal find-all-10 on the import screen (loose-file scenario).
   All 7 non-Gemini fixtures dropped as loose .md files across neutral folders, plus the
   3 Gemini agent files in their real store, then ONE scan() as the import screen runs it.
   ─────────────────────────────────────────────────────────────────────────────────── */
test('#1329 find-all-10: every seed agent is classified correctly at the import screen', () => {
  const DISK = fs.mkdtempSync(path.join(SB, 'find10-'));
  const f = {
    baron: loose(DISK, 'inbox/1-kosmos-created-fixture-baron.md', CORPUS.baron),
    nova: loose(DISK, 'papers/2-current-agent-fixture-nova.md', CORPUS.nova),
    codex: loose(DISK, 'work/4-codex-AGENTS-fixture-codex.md', CORPUS.codex),
    pip: loose(DISK, 'papers/5-handwritten-lowercase-pip.md', CORPUS.pip),
    work1: loose(DISK, 'work/6-second-profile-fixture-work1.md', CORPUS.work1),
    notes: loose(DISK, 'inbox/7-not-an-agent-build-notes.md', CORPUS.notes),
    rust: loose(DISK, 'work/7b-you-are-an-expert-rust-starter-template.md', CORPUS.rust),
  };
  const home = seedGemini(DISK);
  const r = withGeminiHome(home, () => discover.scan({ roots: [{ dir: DISK, maxDepth: 6 }] }));
  assert.equal(r.ok, true);
  assert.equal(r.scanning, false, 'no TCC roots here, so the scan is complete in one pass');

  // The 9 that MUST be offered, each with the name the import form will pre-fill.
  // (pip and rust names come from the #8 H1-heading fallback; the corpus README predates
  //  that fallback and says "empty name" - superseded here by the measured behaviour. The
  //  load-bearing requirement for both is that they are OFFERED, not dropped.)
  const expect = [
    [f.baron, 'baron', 'Fixture Baron'],
    [f.nova, 'nova', 'Fixture Nova'],
    [f.codex, 'codex', 'Fixture Codex'],
    [f.work1, 'work1', 'Fixture Work1'],
    [f.pip, 'pip', 'pip'],
    [f.rust, 'rust', 'Rust starter template'],
  ];
  for (const [abs, tag, name] of expect) {
    const row = impByBase(r, path.basename(abs));
    assert.ok(row, `${tag} was not offered on the import screen (importable: ${JSON.stringify(impNames(r))})`);
    assert.equal(row.name, name, `${tag} was offered under the wrong name`);
  }
  for (const g of ['code-reviewer', 'project-explainer', 'sarah']) {
    const row = impByBase(r, `gemini-${g}.md`);
    assert.ok(row, `Gemini agent ${g} was not offered (#2410 merge)`);
    assert.equal(row.name, g, `Gemini agent ${g} was offered under the wrong name`);
  }

  // The 10th: the NEGATIVE CONTROL must NOT be offered, and the folder that holds it WAS
  // read (baron is its folder-mate) - so the absence is a refusal, not an unscanned folder.
  assert.ok(!impByBase(r, path.basename(f.notes)), 'the negative control (build-notes) was wrongly offered');
  assert.ok(impByBase(r, path.basename(f.baron)), 'positive arm: the negative control folder was not even read');

  // Exactly 9 rows: no double-count of the Gemini files (they also carry a body "You are a
  // helpful assistant ...", which the generic looseRow would offer with an empty name - the
  // #2410 merge must claim them by front-matter name and not additionally as loose files).
  assert.equal(r.importable.length, 9, `expected exactly 9 offered rows, got ${r.importable.length}: ${JSON.stringify(impNames(r))}`);
});

/* ───────────────────────────────────────────────────────────────────────────────────
   PART B - the two controls, isolated, so a regression in either is legible on its own.
   ─────────────────────────────────────────────────────────────────────────────────── */
test('#1329 POSITIVE CONTROL: the standard "You are **Name**, a role." agent is found by name', () => {
  const DISK = fs.mkdtempSync(path.join(SB, 'pos-'));
  const f = loose(DISK, 'proj/nova.md', CORPUS.nova);
  const row = impByBase(discover.scan({ roots: [{ dir: DISK, maxDepth: 3 }] }), path.basename(f));
  assert.ok(row, 'the positive control was not found - discovery is broken, not merely conservative');
  assert.equal(row.name, 'Fixture Nova');
});

test('#1329 NEGATIVE CONTROL: a file with no "You are ..." line is refused (folder proven read)', () => {
  const DISK = fs.mkdtempSync(path.join(SB, 'neg-'));
  const note = loose(DISK, 'gate/7-not-an-agent-build-notes.md', CORPUS.notes);
  const real = loose(DISK, 'gate/realone.md', '# You are **GateReal**, an analyst\n\nInstructions.\n');
  const r = discover.scan({ roots: [{ dir: path.join(DISK, 'gate'), maxDepth: 1 }] });
  assert.ok(impByBase(r, path.basename(real)), 'positive arm: the scan did not read this folder at all');
  assert.ok(!impByBase(r, path.basename(note)), 'a plain build-notes file was wrongly offered as an agent');
});

test('#1329 #1493: a hand-written lowercase-name file is OFFERED, never dropped', () => {
  const DISK = fs.mkdtempSync(path.join(SB, 'pip-'));
  const f = loose(DISK, 'proj/pip.md', CORPUS.pip);
  const row = impByBase(discover.scan({ roots: [{ dir: DISK, maxDepth: 3 }] }), path.basename(f));
  assert.ok(row, 'the hand-written lowercase agent (#1493) was dropped - it must be offered for the person to name');
  // Intent seen; the name shown is the H1 heading (#8 fallback), which is the value the
  // import form pre-fills. A blank was the pre-#8 behaviour; either way it is OFFERED.
  assert.equal(row.name, 'pip');
});

/* ───────────────────────────────────────────────────────────────────────────────────
   PART C - the Gemini #2410 merge, with a perturbation control that CAN fail.
   ─────────────────────────────────────────────────────────────────────────────────── */
test('#1329 #2410: Gemini agents surface by front-matter name, and vanish when the home is absent', () => {
  const DISK = fs.mkdtempSync(path.join(SB, 'gem-'));
  const home = seedGemini(DISK);
  // A non-agent loose file present too, so the scan has real work and the count is meaningful.
  loose(DISK, 'proj/notes.md', CORPUS.notes);

  const withHome = withGeminiHome(home, () => discover.scan({ roots: [{ dir: DISK, maxDepth: 4 }] }));
  const gnames = (withHome.importable || []).filter((c) => path.basename(c.file).startsWith('gemini-')).map((c) => c.name).sort();
  assert.deepEqual(gnames, ['code-reviewer', 'project-explainer', 'sarah'], 'the 3 Gemini agents did not all surface by front-matter name');

  // PERTURBATION: drop the gemini-home override and re-run with the same explicit roots.
  // What this proves cleanly, on any machine: the fixture's 3 files live under a `.gemini`
  // DOTDIR, which the walk skips, so with no override reaching them they must vanish. If the
  // walk ever stopped skipping dotdirs, stillGemini would go non-zero here regardless of the
  // operator's real home - so this is a real, machine-independent guard on the dotdir skip.
  // (It does NOT independently prove the explicit-roots gate `!explicit || override`: on a
  // machine with no real ~/.gemini/agents a gate regression would also yield 0. The gate's
  // job - never read the real home under explicit roots - is asserted by the whole file's
  // hermeticity contract, not by this arm alone.)
  const noHome = withNoGeminiHome(() => discover.scan({ roots: [{ dir: DISK, maxDepth: 4 }] }));
  const stillGemini = (noHome.importable || []).filter((c) => path.basename(c.file).startsWith('gemini-'));
  assert.equal(stillGemini.length, 0, 'the Gemini fixture surfaced with no home override - the walk is no longer skipping the .gemini dotdir');
});

/* ───────────────────────────────────────────────────────────────────────────────────
   PART D - the folder-marker placements the corpus documents (CLAUDE.md folder, and a
   Claude-recorded folder), so the pre-existing column is covered in the shapes a real
   machine actually has, not only as loose downloads.
   ─────────────────────────────────────────────────────────────────────────────────── */
test('#1329 CLAUDE.md folder is a connect candidate by name; a Claude-recorded folder is owned by found()', () => {
  // Only CONFIG_ROOT is swapped: found()'s configRoots reads it live per call, so this test
  // gets its own Claude records dir. AGENT_WORKFORCE_DATA is deliberately NOT swapped - store
  // paths (declined/dismiss/profiles) are resolved once at module require() time, so a per-test
  // DATA swap would be inert; this test touches none of them, and the module-load SB/data keeps
  // it sandboxed regardless.
  const CFG = fs.mkdtempSync(path.join(SB, 'cfg-'));
  const prevCfg = process.env.AGENT_WORKFORCE_CONFIG_ROOT;
  process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(CFG, 'claude');
  try {
    const DISK = fs.mkdtempSync(path.join(SB, 'folders-'));
    // Nova as a CLAUDE.md folder that Claude never recorded -> a connect candidate.
    const novaDir = path.join(DISK, 'nova-folder');
    fs.mkdirSync(novaDir, { recursive: true });
    fs.writeFileSync(path.join(novaDir, 'CLAUDE.md'), CORPUS.nova);
    // Baron as a CLAUDE.md folder WITH a Claude session record -> found() owns it by name.
    const baronDir = path.join(DISK, 'baron-recorded');
    fs.mkdirSync(baronDir, { recursive: true });
    fs.writeFileSync(path.join(baronDir, 'CLAUDE.md'), CORPUS.baron);
    const proj = path.join(CFG, 'claude', 'projects', 'baron-recorded');
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, 'baron-recorded-sess.jsonl'),
      `{"type":"user"}\n{"cwd":${JSON.stringify(baronDir)}}\n`);

    const f = discover.found();
    const baronFound = f.agents.find((a) => a.dir === baronDir);
    assert.ok(baronFound, 'the Kosmos-created recorded folder was not found by found()');
    assert.equal(baronFound.name, 'Fixture Baron');
    assert.ok(!(f.adoptable || []).some((a) => a.dir === baronDir), 'a cleanly-named agent must not be offered as adoptable (#1938)');

    const r = discover.scan({ roots: [{ dir: DISK, maxDepth: 3 }] });
    const novaCand = r.candidates.find((c) => c.dir === novaDir);
    assert.ok(novaCand, 'the CLAUDE.md folder was not offered as a connect candidate');
    assert.equal(novaCand.name, 'Fixture Nova');
    // Complementary, not overlapping: found() already owns the recorded folder, so the scan
    // must not also list it (a worse duplicate of a better offer).
    assert.ok(!r.candidates.some((c) => c.dir === baronDir), 'the recorded folder was double-listed by the scan');
  } finally {
    process.env.AGENT_WORKFORCE_CONFIG_ROOT = prevCfg;
  }
});

/* ───────────────────────────────────────────────────────────────────────────────────
   PART E - the OpenAI provider, through its OWN code path. The pre-existing column is
   "Claude AND OpenAI". Parts A/B/D already cover the Claude family (CLAUDE.md via found()
   and scan). This part covers the OpenAI/Codex family through the mechanism that actually
   distinguishes it - foundCodex reading an AGENTS.md named by a codex rollout - not a loose
   .md that happens to say "You are ...", which looseRow parses identically whatever the
   provider. The row it produces carries runner='codex', the real provider signal, which is
   what makes this a distinct guard rather than a duplicate of the positive control.
   (This is corpus fixture #4's documented "real Codex path: codexIdentity -> identityFromText".)
   ─────────────────────────────────────────────────────────────────────────────────── */
test('#1329 OpenAI pre-existing: an AGENTS.md agent is found through foundCodex, with runner=codex', () => {
  const root = fs.mkdtempSync(path.join(SB, 'codex-'));
  const codexHome = path.join(root, 'codex');
  fs.mkdirSync(path.join(codexHome, 'sessions', '2026', '09', '07'), { recursive: true });
  const work = path.join(root, 'proj');
  fs.mkdirSync(work, { recursive: true });
  // The Codex/OpenAI convention: identity lives in AGENTS.md, read by codexIdentity.
  fs.writeFileSync(path.join(work, 'AGENTS.md'), CORPUS.codex);
  // A rollout the real reader accepts: session_meta MUST be the first line (metaOf reads the
  // head), and its cwd points at the folder whose AGENTS.md names the agent.
  const rf = path.join(codexHome, 'sessions', '2026', '09', '07', 'rollout-2026-09-07T04-00-00-fixturecodex.jsonl');
  fs.writeFileSync(rf, JSON.stringify({
    timestamp: '2026-09-07T04:00:00.000Z', ordinal: 0, type: 'session_meta',
    payload: { session_id: 'fixturecodex', cwd: work, originator: 'codex-tui' },
  }) + '\n');
  // foundCodex bails when status.sandboxIsInconsistent() is true, and that predicate is
  // `AGENT_WORKFORCE_DATA under tmp && home not under tmp` - which the file-level DATA sandbox
  // makes true. So for this one call, unset DATA (restored in finally). Hermeticity is NOT
  // weakened: foundCodex reads only the CODEX_HOME we point at the sandbox, never the real
  // ~/.codex, and it touches nothing under DATA. This mirrors discover.codex.test.js, which
  // simply never sets DATA at all.
  const prevCodex = process.env.AGENT_WORKFORCE_CODEX_HOME;
  const prevData = process.env.AGENT_WORKFORCE_DATA;
  process.env.AGENT_WORKFORCE_CODEX_HOME = codexHome;
  delete process.env.AGENT_WORKFORCE_DATA;
  try {
    const r = discover.foundCodex(undefined);
    const hit = r.agents.find((a) => a.name === 'Fixture Codex');
    assert.ok(hit, `the OpenAI/Codex agent was not found by foundCodex (agents: ${JSON.stringify(r.agents.map((a) => a.name))})`);
    assert.equal(hit.runner, 'codex', 'the found row does not record the OpenAI/Codex provider - the provider distinction this part exists to prove');
  } finally {
    if (prevCodex === undefined) delete process.env.AGENT_WORKFORCE_CODEX_HOME;
    else process.env.AGENT_WORKFORCE_CODEX_HOME = prevCodex;
    if (prevData === undefined) delete process.env.AGENT_WORKFORCE_DATA;
    else process.env.AGENT_WORKFORCE_DATA = prevData;
  }
});
