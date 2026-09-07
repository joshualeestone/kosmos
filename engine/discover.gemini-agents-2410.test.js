'use strict';

/**
 * #2410: Gemini CLI custom-agent files in <gemini-home>/agents/*.md are invisible to
 * discovery on two compounding counts:
 *   1. LOCATION -- ~/.gemini/agents/ is a dotdir the disk scan skips.
 *   2. IDENTITY -- the name is in the YAML front-matter `name:`, and the body is a
 *      generic "You are a helpful assistant ..." that identityFromText reads as naming
 *      nobody, so importAgent refused the file and looseRow would offer an empty name.
 *
 * The fix routes them through the loose-file/importable path (imported by-file via the
 * create form), NOT foundGemini (dir-keyed, connect cannot launch a bare file):
 *   - geminisession.agentFiles() reads <HOME()>/agents/*.md directly (dotdir skip N/A).
 *   - agentfile.geminiIdentity() names them from the front-matter.
 *   - discover.scan() merges them into importable with that name.
 *
 * Every refusal below is paired with an accept on the same path, so a green is evidence.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'renet-gemini-agents-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const agentfile = require('./agentfile');
const geminisession = require('./geminisession');
const discover = require('./discover');
const status = require('./status');
const create = require('./create');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const deps = { identityFromText: status.identityFromText, nameUsable: create.nameUsable, nameProblem: create.nameProblem };

// The three real seed shapes (Josh's files, byte-for-byte structure).
const GEMINI = {
  'code-reviewer.md': '---\nname: code-reviewer\ndescription: Reviews code for style and best practices.\n---\nYou are a helpful assistant that reviews code for readability, performance, and best practices.\n',
  'project-explainer.md': '---\nname: project-explainer\ndescription: Explains the project structure.\n---\nYou are a helpful assistant that explains the project structure and purpose to new team members.\n',
  'sarah.md': '---\nname: sarah\ndescription: An email assistant.\n---\nYou are a helpful assistant that helps draft and refine emails.\n',
};
// The #7 negative control (no front-matter, no "You are ...").
const BUILD_NOTES = '# Build Notes\n\nThis document describes the build pipeline. It belongs to nobody.\n';
// A Kosmos export (has the kosmos: marker) -- geminiIdentity must decline it.
const KOSMOS_EXPORT = '---\nkosmos: agent\nname: baron\n---\n\nYou are Baron Draxum, a mutagen chemist.\n';

/** A gemini home with an agents/ dir holding the given {file: contents}. */
function geminiHome(files) {
  const root = fs.mkdtempSync(path.join(SANDBOX, 'home-'));
  const agents = path.join(root, 'agents');
  fs.mkdirSync(agents, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(agents, name), body);
  return root;
}
function withGeminiHome(root, fn) {
  const prev = process.env.AGENT_WORKFORCE_GEMINI_HOME;
  process.env.AGENT_WORKFORCE_GEMINI_HOME = root;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_GEMINI_HOME;
    else process.env.AGENT_WORKFORCE_GEMINI_HOME = prev;
  }
}

/* ── geminisession.agentFiles() ─────────────────────────────────────────────── */

test('#2410 agentFiles: finds every *.md under agents/, ignores non-md and dotfiles', () => {
  const home = geminiHome({ ...GEMINI, 'notes.txt': 'x', '.DS_Store': 'x' });
  const got = withGeminiHome(home, () => geminisession.agentFiles());
  assert.equal(got.length, 3, 'expected the 3 .md agent files, not the .txt or dotfile');
  assert.deepEqual(got.map((p) => path.basename(p)).sort(),
    ['code-reviewer.md', 'project-explainer.md', 'sarah.md']);
  assert.ok(got.every((p) => path.isAbsolute(p)), 'paths must be absolute');
});

test('#2410 agentFiles: [] on a missing agents dir, and never throws', () => {
  const home = fs.mkdtempSync(path.join(SANDBOX, 'empty-'));   // no agents/ subdir
  assert.deepEqual(withGeminiHome(home, () => geminisession.agentFiles()), []);
});

/* ── agentfile.geminiIdentity() ─────────────────────────────────────────────── */

test('#2410 geminiIdentity: reads the front-matter name/description of each seed', () => {
  assert.deepEqual(agentfile.geminiIdentity(GEMINI['code-reviewer.md']),
    { displayName: 'code-reviewer', role: 'Reviews code for style and best practices.' });
  assert.equal(agentfile.geminiIdentity(GEMINI['sarah.md']).displayName, 'sarah');
});

test('#2410 geminiIdentity: declines a Kosmos export, the #7 control, and a description-less file', () => {
  assert.equal(agentfile.geminiIdentity(KOSMOS_EXPORT), null, 'a kosmos: file is the strict path, not this one');
  assert.equal(agentfile.geminiIdentity(BUILD_NOTES), null, 'no front-matter must not be an agent');
  // name: present, description: absent -> not the Gemini contract shape.
  assert.equal(agentfile.geminiIdentity('---\nname: whoever\n---\nYou are a helpful assistant.\n'), null);
  // ANY kosmos: line declines, even a malformed empty one (must not fall through to Gemini).
  assert.equal(agentfile.geminiIdentity('---\nkosmos:\nname: x\ndescription: y\n---\nYou are a helpful assistant.\n'), null);
});

