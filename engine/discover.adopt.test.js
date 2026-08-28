'use strict';

// ⚠️ SANDBOX BEFORE REQUIRING, because these modules resolve their roots at load.
// This file's own first draft set the environment per test, AFTER the requires,
// and every adoption was refused with "Kosmos already looks after an agent by
// that name" -- the launch directory had been resolved once, to the real one.
// Same warning create.test.js opens with, learned again the hard way.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'pete-adoptroot-'));
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = path.join(SANDBOX, 'bin', 'claude');
for (const d of ['workers', 'LaunchAgents', 'home/.codex', 'support', 'bin']) {
  fs.mkdirSync(path.join(SANDBOX, d), { recursive: true });
}
fs.writeFileSync(path.join(SANDBOX, 'bin', 'claude'), '#!/bin/sh\nexit 0\n');
fs.chmodSync(path.join(SANDBOX, 'bin', 'claude'), 0o755);

const discover = require('./discover');
const create = require('./create');
const status = require('./status');
const store = require('./store');

/**
 * 🛑 REFUSE TO RUN IF THE SANDBOX DID NOT TAKE. This file writes launchd jobs and
 * worker folders, and `create.js` resolves `AGENTS_DIR` AT MODULE LOAD:
 *
 *     const AGENTS_DIR = process.env.AGENT_WORKFORCE_LAUNCH || <real LaunchAgents>
 *
 * In a multi-file `node --test` run the files share a process, so whichever file
 * requires `create.js` FIRST decides that constant. This file sets its
 * environment before its own requires - and that is not enough, because an
 * earlier file may already have loaded the module against the real paths.
 *
 * ⚠️ MEASURED, NOT HYPOTHETICAL: running the full suite put four real plists into
 * the operator's `~/Library/LaunchAgents` -- com.kosmos.agent.scoutboth,
 * .scoutclaude, .scoutcodex, .scoutsetup -- named for the fixtures below and
 * pointing at temp directories that no longer exist. They were never loaded, so
 * nothing ran, and that was luck rather than design.
 *
 * ⇒ SILENT POLLUTION BECOMES A LOUD FAILURE HERE. A test that cannot isolate
 * itself must not run at all, and it must say why rather than skipping quietly.
 */
/* 🛑 BOTH ROOTS, AND IT NAMES EVERY ONE THAT FAILED. The first version of this
   guard checked only the LAUNCH directory. It worked - for the wrong reason: this
   file happens to set LAUNCH and DATA together, so gating on one incidentally
   gated the other.

   ⚠️ THAT IS A COINCIDENCE, NOT A DESIGN, and it is the worst kind of guard to
   inherit BECAUSE IT PASSES ITS OWN TESTS. Split those assignments into different
   files and it goes silently useless while every arm stays green.

   ⚠️ AND IT COLLECTS RATHER THAN SHORT-CIRCUITS, because a guard that stops at the
   first bad root cannot be tested per root: my own control could not tell whether
   the LAUNCH check still worked, because the DATA check answered first. A guard
   whose arms cannot be exercised separately has the same defect one level up.

   📌 DATA is the root that mattered in practice. Before any of this existed,
   full-suite runs wrote four real profile records into the operator's store and
   the board served them as agents. The plists were the visible half; the profiles
   were the half nobody saw. */
const outsideSandbox = [
  ['AGENT_WORKFORCE_DATA (engine/store.js)', store.ROOT],
  ['AGENT_WORKFORCE_LAUNCH (engine/create.js)', create.plistPath('sandboxprobe')],
].filter(([, resolved]) => !String(resolved).startsWith(SANDBOX));
if (outsideSandbox.length) {
  throw new Error(
    'discover.adopt.test.js refuses to run: these roots resolved OUTSIDE its sandbox, '
    + 'so it would write to the real machine -- '
    + outsideSandbox.map(([name, r]) => `${name} -> ${r}`).join('; ')
    + '. These modules resolve their roots at module load, so set the variables before '
    + 'the first require of them in the process, or run this file on its own.',
  );
}

/* Re-seeded per test: several of these mutate the codex home, and a test that
   depended on a previous one having run is how a suite stops meaning anything. */
test.beforeEach(() => {
  status.setPaneSource(() => '');
  create.setRunner(() => ({ ok: true, stdout: '' }));
  create.setDryRun(false);
  fs.writeFileSync(path.join(SANDBOX, 'home/.codex/version.json'),
    JSON.stringify({ latest_version: '0.150.1', dismissed_version: null }));
});
test.afterEach(() => { create.setRunner(null); status.setPaneSource(null); });

