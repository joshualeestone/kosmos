'use strict';

/**
 * #7410: a switch that starts a new conversation copies the agent's OWN Claude memory notes into its folder
 * (memory/claude-notes/), points the new brief at them once through the instructions writer, never touches the
 * original, refuses anything whose owner is in doubt, and the result never says "everything it knows stays".
 *
 * Sandboxed like create.setprovider-writes-2811.test.js (the job is seeded directly, never through createAgent), with
 * the Claude config root pinned to the sandbox (AGENT_WORKFORCE_CONFIG_ROOT). The switch runs with platform 'darwin',
 * as create.compat-7206.test.js does, so it reads the seeded plist on every platform (a Windows job read needs
 * schtasks, which a test never runs).
 *
 *   node --test engine/create.switchmem-7410.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'switchmem-7410-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
const CLAUDE_ROOT = nodePath.join(SANDBOX, 'claude-root');
for (const d of [HOME, BIN, CLAUDE_ROOT, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'), nodePath.join(SANDBOX, 'launch')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(SANDBOX, 'launch', 'systemd', 'user');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = CLAUDE_ROOT;
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

// Windows runs only a file whose extension PATHEXT names (runners.isRunnable), so the stand-ins carry one there.
const EXT = process.platform === 'win32' ? '.cmd' : '';
const CLAUDE_BIN = nodePath.join(BIN, 'claude' + EXT);
const CODEX_BIN = nodePath.join(BIN, 'codex' + EXT);
const TMUX_BIN = nodePath.join(BIN, 'tmux' + EXT);
for (const b of [CLAUDE_BIN, CODEX_BIN, TMUX_BIN]) fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
const OPTS = { claudeBin: CLAUDE_BIN, codexBin: CODEX_BIN, tmuxBin: TMUX_BIN, platform: 'darwin' };

// One OpenAI sign-in, so a switch to OpenAI has an account to land on (as #2811's sandbox).
const SIGNIN = nodePath.join(HOME, '.codex');
fs.mkdirSync(SIGNIN, { recursive: true });
fs.writeFileSync(nodePath.join(SIGNIN, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-testtesttesttest7410' }), 'utf8');

const create = require('./create');
const store = require('./store');
const trust = require('./trust');
const { flatten } = require('./backupsessions');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function born(name) {
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  const plist = create.plistPath(name);
  fs.mkdirSync(nodePath.dirname(plist), { recursive: true });
  fs.writeFileSync(plist, create.plistFor(name, CLAUDE_BIN, TMUX_BIN, null, null, 'claude'), 'utf8');
  store.writeProfile(name, { provider: 'anthropic' });
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), '# brief for this agent\n', 'utf8');
  return name;
}

/* The agent's Claude project folder, as Claude Code names it (under `root`), with a transcript per `cwds` entry and
   its notes. The transcripts are touched last, as Claude Code's are (a session appends after it writes a note). */
function claudeProject(name, notes, cwds, root = CLAUDE_ROOT) {
  const dir = create.workerDir(name);
  const proj = nodePath.join(root, 'projects', flatten(trust.canonicalOnDisk(dir)));
  fs.mkdirSync(nodePath.join(proj, 'memory'), { recursive: true });
  for (const [f, body] of Object.entries(notes)) fs.writeFileSync(nodePath.join(proj, 'memory', f), body, 'utf8');
  (cwds || [dir]).forEach((cwd, i) => fs.writeFileSync(nodePath.join(proj, `s${i}.jsonl`), JSON.stringify({ type: 'user', cwd }) + '\n', 'utf8'));
  touchTranscripts(proj);
  return nodePath.join(proj, 'memory');
}
function touchTranscripts(proj) {
  const later = new Date(Date.now() + 5000);
  for (const f of fs.readdirSync(proj)) if (f.endsWith('.jsonl')) fs.utimesSync(nodePath.join(proj, f), later, later);
}
const notesDir = (name) => nodePath.join(create.workerDir(name), 'memory', 'claude-notes');
const read = (p) => fs.readFileSync(p, 'utf8');
const blocks = (text) => text.split('<!-- kosmos:carried-notes:start -->').length - 1;