/* ── agentfile.importAgent() by-file import ─────────────────────────────────── */

test('#2410 importAgent: a Gemini file imports with its real name; provider is null so create does not dead-end', () => {
  const r = agentfile.importAgent(GEMINI['code-reviewer.md'], deps);
  assert.equal(r.ok, true, 'a Gemini agent file must not be refused as "not a Kosmos file"');
  assert.equal(r.displayName, 'code-reviewer');
  assert.equal(r.name, 'code-reviewer', 'the slug the create form pre-fills');
  // Gemini is not runnable yet (createAgent refuses non-anthropic/openai), so the hint is
  // null -- the person picks a runnable provider, exactly as the #1939 raw-instructions path.
  assert.equal(r.provider, null, 'no gemini provider hint that would dead-end the create form');
  assert.equal(r.recognizedFromContent, true);
  assert.ok(/helpful assistant/.test(r.body), 'the instructions body is carried through');
});

test('#2410 importAgent: control -- a Kosmos export still parses the old way, #7 still refused', () => {
  const ex = agentfile.importAgent(KOSMOS_EXPORT, deps);
  assert.equal(ex.ok, true);
  assert.equal(ex.displayName, 'Baron Draxum', 'the strict kosmos path still wins its own file');
  const nn = agentfile.importAgent(BUILD_NOTES, deps);
  assert.equal(nn.ok, false, 'the #7 negative control must still be refused');
});

/* ── discover.scan() merges the files into importable ───────────────────────── */

test('#2410 scan: the 3 Gemini agents appear in importable with their real names', () => {
  const home = geminiHome(GEMINI);
  // Empty explicit roots: walk no real disk, so importable is exactly the gemini merge.
  const out = withGeminiHome(home, () => discover.scan({ roots: [] }));
  assert.equal(out.ok, true);
  const names = out.importable.map((r) => r.name).sort();
  assert.deepEqual(names, ['code-reviewer', 'project-explainer', 'sarah'],
    'all three Gemini agents must be offered, each with its front-matter name');
  const cr = out.importable.find((r) => r.name === 'code-reviewer');
  assert.ok(cr.file.endsWith('code-reviewer.md'), 'the row carries the file to import');
});

test('#2410 scan: the merge is gated -- an explicit-roots scan that has NOT set a Gemini-home override never reaches a Gemini home', () => {
  // A sandbox agents dir exists on disk, but the override env is UNSET. An explicit-roots
  // scan must NOT reach it (and must not fall back to the operator's real ~/.gemini during
  // a test): this is what stops discover.import-1652 et al. breaking on a machine that has
  // real Gemini agents. The env-set arm below reads the SAME dir and finds all 3, so the
  // difference is the gate, not luck.
  const home = geminiHome(GEMINI);
  const savedEnv = process.env.AGENT_WORKFORCE_GEMINI_HOME;
  const savedHome = process.env.AGENT_WORKFORCE_HOME;
  const savedCli = process.env.GEMINI_CLI_HOME;
  delete process.env.AGENT_WORKFORCE_GEMINI_HOME;
  delete process.env.AGENT_WORKFORCE_HOME;
  delete process.env.GEMINI_CLI_HOME;
  let off;
  try { off = discover.scan({ roots: [] }); }
  finally {
    if (savedEnv !== undefined) process.env.AGENT_WORKFORCE_GEMINI_HOME = savedEnv;
    if (savedHome !== undefined) process.env.AGENT_WORKFORCE_HOME = savedHome;
    if (savedCli !== undefined) process.env.GEMINI_CLI_HOME = savedCli;
  }
  const mine = (rows) => rows.filter((r) => ['code-reviewer', 'project-explainer', 'sarah'].includes(r.name));
  assert.equal(mine(off.importable).length, 0, 'gate off: the sandbox agents dir must not be reached');
  const on = withGeminiHome(home, () => discover.scan({ roots: [] }));
  assert.equal(mine(on.importable).length, 3, 'gate on (override set): the same dir yields all 3');
});

test('#2410 scan: a non-Gemini-shape .md under agents/ falls back to the generic rule (empty name), proving the name came from geminiIdentity', () => {
  // A file that INTRODUCES an agent but names nobody the prose parser can read, and has
  // no Gemini front-matter: the generic looseRow offers it with an empty name. If the
  // real names above came from geminiIdentity (not luck), this one is empty.
  const home = geminiHome({ 'bare.md': 'You are a helpful assistant with no front-matter.\n' });
  const out = withGeminiHome(home, () => discover.scan({ roots: [] }));
  const bare = out.importable.find((r) => r.file.endsWith('bare.md'));
  assert.ok(bare, 'the file is still offered (it introduces an agent)');
  assert.equal(bare.name, '', 'no front-matter => generic looseRow => empty name');
});