const agentFolder = (name, file, text) => {
  const d = path.join(SANDBOX, 'workers', name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, file), text);
  return d;
};
const plistOf = (name) =>
  fs.readFileSync(path.join(SANDBOX, 'LaunchAgents', `com.kosmos.agent.${name}.plist`), 'utf8');
const codexState = () => ({
  version: JSON.parse(fs.readFileSync(path.join(SANDBOX, 'home/.codex/version.json'), 'utf8')),
  toml: (() => { try { return fs.readFileSync(path.join(SANDBOX, 'home/.codex/config.toml'), 'utf8'); } catch { return ''; } })(),
});

test('#1159: a discovered Codex agent can be ADOPTED, and gets a codex job', () => {
  const dir = agentFolder('scoutcodex', 'AGENTS.md', '# You are Scout Codex\n');
  const r = discover.connect(dir);
  assert.equal(r.ok, true, `a Codex agent was refused: ${r.because}`);
  const p = plistOf('scoutcodex');
  assert.match(p, /<string>codex<\/string>/, 'the adopted agent was written as a Claude job');
  assert.match(p, /codex<\/string>/, 'the job does not point at the codex binary');
});

test('#1159 CONTROL: a Claude agent is still adopted as Claude', () => {
  /* Without this the assertion above is satisfied by a change that makes
     EVERYTHING a codex job, which would be a far worse bug. */
  const dir = agentFolder('scoutclaude', 'CLAUDE.md', '# You are Scout Claude\n');
  const r = discover.connect(dir);
  assert.equal(r.ok, true, r.because);
  const p = plistOf('scoutclaude');
  assert.doesNotMatch(p, /<string>codex<\/string>/, 'a Claude agent was adopted as a Codex one');
});

test('#1159: CLAUDE.md wins when a folder has both', () => {
  /* A person with both has a Claude agent that also carries codex notes.
     Starting the runner named after this product is the safer read. */
  const dir = agentFolder('scoutboth', 'CLAUDE.md', '# You are Scout Both\n');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# You are Scout Both\n');
  const r = discover.connect(dir);
  assert.equal(r.ok, true, r.because);
  assert.doesNotMatch(plistOf('scoutboth'), /<string>codex<\/string>/);
});

test('#1159: an adopted Codex agent gets the same first-run setup as a created one', () => {
  /* 🛑 Otherwise it meets a trust prompt and an update prompt that nothing will
     answer, and the board reads both panes as `unknown` (#1315). */
  const dir = agentFolder('scoutsetup', 'AGENTS.md', '# You are Scout Setup\n');
  discover.connect(dir);
  const v = codexState().version;
  assert.equal(v.dismissed_version, '0.150.1', 'the adopted agent will stop at the update prompt');
  assert.match(codexState().toml, /trust_level = "trusted"/,
    'the adopted agent will stop at the trust prompt');
});

test('#1159: a folder with NEITHER file is still refused', () => {
  /* The refusal is real and must survive: an empty folder is not an agent. */
  const dir = path.join(SANDBOX, 'workers', 'nothinghere');
  fs.mkdirSync(dir, { recursive: true });
  const r = discover.connect(dir);
  assert.equal(r.ok, false);
  assert.match(r.because, /no instructions in it/);
});

test('#1159: a Codex agent is adopted on a machine with NO Claude installed', () => {
  /* 🛑 THIS IS JOSH'S 2x2 CELL, "OpenAI + pre-existing agents", on the machine
     that cell describes: somebody who runs Codex and has never installed Claude.

     `installJob` checked `claudeBin` unconditionally, so adopting a Codex agent
     was refused there with a message about a program that agent does not use.

     ⚠️ AND THE REST OF THIS FILE CANNOT SEE IT, which is why this test exists
     separately: the shared sandbox ships a working `claude` stub, so a
     perturbation reverting the binary check to `claudeBin` stayed GREEN. Found
     by perturbation, and the fix was a test that removes the stub. */
  const prev = process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = path.join(SANDBOX, 'bin', 'no-claude-here');
  try {
    const dir = agentFolder('scoutnoclaude', 'AGENTS.md', '# You are Scout NoClaude\n');
    const r = discover.connect(dir);
    assert.equal(r.ok, true,
      `a Codex agent was refused on a machine with no Claude: ${r.because}`);
    assert.match(plistOf('scoutnoclaude'), /<string>codex<\/string>/);
  } finally { process.env.AGENT_WORKFORCE_CLAUDE_BIN = prev; }
});

