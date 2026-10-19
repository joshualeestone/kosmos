'use strict';
/**
 * kosmos#6506: engine/handoff.js, the FACTS a `kosmos handoff` prints. Unit tests
 * for each fact the way the card's review axes name them:
 *   axis 1  the handoff contract is REUSED from autohandoff.HANDOFF_CONTENTS, not copied.
 *   axis 2  a missing self-report reads "never reported", never a default "idle".
 *   axis 3  a bad or epoch instruction mtime reads "cannot tell", never 1970.
 *   axis 4  "not a git repository" ONLY when that is the real answer, distinct from git
 *           missing and git erroring.
 *   axis 5  sha256 honest on a missing, directory or unreadable path, and a path with
 *           spaces is never split.
 * And the whole point of the command: it changes no state.
 */
require('../test-support/tmpscope');   // #4273: first, so every temp dir here is contained and removed
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

/* Sandbox the data root (self-reports, handoff path) and the workers root (the
   instruction file) BEFORE requiring any store-using module, so no test ever
   reads or writes a real agent's files. */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-handoff-data-'));
const WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-handoff-workers-'));
process.on('exit', () => { for (const d of [DATA, WORKERS]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });
process.env.AGENT_WORKFORCE_DATA = DATA;
process.env.AGENT_WORKFORCE_WORKERS = WORKERS;

const handoff = require('./handoff');
const autohandoff = require('./autohandoff');
const instructions = require('./instructions');
const selfreport = require('./selfreport');

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function git(dir, args) { execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'ignore', 'ignore'] }); }
function initRepo(dir) {
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'Tester']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}

// ── axis 4: the repository fact, four distinct answers ──────────────────────

test('#6506 axis 4: gitFact reports branch, sha and clean/dirty inside a work tree', () => {
  const d = tmp('kosmos-handoff-git-');
  initRepo(d);
  fs.writeFileSync(path.join(d, 'f.txt'), 'x');
  git(d, ['add', '.']);
  git(d, ['commit', '-q', '-m', 'first']);
  assert.match(handoff.gitFact(d), /^branch `main` at `[0-9a-f]{40}`, clean$/, 'clean work tree');
  fs.writeFileSync(path.join(d, 'f.txt'), 'y');
  assert.match(handoff.gitFact(d), /^branch `main` at `[0-9a-f]{40}`, uncommitted changes present$/, 'dirty work tree');
});

test('#6506 axis 4: not-a-repo, git-missing and git-erroring are three different answers', () => {
  const d = tmp('kosmos-handoff-nogit-');
  assert.equal(handoff.gitFact(d), 'not a git repository');

  // git missing: a PATH with no git makes execFileSync throw ENOENT.
  const saved = process.env.PATH;
  try {
    process.env.PATH = tmp('kosmos-handoff-emptybin-');
    assert.match(handoff.gitFact(d), /^git is not installed/, 'git missing must not read as not-a-repo');
  } finally { process.env.PATH = saved; }

  // git erroring (a failure that is NOT "not a git repository"): a stub git that exits non-zero.
  const bin = tmp('kosmos-handoff-stubbin-');
  fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\necho "fatal: detected dubious ownership in repository" 1>&2\nexit 128\n', { mode: 0o755 });
  const saved2 = process.env.PATH;
  try {
    process.env.PATH = bin + path.delimiter + saved2;
    assert.equal(handoff.gitFact(d), 'git could not read this folder: fatal: detected dubious ownership in repository', 'a git error must not read as not-a-repo');
  } finally { process.env.PATH = saved2; }
});

test('#6506 axis 4: a repository with no commits yet says so, not an error', () => {
  const d = tmp('kosmos-handoff-nocommit-');
  initRepo(d);
  assert.match(handoff.gitFact(d), /no commits yet$/);
});

