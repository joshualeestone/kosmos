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

test('#6506 axis 2: a never-reported agent reads "never reported", not idle', () => {
  const session = 'handoffnever';
  assert.match(handoff.stateFact(session), /^never reported/, 'absence must not render as a state');
  assert.doesNotMatch(handoff.stateFact(session), /\bidle\b/, 'a missing report must never read as idle');
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

  const md = handoff.render({ session, cwd, artifacts: [artifact], now: Date.UTC(2026, 9, 18, 20, 0, 0) });

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