test('#1159 CONTROL: a CLAUDE agent is still refused when Claude is missing', () => {
  /* The claude check must survive for the runner that needs it, or the fix above
     has simply removed a real guard. */
  const prev = process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = path.join(SANDBOX, 'bin', 'no-claude-here');
  try {
    const dir = agentFolder('scoutneedsclaude', 'CLAUDE.md', '# You are Scout NeedsClaude\n');
    const r = discover.connect(dir);
    assert.equal(r.ok, false, 'a Claude agent was adopted with no Claude on the machine');
  } finally { process.env.AGENT_WORKFORCE_CLAUDE_BIN = prev; }
});

test('#1159: adoption records the PROVIDER, not only the job', () => {
  /* 🛑 #1347 made adoption write a codex JOB and left the profile silent.
     `server.js` derives a card's runner from `profile.provider` whenever the
     pane is not the source, so a stopped adopted Codex agent read as `claude`.

     ⚠️ NOT COSMETIC. `chat.js` pauses before Enter only for a codex card (#571),
     because codex swallows an Enter that rides the paste burst. A codex agent
     labelled claude gets a message that sits in its composer unsent -- which
     looks exactly like an agent ignoring you. */
  const store = require('./store');
  const dir = agentFolder('provcodex', 'AGENTS.md', '# You are Prov Codex\n');
  assert.equal(discover.connect(dir).ok, true);
  assert.equal((store.readProfile('provcodex') || {}).provider, 'openai',
    'the board will call this adopted Codex agent a Claude one');
});

test('#1159 CONTROL: adopting a Claude agent does NOT stamp a provider', () => {
  /* Without this, the assertion above is satisfied by stamping openai on
     everything, which would mislabel every adopted Claude agent. An absent
     provider is what "claude" has always meant here, and #1332's own comment
     says an absent key must keep meaning what it already means. */
  const store = require('./store');
  const dir = agentFolder('provclaude', 'CLAUDE.md', '# You are Prov Claude\n');
  assert.equal(discover.connect(dir).ok, true);
  assert.equal((store.readProfile('provclaude') || {}).provider, undefined,
    'an adopted Claude agent was stamped with a provider it does not have');
});

/**
 * #1349: an IMPORTED agent joined nothing, so a person whose first agents are
 * imported landed on an empty Projects tab - the first screen after the thing
 * that just worked.
 *
 * 🛑 THE ORDERING IS THE WHOLE FIX, and it is #732. `installJob` STARTS the agent.
 * A project joined afterwards reaches its instructions through the later sync,
 * seconds after the session is up, so it is born reading "Kosmos put it on
 * Getting started. Restart it so it knows." I fixed that for CREATION on
 * 2026-08-24 and would have reintroduced it here.
 */
const projectsMod = require('./projects');

test('#1349: an imported agent gets the project block, BEFORE it is started', () => {
  /* 🔑 THE ORDERING IS PROVEN, NOT ASSERTED. The injected runner is what
     `installJob` calls to start the agent, so reading the instructions file from
     INSIDE it captures their state at the moment of start. If the block is
     already there, the write preceded the start. An assertion after `connect`
     returns could not tell the two apart. */
  const proj = projectsMod.create({
    name: 'Getting started', agents: [], roster: [],
    description: 'seeded by the test', made: { via: 'kosmos' },
  });
  const dir = agentFolder('impcodex', 'AGENTS.md', '# You are Imp Codex\n');
  let atStart = null;
  create.setRunner(() => {
    if (atStart === null) {
      try { atStart = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'); } catch { atStart = ''; }
    }
    return { ok: true, stdout: '' };
  });

  const r = discover.connect(dir, { projects: [proj.id] });
  assert.equal(r.ok, true, r.because);
  assert.ok(atStart !== null, 'the runner never ran, so this proves nothing about ordering');
  assert.match(atStart, /kosmos:projects:start/,
    'the agent was STARTED before its project block was written: it will be born telling '
    + 'the person to restart it (#732)');
});

test('#1349 CONTROL: no projects means no block, and no crash', () => {
  /* Without this, the assertion above is satisfied by a change that splices a
     block unconditionally, which would put an empty connections block into the
     instructions of every imported agent. */
  const dir = agentFolder('impplain', 'AGENTS.md', '# You are Imp Plain\n');
  const r = discover.connect(dir, {});
  assert.equal(r.ok, true, r.because);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /kosmos:projects:start/,
    'an agent joining nothing was given a connections block anyway');
});