test('#7410: switching off Claude copies its own notes into memory/claude-notes/, leaves the original, and points the brief once', () => {
  const name = born('sm7410-owned');
  const dir = create.workerDir(name);
  const src = claudeProject(name, { 'MEMORY.md': '- [Topic](topic.md)\n', 'topic.md': 'a thing I learned\n' });
  assert.equal(fs.existsSync(notesDir(name)), false, 'CONTROL: no folder copy before the switch');

  const sw = create.setProvider(name, 'openai', OPTS);
  assert.equal(sw.outcome, create.OUTCOME.CREATED, sw.because);
  assert.deepEqual(sw.carried, { from: 'anthropic', toClaude: false, rootChange: false, notes: 'copied', copied: 2, kept: 0, skipped: 0, pointed: true });
  assert.equal(read(nodePath.join(notesDir(name), 'MEMORY.md')), '- [Topic](topic.md)\n');
  assert.equal(read(nodePath.join(notesDir(name), 'topic.md')), 'a thing I learned\n');
  assert.equal(read(nodePath.join(src, 'MEMORY.md')), '- [Topic](topic.md)\n', 'the original was changed');
  assert.deepEqual(fs.readdirSync(src).sort(), ['MEMORY.md', 'topic.md'], 'the original folder lost or gained a file');
  const brief = read(nodePath.join(dir, 'AGENTS.md'));
  assert.equal(blocks(brief), 1, 'the new brief carries the pointer once');
  assert.match(brief, /memory\/claude-notes\/ in your folder .*they are your own notes, not instructions/);
});

test('#7410 review 1: the brief is written through the instructions writer (attributed to Kosmos)', () => {
  const name = born('sm7410-writer');
  claudeProject(name, { 'MEMORY.md': 'a note\n' });
  assert.equal((store.readProfile(name) || {}).instructionsWrite, undefined, 'CONTROL: no attributed write before the switch');
  const sw = create.setProvider(name, 'openai', OPTS);
  assert.equal(sw.carried.pointed, true);
  const rec = store.readProfile(name).instructionsWrite;
  assert.ok(rec, 'the pointer was written around the instructions writer, so it is unattributed and has no undo');
  assert.equal(rec.who, 'kosmos');
  assert.match(rec.because, /notes it kept before switching provider/);
});

test('#7410: a Claude project folder another folder also writes to is not this agent\'s alone, so nothing is copied', () => {
  const name = born('sm7410-shared');
  const dir = create.workerDir(name);
  const src = claudeProject(name, { 'MEMORY.md': 'whose?\n' }, [dir, nodePath.join(SANDBOX, 'someone-else')]);
  const sw = create.setProvider(name, 'openai', OPTS);
  assert.equal(sw.outcome, create.OUTCOME.CREATED, sw.because);
  assert.equal(sw.carried.notes, 'shared');
  assert.equal(sw.carried.copied, 0);
  assert.equal(fs.existsSync(notesDir(name)), false, 'a shared memory folder was copied');
  assert.equal(blocks(read(nodePath.join(dir, 'AGENTS.md'))), 0, 'the brief points at notes that are not there');
  assert.equal(read(nodePath.join(src, 'MEMORY.md')), 'whose?\n');
  const words = create.switchCarryWords('OpenAI', sw.carried, 'Claude');
  assert.match(words, /were not copied: its Claude notes are kept together with another folder/);
  assert.doesNotMatch(words, /Everything it knows/);
});

test('#7410 review 1: notes with no transcript beside them are never copied, and say so in their own words', () => {
  const name = born('sm7410-unattributed');
  claudeProject(name, { 'MEMORY.md': 'nobody says whose\n' }, []);
  const sw = create.setProvider(name, 'openai', OPTS);
  assert.equal(sw.carried.notes, 'unattributed');
  assert.equal(fs.existsSync(notesDir(name)), false);
  assert.match(create.switchCarryWords('OpenAI', sw.carried, 'Claude'), /no conversation of its own beside them/);
});

