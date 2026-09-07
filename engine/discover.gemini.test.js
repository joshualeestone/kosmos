'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * #2243 part 2: a Gemini user's agents were invisible to discovery.
 *
 * found()/foundCodex walked ~/.claude/projects and ~/.codex; a person whose agent
 * files sit beside a GEMINI.md (the disk sibling of CLAUDE.md/AGENTS.md) was a
 * whole missing population. Measured layout on this machine:
 *   <GEMINI_CLI_HOME>/projects.json = { "projects": { "<abs-cwd>": "<name>" } }
 *   <cwd>/GEMINI.md                 = the project instructions ("You are <name>...")
 * foundGemini reads projects.json for the cwds and identityFromText on each
 * GEMINI.md for the name, exactly as the CLAUDE.md arm does.
 */

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'renet-gemini-'));
  fs.mkdirSync(path.join(root, 'gemini'), { recursive: true });
  return root;
}
// The projects.json map the real foundGemini reads (keys are absolute cwds).
function projectsJson(root, map) {
  fs.writeFileSync(path.join(root, 'gemini', 'projects.json'),
    JSON.stringify({ projects: map }) + '\n');
}
// #2243 part 3: the second enumeration source. history/<name>/.project_root holds
// one absolute cwd (byte-identical to that project's projects.json key when both exist).
function historyRoot(root, name, cwd) {
  const dir = path.join(root, 'gemini', 'history', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.project_root'), cwd + '\n');
}
function withGeminiHome(root, fn) {
  const prev = process.env.AGENT_WORKFORCE_GEMINI_HOME;
  process.env.AGENT_WORKFORCE_GEMINI_HOME = path.join(root, 'gemini');
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_GEMINI_HOME;
    else process.env.AGENT_WORKFORCE_GEMINI_HOME = prev;
  }
}
const discover = require('./discover');
// #2243 part 3: some assertions target projects() directly. foundGemini has its OWN
// by-directory de-dupe (discover.js byDir), so a double-count or a bad cwd out of
// projects() is masked when observed through foundGemini -- the guards live in
// projects(), so they must be pinned there.
const geminisession = require('./geminisession');

test('#2243: a Gemini agent is found from GEMINI.md via projects.json', () => {
  const root = sandbox();
  const work = path.join(root, 'proj'); fs.mkdirSync(work);
  fs.writeFileSync(path.join(work, 'GEMINI.md'), '# You are Gemini Tester, a project manager.\n\nSome text.\n');
  projectsJson(root, { [work]: 'proj' });
  const r = withGeminiHome(root, () => discover.foundGemini(undefined));
  assert.equal(r.agents.length, 1, 'a Gemini agent with a GEMINI.md was not found');
  assert.equal(r.agents[0].name, 'Gemini Tester');
  assert.equal(r.agents[0].runner, 'gemini', 'the row does not say which provider it came from');
  assert.equal(r.agents[0].instructions, path.join(work, 'GEMINI.md'));
});

test('#2243: a Gemini PROJECT with no GEMINI.md is NOT an agent (the common case)', () => {
  const root = sandbox();
  const work = path.join(root, 'noagent'); fs.mkdirSync(work);
  // A plain repo Gemini ran in once, like the real gemini-probe on this machine.
  fs.writeFileSync(path.join(work, 'package.json'), '{}\n');
  projectsJson(root, { [work]: 'noagent' });
  const r = withGeminiHome(root, () => discover.foundGemini(undefined));
  assert.equal(r.agents.length, 0, 'a Gemini project with no GEMINI.md was wrongly offered as an agent');
  assert.equal(r.unreadable, 0, 'a project with no GEMINI.md is not an agent, so it must not raise unreadable');
});

test('#2243 CONTROL: a GEMINI.md that introduces NOBODY is not a named agent (never guess a name)', () => {
  const root = sandbox();
  const work = path.join(root, 'proj'); fs.mkdirSync(work);
  // No "You are <name>" line -> identityFromText returns null AND INTRODUCES is
  // false -> genuinely not an agent, the same rule and reason as the CLAUDE.md
  // arm. This control can return the dangerous answer: if foundGemini offered any
  // GEMINI.md, it would red here.
  fs.writeFileSync(path.join(work, 'GEMINI.md'), '# Project setup\n\nRun npm install first, then npm test.\n');
  projectsJson(root, { [work]: 'proj' });
  const r = withGeminiHome(root, () => discover.foundGemini(undefined));
  assert.equal(r.agents.length, 0, 'an un-named GEMINI.md was offered as an agent, which guesses a name');
  assert.equal(r.unreadable, 0, 'a GEMINI.md that introduces nobody must NOT be counted unreadable (it is not an agent)');
});