test('#1349 CONTROL: an unknown project id is ignored, not fatal', () => {
  /* Non-gating, the same rule creation keeps: an unreadable or stale projects
     file must not cost somebody their agent. */
  const dir = agentFolder('impghost', 'AGENTS.md', '# You are Imp Ghost\n');
  const r = discover.connect(dir, { projects: ['no-such-project-id'] });
  assert.equal(r.ok, true, `a stale project id cost the person their agent: ${r.because}`);
});

test('#1349: a CLAUDE agent gets the same treatment', () => {
  /* The block goes in whichever instructions file the folder actually has -
     importing is not a Codex-only path. */
  const proj = projectsMod.create({
    name: 'Second Home', agents: [], roster: [],
    description: 'seeded by the test', made: { via: 'kosmos' },
  });
  const dir = agentFolder('impclaude', 'CLAUDE.md', '# You are Imp Claude\n');
  assert.equal(discover.connect(dir, { projects: [proj.id] }).ok, true);
  assert.match(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), /kosmos:projects:start/,
    'a Claude agent was imported without its project block');
});

test('#1349: an instructions file already at the ceiling is left alone', () => {
  /* 🔑 The ceiling exists so Kosmos cannot hand an agent a file too big to read.
     Adoption must respect it the same way creation does - and a perturbation that
     removed the check SURVIVED until this test existed, because nothing else here
     uses a file anywhere near the limit. */
  const { MAX_BYTES } = require('./instructions');
  const proj = projectsMod.create({
    name: 'Ceiling Home', agents: [], roster: [],
    description: 'seeded by the test', made: { via: 'kosmos' },
  });
  const big = `# You are Imp Big\n\n${'x'.repeat(MAX_BYTES)}\n`;
  const dir = agentFolder('impbig', 'AGENTS.md', big);
  const r = discover.connect(dir, { projects: [proj.id] });
  assert.equal(r.ok, true, `an oversized file cost the person their agent: ${r.because}`);
  const after = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.equal(after, big, 'the block was spliced into a file already at the ceiling');
});

/**
 * #1363: an imported agent was never told the rules or how to reach the connectors.
 *
 * **Josh, 2026-08-28 12:09 CDT, watching the import path work on a wiped machine:**
 * > *"It would be helpful if we added to their file all the rules we've made up for
 * > them working. More important than that is adding the information so they know
 * > how to connect to the connectors that we have in settings."*
 *
 * MEASURED ASYMMETRY: `create.js` composes both before an agent is born;
 * `discover.js` mentioned `defaults` ZERO times.
 */
