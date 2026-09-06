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
function withGeminiHome(root, fn) {
  const prev = process.env.AGENT_WORKFORCE_GEMINI_HOME;
  process.env.AGENT_WORKFORCE_GEMINI_HOME = path.join(root, 'gemini');
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_GEMINI_HOME;
    else process.env.AGENT_WORKFORCE_GEMINI_HOME = prev;
  }
}
const discover = require('./discover');

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