test('#2243 (foundCodex parity, #1527): a GEMINI.md that INTRODUCES somebody but names nobody is COUNTED, not silently dropped', () => {
  const root = sandbox();
  const work = path.join(root, 'proj'); fs.mkdirSync(work);
  // "You are lilnacho" -> INTRODUCES matches, but identityFromText cannot read the
  // lowercase name. That is an agent we could not NAME, not a non-agent: it must
  // raise unreadable so the board surfaces "we skipped one", exactly as foundCodex
  // counts an unreadable rollout -- and it must NOT be offered under a guessed name.
  // This is the discriminating twin of the CONTROL above: identical shape, differing
  // ONLY in whether the file introduces somebody, so it pins the INTRODUCES gate in
  // both directions (0 for a non-agent, 1 for an un-nameable agent).
  fs.writeFileSync(path.join(work, 'GEMINI.md'), 'You are lilnacho, a pm.\n');
  projectsJson(root, { [work]: 'proj' });
  const r = withGeminiHome(root, () => discover.foundGemini(undefined));
  assert.equal(r.agents.length, 0, 'an un-named agent must not be offered under a guessed name');
  assert.equal(r.unreadable, 1, 'an introduced-but-unnamed GEMINI.md was silently dropped, the #1527 defect the NIT names');
});

test('#2243: a missing or malformed projects.json yields no agents and never throws', () => {
  const root = sandbox();  // no projects.json written at all
  const r1 = withGeminiHome(root, () => discover.foundGemini(undefined));
  assert.equal(r1.agents.length, 0, 'a missing projects.json should be an empty answer, not a throw');
  fs.writeFileSync(path.join(root, 'gemini', 'projects.json'), 'not json{');
  const r2 = withGeminiHome(root, () => discover.foundGemini(undefined));
  assert.equal(r2.agents.length, 0, 'a malformed projects.json was not tolerated as empty');
});

test('#2243 part 3: a Gemini agent recorded ONLY in history/<name>/.project_root (absent from projects.json) is found', () => {
  const root = sandbox();
  const work = path.join(root, 'histproj'); fs.mkdirSync(work);
  fs.writeFileSync(path.join(work, 'GEMINI.md'), '# You are History Agent, a project manager.\n\nText.\n');
  // projects.json exists but does NOT list this cwd -- an agent that ran before the
  // project landed in projects.json, or whose projects.json was cleared. Part 2's
  // projects.json-only read left this whole population invisible (its weakest premise).
  projectsJson(root, {});
  historyRoot(root, 'histproj', work);
  const r = withGeminiHome(root, () => discover.foundGemini(undefined));
  assert.equal(r.agents.length, 1, 'a Gemini agent recorded only in history/.project_root was invisible');
  assert.equal(r.agents[0].name, 'History Agent');
  assert.equal(r.agents[0].runner, 'gemini', 'the row does not say which provider it came from');
  assert.equal(r.agents[0].instructions, path.join(work, 'GEMINI.md'));
});

test('#2243 part 3: a cwd in BOTH projects.json and history is unioned ONCE (de-duped)', () => {
  const root = sandbox();
  const work = path.join(root, 'both'); fs.mkdirSync(work);
  fs.writeFileSync(path.join(work, 'GEMINI.md'), '# You are Both Agent, a pm.\n\nText.\n');
  projectsJson(root, { [work]: 'both' });
  historyRoot(root, 'both', work);
  // Assert at the projects() level, NOT through foundGemini: foundGemini's own byDir
  // de-dupe would mask a double-count here, making a foundGemini assertion vacuous. This
  // one CAN return the dangerous answer -- remove the seen-set de-dupe in projects() and
  // it reads 2.
  const cwds = withGeminiHome(root, () => geminisession.projects());
  assert.equal(cwds.filter((c) => c === work).length, 1, 'a cwd in both sources was returned twice (the union did not de-dupe)');
  assert.equal(cwds.length, 1, 'projects() returned an unexpected extra cwd');
  // And end-to-end it is still one agent.
  const r = withGeminiHome(root, () => discover.foundGemini(undefined));
  assert.equal(r.agents.length, 1, 'a cwd recorded in both sources was offered twice');
});