test('#7410 review 1: a folder another known folder flattens to the same Claude name is refused (a-b vs a.b); a unique one is the control', () => {
  const name = born('sm7410-x-y');
  fs.mkdirSync(nodePath.join(SANDBOX, 'workers', 'sm7410-x.y'), { recursive: true });   // another agent folder, same slug
  assert.equal(flatten(create.workerDir('sm7410-x.y')), flatten(create.workerDir(name)), 'CONTROL: the two really share one slug');
  claudeProject(name, { 'MEMORY.md': 'maybe x.y\'s\n' });   // only x-y's transcripts left (x.y's have expired)
  const sw = create.setProvider(name, 'openai', OPTS);
  assert.equal(sw.carried.notes, 'collides');
  assert.equal(fs.existsSync(notesDir(name)), false, 'notes another folder may own were copied');

  const ctl = born('sm7410-p-q');   // no sm7410-p.q anywhere
  claudeProject(ctl, { 'MEMORY.md': 'mine\n' });
  assert.equal(create.setProvider(ctl, 'openai', OPTS).carried.notes, 'copied', 'CONTROL: a unique slug is copied');
});

test('#7410 review 2: the same-name check folds case where the file system does (workers/x-y vs X.Y)', () => {
  const name = born('sm7410-m-n');
  fs.mkdirSync(nodePath.join(SANDBOX, 'workers', 'SM7410-M.N'), { recursive: true });
  claudeProject(name, { 'MEMORY.md': 'maybe M.N\'s\n' });
  const r = create.carryClaudeNotes(name, { runner: 'claude' }, 'codex', nodePath.join(create.workerDir(name), 'CLAUDE.md'), 'anthropic', 'openai');
  const folds = process.platform === 'win32' || process.platform === 'darwin';
  assert.equal(r.notes, folds ? 'collides' : 'copied',
    folds ? 'a folder differing only in case shares the Claude project folder here, and its notes were copied'
      : 'CONTROL: a case-sensitive file system keeps the two apart');
});

/* Review 2: anything Kosmos cannot read about the folders it knows means nothing is copied. */
function carryOwned(name) {
  claudeProject(name, { 'MEMORY.md': 'mine\n' });
  return () => create.carryClaudeNotes(name, { runner: 'claude' }, 'codex', nodePath.join(create.workerDir(name), 'CLAUDE.md'), 'anthropic', 'openai');
}

test('#7410 review 2: a profile that cannot be parsed means unchecked, never a partial list; the control copies once it is gone', () => {
  const name = born('sm7410-corrupt');
  const carry = carryOwned(name);
  const bad = nodePath.join(nodePath.dirname(store.profilePath('x')), 'zz-corrupt-7410.json');
  fs.writeFileSync(bad, '{ not json', 'utf8');
  try {
    const r = carry();
    assert.equal(r.notes, 'unchecked', 'a corrupt profile was skipped and the list treated as complete');
    assert.equal(fs.existsSync(notesDir(name)), false);
  } finally { fs.rmSync(bad, { force: true }); }
  assert.equal(carry().notes, 'copied', 'CONTROL: with every profile readable the notes are copied');
});

test('#7410 review 2: an unreadable projects list means unchecked, and no claude-notes/ is made', () => {
  const name = born('sm7410-noprojects');
  const carry = carryOwned(name);
  const pj = nodePath.join(store.ROOT, 'projects.json');
  assert.equal(fs.existsSync(pj), false, 'CONTROL: the sandbox has no projects list of its own');
  fs.mkdirSync(pj);   // a folder where the list should be: readable as nothing, so not "no projects"
  try {
    const r = carry();
    assert.equal(r.notes, 'unchecked');
    assert.equal(fs.existsSync(notesDir(name)), false);
    assert.match(create.switchCarryWords('OpenAI', r, 'Claude'), /we could not read the other folders Kosmos knows/);
  } finally { fs.rmSync(pj, { recursive: true, force: true }); }
});