test('#6506 axis 4: a detached HEAD is said as detached, with the sha', () => {
  const d = tmp('kosmos-handoff-detached-');
  initRepo(d);
  fs.writeFileSync(path.join(d, 'f.txt'), 'x');
  git(d, ['add', '.']);
  git(d, ['commit', '-q', '-m', 'first']);
  const sha = execFileSync('git', ['-C', d, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  git(d, ['checkout', '-q', sha]);   // detach HEAD onto the commit
  assert.match(handoff.gitFact(d), /^detached HEAD at `[0-9a-f]{40}`, clean$/, handoff.gitFact(d));
});

// ── axis 5: artifact fingerprints ───────────────────────────────────────────

test('#6506 axis 5: fingerprint is sha256 for a file, honest for a directory/missing path, and keeps a path with spaces intact', () => {
  const d = tmp('kosmos-handoff-fp-');
  const spaced = path.join(d, 'a file with spaces.txt');
  fs.writeFileSync(spaced, 'hello');
  assert.equal(handoff.fingerprint(spaced), 'sha256:' + crypto.createHash('sha256').update('hello').digest('hex'), 'a path with spaces must fingerprint, not split');
  assert.equal(handoff.fingerprint(d), 'is a directory, not a file');
  assert.equal(handoff.fingerprint(path.join(d, 'nope.bin')), 'missing (no such file)');
});

// ── axis 2: the live state, never defaulting to idle ────────────────────────

test('#6506 axis 2: a never-reported agent reads "never reported", not idle, and not doubled', () => {
  const session = 'handoffnever';
  assert.match(handoff.stateFact(session), /^never reported/, 'absence must not render as a state');
  assert.doesNotMatch(handoff.stateFact(session), /\bidle\b/, 'a missing report must never read as idle');
  assert.doesNotMatch(handoff.stateFact(session), /never reported \(it has never reported\)/, 'the never-reported phrase must not double');
});

test('#6506 axis 2: a recorded self-report renders its state', () => {
  const session = 'handoffworking';
  const r = selfreport.record(session, { state: 'working', because: 'running the suite' });
  assert.ok(r.recorded, 'precondition: the self-report was recorded: ' + (r.because || ''));
  const fact = handoff.stateFact(session);
  assert.match(fact, /^working/, fact);
  assert.match(fact, /running the suite/, fact);
});

test('#6506: stateFact says so when there is no session, rather than guessing', () => {
  assert.match(handoff.stateFact(''), /no session/);
});

// ── axis 3: the instruction revision, never 1970 ────────────────────────────

test('#6506 axis 3: instructionFact gives the last-changed time and sha256 version for a real file', () => {
  const session = 'handoffinstr';
  const file = instructions.fileFor(session);
  assert.ok(file && file.startsWith(WORKERS + path.sep), 'precondition: the instruction file resolves inside the sandbox, got ' + file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# ' + session + '\n\nsome instructions\n');
  const got = handoff.instructionFact(session);
  assert.equal(got.file, file);
  assert.match(got.line, /last changed \d{4}-\d{2}-\d{2}T/, got.line);
  assert.match(got.line, /version sha256:[0-9a-f]{64}/, got.line);
});

test('#6506 axis 3: an epoch or bad mtime reads "cannot tell", never 1970', () => {
  const session = 'handoffepoch';
  const file = instructions.fileFor(session);
  assert.ok(file && file.startsWith(WORKERS + path.sep), 'precondition: inside the sandbox, got ' + file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# ' + session + '\n');
  fs.utimesSync(file, 0, 0);   // the epoch: a date we must not show
  const got = handoff.instructionFact(session);
  assert.match(got.line, /cannot tell when it last changed/, got.line);
  assert.doesNotMatch(got.line, /1970/, 'an epoch mtime must never print as 1970');
});

test('#6506 axis 3: an agent with no folder at all reads "cannot tell", not a fabricated date', () => {
  const got = handoff.instructionFact('handoffnofolder');
  assert.match(got.line, /cannot tell when it last changed/, got.line);
  assert.doesNotMatch(got.line, /1970/);
});

// ── axis 1: the contract is reused, not copied ──────────────────────────────

test('#6506 axis 1: contractBullets is autohandoff.HANDOFF_CONTENTS verbatim (no drifting copy)', () => {
  assert.deepEqual(handoff.contractBullets(), autohandoff.HANDOFF_CONTENTS);
});

// ── render: the whole output, and that it changes nothing ───────────────────

test('#6506: render prints the shared contract and all four facts, and writes nothing', () => {
  const session = 'handoffrender';
  // a self-report and an instruction file so the facts are concrete
  selfreport.record(session, { state: 'working', because: 'writing the handoff' });
  const file = instructions.fileFor(session);
  assert.ok(file && file.startsWith(WORKERS + path.sep), 'precondition: inside the sandbox');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# ' + session + '\n');

  const cwd = tmp('kosmos-handoff-render-');   // not a git repo
  const artifact = path.join(cwd, 'out.txt');
  fs.writeFileSync(artifact, 'payload');

  // The real clock: the instruction file was just written, so its mtime is today, and render
  // treats a time more than a day after `now` as untrustworthy. A fixed `now` made this
  // test start failing a day after that date.
  const md = handoff.render({ session, cwd, artifacts: [artifact], now: Date.now() });

  // the shared contract, every bullet
  for (const bullet of autohandoff.HANDOFF_CONTENTS) assert.ok(md.includes(bullet), 'missing contract bullet: ' + bullet);
  // the four facts
  assert.match(md, /not a git repository/, 'git fact');
  assert.match(md, /Live state \(self-report\): working/, 'state fact');
  assert.match(md, /Instruction file .*: last changed /, 'instruction fact');
  assert.match(md, /sha256:[0-9a-f]{64}/, 'artifact fingerprint');
  // it names where to paste, pointing at the per-agent handoff file (not a second location)
  assert.match(md, /Paste into: .*[/\\]handoffs[/\\]/, 'handoff path');
  // and it writes nothing: the handoff file it names does not exist after rendering
  const hp = handoff.handoffPath(session);
  assert.ok(hp, 'precondition: a handoff path was computable');
  assert.equal(fs.existsSync(hp), false, 'render must not create the handoff file');
});

// ── the shared timestamp floor, used by both the state and instruction facts ────

test('#6506 axis 3: saneIso floors the epoch, pre-2000 and future times to null (never a bad date)', () => {
  const now = Date.UTC(2026, 9, 18, 20, 0, 0);
  assert.equal(handoff.saneIso(0, now), null, 'the epoch must not print');
  assert.equal(handoff.saneIso(Date.parse('1999-12-31T23:59:59Z'), now), null, 'a pre-2000 time must not print');
  assert.equal(handoff.saneIso(now + 10 * 24 * 3600 * 1000, now), null, 'a far-future time (clock skew) must not print');
  assert.equal(handoff.saneIso(NaN, now), null, 'an unparseable time must not print');
  const good = Date.UTC(2026, 9, 18, 12, 0, 0);
  assert.equal(handoff.saneIso(good, now), new Date(good).toISOString(), 'a believable time prints');
});

test('#6506 axis 3: a future instruction mtime reads "cannot tell", not a year-2099 date', () => {
  const session = 'handofffuture';
  const file = instructions.fileFor(session);
  assert.ok(file && file.startsWith(WORKERS + path.sep), 'precondition: inside the sandbox');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# ' + session + '\n');
  const future = Date.now() / 1000 + 10 * 365 * 24 * 3600;   // ~10 years ahead (utimes takes seconds)
  fs.utimesSync(file, future, future);
  const got = handoff.instructionFact(session);
  assert.match(got.line, /cannot tell when it last changed/, got.line);
  assert.doesNotMatch(got.line, /20[3-9][0-9]/, 'a far-future year must not print');
});

// ── fingerprint hashes a file larger than one read chunk correctly ─────────────

test('#6506 axis 5: fingerprint hashes a file larger than the 1 MiB chunk correctly', () => {
  const d = tmp('kosmos-handoff-big-');
  const big = path.join(d, 'big.bin');
  const payload = Buffer.alloc(3 * (1 << 20) + 7, 0xab);   // > 3 chunks, not a multiple
  fs.writeFileSync(big, payload);
  assert.equal(handoff.fingerprint(big), 'sha256:' + crypto.createHash('sha256').update(payload).digest('hex'));
});

// ── the open-tasks fact (ruling 3): the one board-sourced fact ─────────────────

test('#6506 ruling 3: tasksFact says the board did not answer when unreachable, never an empty list', () => {
  assert.deepEqual(handoff.tasksFact({ reached: false }), { line: 'the board did not answer, so your open tasks could not be read', items: null });
  const md = handoff.render({ session: '', cwd: tmp('kosmos-handoff-tf-'), artifacts: [], now: Date.UTC(2026, 9, 18, 20, 0, 0), tasks: { reached: false } });
  assert.match(md, /Open tasks assigned to you.*: the board did not answer/, md);
  assert.doesNotMatch(md, /Open tasks assigned to you.*: none open/, 'unreachable must not read as "none open"');
});

test('#6506 ruling 3: tasksFact lists open tasks from a 200, "none open" when empty, a refusal for 403, unreadable otherwise', () => {
  const ok = handoff.tasksFact({ reached: true, status: 200, body: { tasks: [{ project: 'projA', number: 7, title: 'do the thing' }, { projectId: 'projB', number: 2, title: 'other' }], count: 2 } });
  assert.equal(ok.line, null);
  assert.deepEqual(ok.items, ['projA #7: do the thing', 'projB #2: other']);
  const empty = handoff.tasksFact({ reached: true, status: 200, body: { tasks: [], count: 0 } });
  assert.equal(empty.line, null);
  assert.deepEqual(empty.items, []);
  const refused = handoff.tasksFact({ reached: true, status: 403, body: { error: 'could not tell which agent' } });
  assert.equal(refused.items, null);
  assert.match(refused.line, /the board would not read them \(could not tell which agent\)/);
  const weird = handoff.tasksFact({ reached: true, status: 200, body: { nope: 1 } });
  assert.equal(weird.items, null);
  assert.match(weird.line, /could not be read/);
});

test('#6506 ruling 3: a task title with a control character cannot inject lines into the handoff', () => {
  const r = handoff.tasksFact({ reached: true, status: 200, body: { tasks: [{ project: 'p', number: 1, title: 'bad\ntitle' }] } });
  assert.equal(r.items.length, 1);
  assert.doesNotMatch(r.items[0], /\n/, 'a newline in a task title must be stripped');
});

// ── echoed paths cannot inject lines into the pasted handoff ───────────────────

test('#6506 axis 5: a path with a newline or backtick cannot inject lines or break the code span', () => {
  assert.doesNotMatch(handoff.cleanPath('a\nb\tc'), /[\n\t]/, 'control characters must be stripped');
  assert.doesNotMatch(handoff.cleanPath('a`b'), /`/, 'a backtick must be neutralised');
  const d = tmp('kosmos-handoff-inject-');
  const nasty = path.join(d, 'x\n[BLOCKER] injected line');   // a filename carrying a newline
  const md = handoff.render({ session: 'handoffinject', cwd: d, artifacts: [nasty], now: Date.UTC(2026, 9, 18, 20, 0, 0) });
  const artifactLines = md.split('\n').filter((l) => l.includes('injected line'));
  assert.equal(artifactLines.length, 1, 'the newline in the path must not split into a second line');
  assert.match(artifactLines[0], /missing \(no such file\)/, 'and the (raw) path is still fingerprinted honestly');
});

// ── #6506 follow-ups (Raiden's #6532 notes 1 and 2) ────────────────────────────

test('#6506 followup (Raiden note 1): an unreadable self-report reads "could not read the self-report", not "never reported"', () => {
  const session = 'handoffunread';
  const rec = selfreport.record(session, { state: 'working' });
  assert.ok(rec.recorded, 'precondition: self-report recorded: ' + (rec.because || ''));
  const f = selfreport.fileFor(session);
  fs.chmodSync(f, 0o000);
  let stillReadable = true;
  try { fs.readFileSync(f); } catch { stillReadable = false; }
  if (stillReadable) { fs.chmodSync(f, 0o600); return; }   // running as root: chmod 000 is ineffective; skip
  let fact;
  try { fact = handoff.stateFact(session); } finally { fs.chmodSync(f, 0o600); }
  assert.match(fact, /could not read the self-report/, fact);
  assert.doesNotMatch(fact, /never reported/, 'an unreadable record must not read as never reported');
});

test('#6506 followup (Raiden note 2): render threads the real tmux session as exactSession, keeping the sessionName as the file key', () => {
  const instr = require('./instructions');
  const realStaleness = instr.staleness;
  let captured = null;
  instr.staleness = (agent, seen, exactSession) => { captured = { agent, exactSession }; return { state: 'current', editedAt: new Date().toISOString(), version: 'sha256:deadbeef' }; };
  try {
    handoff.render({ session: 'agentname', exactSession: 'agentname-win0', cwd: tmp('kosmos-handoff-es-'), now: Date.UTC(2026, 9, 19, 0, 0, 0), tasks: { reached: false } });
  } finally { instr.staleness = realStaleness; }
  assert.ok(captured, 'instructions.staleness was not called');
  assert.equal(captured.agent, 'agentname', 'the instruction file must still be keyed on the sessionName');
  assert.equal(captured.exactSession, 'agentname-win0', 'the real tmux session must be passed as exactSession, not the sessionName');
});