test('#2243 part 3: a trailing-slash divergence between the two sources de-dupes to ONE row', () => {
  const root = sandbox();
  const work = path.join(root, 'slash'); fs.mkdirSync(work);
  fs.writeFileSync(path.join(work, 'GEMINI.md'), '# You are Slash Agent, a pm.\n\nText.\n');
  projectsJson(root, { [work]: 'slash' });   // projects.json: no trailing slash
  historyRoot(root, 'slash', work + '/');    // history: trailing slash -- same dir, spelled differently
  // Without the trailing-slash strip these are two distinct strings that both survive
  // de-dupe, and foundGemini keys byDir on the raw cwd, so the SAME agent shows TWICE.
  const cwds = withGeminiHome(root, () => geminisession.projects());
  assert.equal(cwds.length, 1, 'a trailing-slash divergence produced two cwds for one directory');
  const r = withGeminiHome(root, () => discover.foundGemini(undefined));
  assert.equal(r.agents.length, 1, 'the SAME agent surfaced twice from a trailing-slash divergence');
});

test('#2243 part 3: a multi-line .project_root reduces to its first-line cwd, not an embedded-newline string', () => {
  const root = sandbox();
  const work = path.join(root, 'multi'); fs.mkdirSync(work);
  fs.writeFileSync(path.join(work, 'GEMINI.md'), '# You are Multi Agent, a pm.\n\nText.\n');
  projectsJson(root, {});
  // A malformed/multi-line .project_root: the first line is the cwd; extra lines must
  // not survive as an embedded newline (which passes isAbsolute and defeats de-dupe).
  const dir = path.join(root, 'gemini', 'history', 'multi'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.project_root'), work + '\nstray second line\n');
  const cwds = withGeminiHome(root, () => geminisession.projects());
  assert.deepEqual(cwds, [work], 'a multi-line .project_root did not reduce to its first-line cwd');
  const r = withGeminiHome(root, () => discover.foundGemini(undefined));
  assert.equal(r.agents.length, 1, 'the first-line cwd was not read as an agent');
});

test('#2243 part 3: a CRLF .project_root de-dupes cleanly (the \\r is stripped)', () => {
  // Gemini on Windows would write a CRLF line ending; split('\n') leaves a trailing \r,
  // which add()'s trim() strips BEFORE isAbsolute/de-dupe, so it de-dupes against the
  // clean projects.json key rather than surfacing the same agent twice.
  const root = sandbox();
  const work = path.join(root, 'crlf'); fs.mkdirSync(work);
  fs.writeFileSync(path.join(work, 'GEMINI.md'), '# You are CRLF Agent, a pm.\n\nText.\n');
  projectsJson(root, { [work]: 'crlf' });
  const dir = path.join(root, 'gemini', 'history', 'crlf'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.project_root'), work + '\r\n');
  const cwds = withGeminiHome(root, () => geminisession.projects());
  assert.deepEqual(cwds, [work], 'a CRLF .project_root left a \\r that broke de-dupe or isAbsolute');
  const r = withGeminiHome(root, () => discover.foundGemini(undefined));
  assert.equal(r.agents.length, 1, 'a CRLF .project_root surfaced the agent twice or not at all');
});

test('#2243 part 3: a missing / blank / relative .project_root is skipped and never throws', () => {
  const root = sandbox();
  projectsJson(root, {});
  // A history subdir with NO .project_root, and one whose .project_root is blank, and
  // one relative -- each must be skipped, not throw and not add a bad cwd.
  fs.mkdirSync(path.join(root, 'gemini', 'history', 'noroot'), { recursive: true });
  const blank = path.join(root, 'gemini', 'history', 'blank'); fs.mkdirSync(blank);
  fs.writeFileSync(path.join(blank, '.project_root'), '   \n');
  const rel = path.join(root, 'gemini', 'history', 'rel'); fs.mkdirSync(rel);
  fs.writeFileSync(path.join(rel, '.project_root'), 'relative/path\n');
  // Pin the guards where they live (projects()), not downstream: a blank value must be
  // dropped by the trim+isAbsolute check and a relative value by isAbsolute, so projects()
  // returns NO cwd at all. (Through foundGemini this would pass anyway - no GEMINI.md at a
  // bad cwd - so the assertion has to be here to mean anything.)
  const cwds = withGeminiHome(root, () => geminisession.projects());
  assert.deepEqual(cwds, [], 'a blank/relative .project_root leaked a bad cwd out of projects(), or a missing one threw');
  const r = withGeminiHome(root, () => discover.foundGemini(undefined));
  assert.equal(r.agents.length, 0, 'a blank/missing/relative .project_root should be skipped, not throw or add a bad cwd');
  assert.equal(r.unreadable, 0, 'a skipped history entry must not raise unreadable');
});