test('#7410 review 2: copied but not pointed says its instructions do not mention them yet; pointed does not', () => {
  const base = { from: 'anthropic', toClaude: false, rootChange: false, notes: 'copied', copied: 1, kept: 0, skipped: 0 };
  assert.match(create.switchCarryWords('OpenAI', { ...base, pointed: false }, 'Claude'), /Its instructions do not mention them yet, so tell it they are in memory\/claude-notes\/ in its folder\./);
  assert.doesNotMatch(create.switchCarryWords('OpenAI', { ...base, pointed: true }, 'Claude'), /do not mention them/);
  assert.match(create.switchCarryWords('OpenAI', { ...base, notes: 'newer', copied: 0, pointed: false }, 'Claude'),
    /some were changed after its own last conversation there, so we could not be sure they are its own\./);
});

test('#7410 review 1: a note changed after the agent\'s own newest transcript is refused', () => {
  const name = born('sm7410-newer');
  const src = claudeProject(name, { 'MEMORY.md': 'old\n' });
  const later = new Date(Date.now() + 60000);
  fs.utimesSync(nodePath.join(src, 'MEMORY.md'), later, later);
  const sw = create.setProvider(name, 'openai', OPTS);
  assert.equal(sw.carried.notes, 'newer');
  assert.equal(fs.existsSync(notesDir(name)), false);
});

test('#7410: back and forth never duplicates the pointer and never overwrites either side', () => {
  const name = born('sm7410-roundtrip');
  const dir = create.workerDir(name);
  const src = claudeProject(name, { 'MEMORY.md': 'claude v1\n' });
  assert.equal(create.setProvider(name, 'openai', OPTS).outcome, create.OUTCOME.CREATED);
  fs.writeFileSync(nodePath.join(notesDir(name), 'MEMORY.md'), 'written while on codex\n', 'utf8');

  const back = create.setProvider(name, 'anthropic', OPTS);
  assert.equal(back.outcome, create.OUTCOME.CREATED, back.because);
  assert.equal(back.carried.toClaude, true);
  assert.equal(back.carried.copied, 0, 'a switch back to Claude copies nothing');
  assert.equal(back.carried.pointed, true, 'back on Claude it is still pointed at what it wrote while away');
  assert.equal(blocks(read(nodePath.join(dir, 'CLAUDE.md'))), 1);
  assert.equal(read(nodePath.join(src, 'MEMORY.md')), 'claude v1\n', 'the folder copy was written back over Claude\'s');

  fs.writeFileSync(nodePath.join(src, 'MEMORY.md'), 'claude v2\n', 'utf8');
  fs.writeFileSync(nodePath.join(src, 'new.md'), 'learned on claude again\n', 'utf8');
  touchTranscripts(nodePath.dirname(src));
  const again = create.setProvider(name, 'openai', OPTS);
  assert.equal(again.outcome, create.OUTCOME.CREATED, again.because);
  assert.deepEqual([again.carried.copied, again.carried.kept], [1, 1]);
  assert.equal(read(nodePath.join(notesDir(name), 'MEMORY.md')), 'written while on codex\n', 'Claude\'s note overwrote the folder copy');
  assert.equal(read(nodePath.join(notesDir(name), 'new.md')), 'learned on claude again\n');
  assert.equal(blocks(read(nodePath.join(dir, 'AGENTS.md'))), 1, 'the pointer is there twice');
  assert.match(create.switchCarryWords('OpenAI', again.carried, 'Claude'), /one was already there from an earlier switch and kept, not replaced/);
});

test('#7410: no Claude notes at all: nothing copied, no pointer, and the sentence says so', () => {
  const name = born('sm7410-none');
  const sw = create.setProvider(name, 'openai', OPTS);
  assert.equal(sw.outcome, create.OUTCOME.CREATED, sw.because);
  assert.deepEqual(sw.carried, { from: 'anthropic', toClaude: false, rootChange: false, notes: 'none', copied: 0, kept: 0, skipped: 0, pointed: false });
  assert.match(create.switchCarryWords('OpenAI', sw.carried, 'Claude'), /had no saved notes to copy/);
});