test('#1363: an imported agent is born with the rules and the connector words', () => {
  const dir = agentFolder('rulesimp', 'AGENTS.md', '# You are Rules Imp\n');
  let atStart = null;
  create.setRunner(() => {
    if (atStart === null) {
      try { atStart = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'); } catch { atStart = ''; }
    }
    return { ok: true, stdout: '' };
  });
  const r = discover.connect(dir, {});
  assert.equal(r.ok, true, r.because);
  assert.ok(atStart !== null, 'the runner never ran, so this proves nothing about ordering');

  /* 🔑 READ AT THE MOMENT OF START, not after connect returned. Rules that arrive
     afterwards are rules the agent was not born with, which is the #732 shape. */
  const { block } = require('./defaults');
  const marker = block().split('\n').find((l) => l.startsWith('## ')) || '## How you work';
  assert.ok(atStart.includes(marker),
    'the agent was STARTED before it was given the rules');
  const conn = require('./connections');
  assert.ok(atStart.includes(conn.START),
    'the agent was STARTED before it was told how to reach the connectors');
});

test('#1363: the person\'s own words are still there, above ours', () => {
  /* The seam has to stay visible: we append under our own headings, we do not
     rewrite what they wrote. */
  const dir = agentFolder('seamimp', 'AGENTS.md', '# You are Seam Imp\n\nMy own instructions.\n');
  assert.equal(discover.connect(dir, {}).ok, true);
  const after = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(after, /^# You are Seam Imp/, 'their file no longer starts with their words');
  assert.match(after, /My own instructions\./, 'their content was lost');
});

test('#1363 CONTROL: importing twice does not duplicate the blocks', () => {
  /* `appendTo` refuses to add itself twice and the splice replaces in place. A
     re-import that doubled every rule would be worse than the gap this closes. */
  const conn = require('./connections');
  const dir = agentFolder('twiceimp', 'AGENTS.md', '# You are Twice Imp\n');
  discover.connect(dir, {});
  const once = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  const countOnce = once.split(conn.START).length - 1;
  /* Re-run the compose path directly: a second connect() is refused by name, and
     what matters is that composing again is idempotent. */
  const again = require('./defaults').appendTo(once);
  assert.equal(again, once, 'the rules were appended a second time');
  assert.equal(countOnce, 1, `the connections block appears ${countOnce} times after one import`);
});

/**
 * #1401: a FAILED Codex adoption left `provider: 'openai'` on the profile.
 *
 * 🛑 The provider is stamped BEFORE the job is written, and the rollback listed
 * only two keys. `writeProfile` is a MERGE (`{ ...had, ...patch }`,
 * engine/store.js:180), so **a merge cannot clear a key by omitting it** and the
 * stamp survived. Measured before the fix: the profile read
 * `provider: "openai"` with a null dir and a null displayName.
 *
 * ⇒ `server.js` derives a card's runner from `profile.provider`, so a REFUSED
 * adoption could leave the board describing an agent that was never adopted, has
 * no job, and will never start, as an OpenAI one.
 */
test('#1401: a refused adoption leaves no provider behind', () => {
  const store = require('./store');
  /* Refused for a reason that fires AFTER the stamp and before success: no
     runner binary on this machine. The point is a failure late enough to have
     stamped, which is the only shape that can leave residue. */
  const prev = process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = path.join(SANDBOX, 'bin', 'no-such-binary');
  const prevCodex = process.env.AGENT_WORKFORCE_CODEX_BIN;
  process.env.AGENT_WORKFORCE_CODEX_BIN = path.join(SANDBOX, 'bin', 'no-such-codex');
  try {
    const dir = agentFolder('refusedcodex', 'AGENTS.md', '# You are Refused Codex\n');
    const r = discover.connect(dir);
    assert.equal(r.ok, false, 'the adoption succeeded, so this test proves nothing about rollback');
    const p = store.readProfile('refusedcodex') || {};
    assert.ok(!p.provider,
      `a refused adoption left provider=${JSON.stringify(p.provider)}: the board will call it an OpenAI agent`);
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
    else process.env.AGENT_WORKFORCE_CLAUDE_BIN = prev;
    if (prevCodex === undefined) delete process.env.AGENT_WORKFORCE_CODEX_BIN;
    else process.env.AGENT_WORKFORCE_CODEX_BIN = prevCodex;
  }
});

test('#1401 CONTROL: a SUCCESSFUL adoption still records the provider', () => {
  /* Without this the fix is satisfied by never stamping at all, which would undo
     #1351 and put the board back to calling adopted Codex agents Claude ones. */
  const store = require('./store');
  const dir = agentFolder('keptcodex', 'AGENTS.md', '# You are Kept Codex\n');
  assert.equal(discover.connect(dir).ok, true);
  assert.equal((store.readProfile('keptcodex') || {}).provider, 'openai',
    'the successful path stopped recording the provider');
});

test('#1401: a pre-existing provider is RESTORED, not blanked', () => {
  /* 🔑 THE ARM THAT PROVED MY COMMENT. A perturbation replacing
     `before.provider || null` with a flat `null` SURVIVED, because every other
     test here starts from a profile with no provider - so "restored" and
     "blanked" were indistinguishable.

     The reachable shape: an agent that was adopted before (so its profile carries
     a provider) whose job was later removed by hand. A re-adoption that FAILS
     must not strip the provider its earlier, successful adoption recorded. */
  const store = require('./store');
  const dir = agentFolder('readoptcodex', 'AGENTS.md', '# You are Readopt Codex\n');
  store.writeProfile('readoptcodex', { provider: 'openai', displayName: 'Readopt Codex' });

  const prev = process.env.AGENT_WORKFORCE_CODEX_BIN;
  process.env.AGENT_WORKFORCE_CODEX_BIN = path.join(SANDBOX, 'bin', 'no-such-codex');
  try {
    const r = discover.connect(dir);
    assert.equal(r.ok, false, 'the adoption succeeded, so this proves nothing about rollback');
    assert.equal((store.readProfile('readoptcodex') || {}).provider, 'openai',
      'a failed re-adoption ERASED the provider its earlier successful adoption had recorded');
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_CODEX_BIN;
    else process.env.AGENT_WORKFORCE_CODEX_BIN = prev;
  }
});