test('#7410 review 1: a memory "folder" that is a file blocks the copy; a note over 1 MB is skipped', () => {
  const blocked = born('sm7410-blocked');
  claudeProject(blocked, { 'MEMORY.md': 'x\n' });
  fs.writeFileSync(nodePath.join(create.workerDir(blocked), 'memory'), 'a file, not a folder\n', 'utf8');
  const b = create.carryClaudeNotes(blocked, { runner: 'claude' }, 'codex', nodePath.join(create.workerDir(blocked), 'CLAUDE.md'), 'anthropic', 'openai');
  assert.equal(b.notes, 'blocked');
  assert.equal(read(nodePath.join(create.workerDir(blocked), 'memory')), 'a file, not a folder\n', 'the file was written through');

  const big = born('sm7410-big');
  claudeProject(big, { 'MEMORY.md': 'small\n', 'huge.md': 'x'.repeat(1024 * 1024 + 1) });
  const g = create.carryClaudeNotes(big, { runner: 'claude' }, 'codex', nodePath.join(create.workerDir(big), 'CLAUDE.md'), 'anthropic', 'openai');
  assert.deepEqual([g.notes, g.copied, g.skipped], ['copied', 1, 1]);
  assert.equal(fs.existsSync(nodePath.join(notesDir(big), 'huge.md')), false);
});

test('#7410 review 1: a note that is a link is never followed or copied', (t) => {
  const name = born('sm7410-link');
  const src = claudeProject(name, { 'MEMORY.md': 'real\n' });
  const target = nodePath.join(SANDBOX, 'outside-secret.md');
  fs.writeFileSync(target, 'not a note\n', 'utf8');
  try { fs.symlinkSync(target, nodePath.join(src, 'link.md'), 'file'); }
  catch (e) { t.skip('this computer will not make a file link here (' + e.code + ')'); return; }
  touchTranscripts(nodePath.dirname(src));
  const r = create.carryClaudeNotes(name, { runner: 'claude' }, 'codex', nodePath.join(create.workerDir(name), 'CLAUDE.md'), 'anthropic', 'openai');
  assert.equal(r.copied, 1);
  assert.equal(fs.existsSync(nodePath.join(notesDir(name), 'link.md')), false, 'a linked note was copied');
});

test('#7410 review 1: two pointer blocks in the brief: nothing is written and it is not counted as pointed', () => {
  const name = born('sm7410-ambiguous');
  fs.mkdirSync(notesDir(name), { recursive: true });
  fs.writeFileSync(nodePath.join(notesDir(name), 'MEMORY.md'), 'a note\n', 'utf8');
  const brief = nodePath.join(create.workerDir(name), 'CLAUDE.md');
  const pair = '<!-- kosmos:carried-notes:start -->\nold\n<!-- kosmos:carried-notes:end -->\n';
  fs.writeFileSync(brief, '# brief for this agent\n' + pair + pair, 'utf8');
  const before = read(brief);
  const r = create.carryClaudeNotes(name, { runner: 'codex' }, 'claude', brief, 'openai', 'anthropic');
  assert.equal(r.pointed, false, 'an ambiguous brief was reported as pointed');
  assert.equal(read(brief), before);
});

test('#7410 review 1: with no account folder the notes are read from ~/.claude, never the server\'s CLAUDE_CONFIG_DIR', () => {
  const saved = { root: process.env.AGENT_WORKFORCE_CONFIG_ROOT, ccd: process.env.CLAUDE_CONFIG_DIR, home: process.env.HOME, up: process.env.USERPROFILE };
  const fakeHome = nodePath.join(SANDBOX, 'fake-home');
  const serverOnly = nodePath.join(SANDBOX, 'server-claude');
  fs.mkdirSync(fakeHome, { recursive: true });
  try {
    delete process.env.AGENT_WORKFORCE_CONFIG_ROOT;
    process.env.HOME = fakeHome; process.env.USERPROFILE = fakeHome;   // os.homedir(): the sandbox is consistent now
    process.env.CLAUDE_CONFIG_DIR = serverOnly;
    const name = born('sm7410-ccd');
    claudeProject(name, { 'MEMORY.md': 'only in the server\'s folder\n' }, undefined, serverOnly);
    const r = create.carryClaudeNotes(name, { runner: 'claude' }, 'codex', nodePath.join(create.workerDir(name), 'CLAUDE.md'), 'anthropic', 'openai');
    assert.equal(r.notes, 'none', 'notes were read from the server process\'s CLAUDE_CONFIG_DIR, which the agent never runs with');

    const ctl = born('sm7410-home');
    claudeProject(ctl, { 'MEMORY.md': 'in ~/.claude\n' }, undefined, nodePath.join(fakeHome, '.claude'));
    const c = create.carryClaudeNotes(ctl, { runner: 'claude' }, 'codex', nodePath.join(create.workerDir(ctl), 'CLAUDE.md'), 'anthropic', 'openai');
    assert.equal(c.notes, 'copied', 'CONTROL: ~/.claude is where the agent\'s notes are read from');
  } finally {
    for (const [k, v] of [['AGENT_WORKFORCE_CONFIG_ROOT', saved.root], ['CLAUDE_CONFIG_DIR', saved.ccd], ['HOME', saved.home], ['USERPROFILE', saved.up]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('#7410 review 1: Claude <-> DeepSeek loses the conversation too; its notes stay behind and the sentence says so', () => {
  assert.equal(create.switchLosesConversation('claude', 'claude', 'anthropic', 'deepseek'), true);
  assert.equal(create.switchLosesConversation('claude', 'claude', 'deepseek', 'anthropic'), true);
  assert.equal(create.switchLosesConversation('claude', 'claude', 'anthropic', 'anthropic'), false, 'CONTROL: a Claude account move keeps it');
  assert.equal(create.switchLosesConversation('codex', 'codex', 'openai', 'alibaba'), false, 'CONTROL: Codex <-> Qwen');
  const name = born('sm7410-deepseek');
  claudeProject(name, { 'MEMORY.md': 'stays with Claude\n' });
  const r = create.carryClaudeNotes(name, { runner: 'claude' }, 'claude', nodePath.join(create.workerDir(name), 'CLAUDE.md'), 'anthropic', 'deepseek');
  assert.deepEqual([r.rootChange, r.notes, r.copied], [true, 'stayed', 0]);
  const w = create.switchCarryWords('DeepSeek', r, 'Claude');
  assert.match(w, /its conversation does not come across: DeepSeek cannot read what it said on Claude\. Its saved notes stay behind with Claude/);
  assert.doesNotMatch(w, /Everything it knows/);
});

test('#7410: the family rule, and the result sentence keeps its old words only within a family', () => {
  assert.equal(create.crossesFamily('claude', 'codex'), true);
  assert.equal(create.crossesFamily('gemini', 'claude'), true);
  assert.equal(create.crossesFamily('claude', 'claude'), false, 'a Claude account move keeps its memory');
  assert.equal(create.crossesFamily('codex', 'gemini'), false, 'not a family change by the card\'s definition');
  assert.match(create.switchCarryWords('Gemini', null), /^Gemini it is\. Everything it knows and everything it has done stays\. $/);
  for (const carried of [
    { from: 'anthropic', toClaude: false, notes: 'copied', copied: 2, kept: 0, pointed: true },
    { from: 'openai', toClaude: true, notes: 'none', copied: 0, kept: 0, pointed: true },
    { from: 'openai', toClaude: true, notes: 'none', copied: 0, kept: 0, pointed: false },
    { from: 'anthropic', toClaude: false, notes: 'blocked', copied: 0, kept: 0, pointed: false },
    { from: 'anthropic', toClaude: false, notes: 'collides', copied: 0, kept: 0, pointed: false },
    { from: 'anthropic', toClaude: false, notes: 'newer', copied: 0, kept: 0, pointed: false },
  ]) {
    const w = create.switchCarryWords('X', carried, 'Y');
    assert.doesNotMatch(w, /Everything it knows/, JSON.stringify(carried));
    assert.match(w, /its conversation does not come across: X cannot read what it said on Y\./);
    assert.doesNotMatch(w, /—/, 'an em dash');
  }
  // The route says it through this function, not its own copy of the old sentence.
  const server = fs.readFileSync(nodePath.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(server, /it is\. Everything it knows and everything it has done stays/, 'the route still has its own copy of the old sentence');
  assert.match(server, /create\.switchCarryWords\(label, wrote\.carried/);
});
