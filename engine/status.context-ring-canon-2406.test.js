'use strict';

/**
 * #2406: the context ring read "we cannot find a transcript" for a running
 * imported agent, for BOTH Claude and OpenAI agents together.
 *
 * 🔑 ROOT CAUSE — a path-normalization divergence, the same class already fixed
 * for the codex trust key in #2129/#5. `byWorkdirDetailed` located an agent's
 * transcript at `projects/<flatten(recordedDir)>/` and matched with a strict
 * `transcriptCwd === recordedDir`, using the RAW recorded path. But the agent is
 * launched through the launchd `WorkingDirectory = workerDir(name)` key, and
 * Claude Code writes its transcript under `projects/<flatten(process.cwd())>/` —
 * and process.cwd() (getcwd) resolves CASE and SYMLINKS. So a folder recorded as
 * `.../work` but stored on disk as `.../Work` (Josh's imported seed agents,
 * 2026-09-07 — he named the folder "Work") had its transcript under
 * `projects/<flatten("...Work...")>/`, while the reader looked in
 * `projects/<flatten("...work...")>/` — a different directory, flatten being
 * case-sensitive — and found nothing. It is a property of the PATH, not the
 * runtime, which is why both providers' rings broke together.
 *
 * The fix flattens and compares the ON-DISK CANONICAL spelling via the same
 * `trust.canonicalOnDisk` helper. These tests drive `status.transcriptFor`
 * directly (it is exported) and model the runner faithfully: the transcript
 * always lives under `canonOf(recordedDir)` with `cwd = canonOf(recordedDir)`,
 * because that is where getcwd puts it. The `belongs` control (a transcript for a
 * genuinely different folder) proves the collision guard survives.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Env must be set BEFORE requiring the engine, and each test FILE is its own
// process under `node --test`, so this isolation is real.
const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ring2406-')));
const CONFIG_ROOT = path.join(SB, '.claude');
fs.mkdirSync(path.join(CONFIG_ROOT, 'projects'), { recursive: true });
const HOME = path.join(SB, 'home');
fs.mkdirSync(path.join(HOME, 'Library', 'Application Support', 'AgentWorkforce'), { recursive: true });
process.env.AGENT_WORKFORCE_CONFIG_ROOT = CONFIG_ROOT;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(HOME, 'Library', 'Application Support', 'AgentWorkforce');

const store = require('./store');
const status = require('./status');

const PROJECTS = path.join(CONFIG_ROOT, 'projects');
const flatten = (p) => String(p).replace(/[^A-Za-z0-9]/g, '-');
const canonOf = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const NAME = 'imported-agent';

function reset() {
  const pdir = path.join(process.env.AGENT_WORKFORCE_DATA, 'profiles');
  try { for (const f of fs.readdirSync(pdir)) fs.rmSync(path.join(pdir, f)); } catch { /* first run */ }
  fs.rmSync(PROJECTS, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS, { recursive: true });
}

// The runner writes under canonOf(dir) with cwd = canonOf(dir) — where getcwd
// lands after launchd chdirs into the recorded folder.
function seedRunnerTranscript(recordedDir, sid = 'sess-abc') {
  const c = canonOf(recordedDir);
  const d = path.join(PROJECTS, flatten(c));
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, sid + '.jsonl'),
    JSON.stringify({ type: 'summary', sessionId: sid }) + '\n'
    + JSON.stringify({ cwd: c, message: { model: 'claude-sonnet-5', usage: { input_tokens: 42000 } } }) + '\n',
    'utf8');
}

function foundFor(recordedDir) {
  reset();
  store.writeProfile(NAME, { dir: recordedDir });
  seedRunnerTranscript(recordedDir);
  return status.transcriptFor(NAME);
}

// A case-insensitive filesystem is required for the case-fold arm; detect it.
const probe = path.join(SB, 'CaseProbe');
fs.mkdirSync(probe, { recursive: true });
const CASE_INSENSITIVE = fs.existsSync(path.join(SB, 'caseprobe'));

test('#2406: the aligned common case still resolves (no regression)', () => {
  const dir = path.join(SB, 'Downloads', 'rust-starter-template');
  fs.mkdirSync(dir, { recursive: true });
  assert.ok(foundFor(dir), 'a normally-recorded agent must still find its transcript');
});

test('#2406: a symlinked recorded folder resolves (FS-portable)', () => {
  // The recorded dir reaches its target through a symlinked parent; the runner
  // wrote under the RESOLVED target. Strict-string compare missed it.
  const target = path.join(SB, 'realhome');
  fs.mkdirSync(path.join(target, 'proj'), { recursive: true });
  const link = path.join(SB, 'linkhome');
  fs.symlinkSync(target, link);
  const viaLink = path.join(link, 'proj');
  assert.notEqual(canonOf(viaLink), viaLink, 'fixture is vacuous: the symlink did not create a divergence');
  assert.ok(foundFor(viaLink), 'a transcript under the resolved path must be found from the symlinked recorded spelling');
});

test('#2406: a trailing slash on the recorded folder resolves', () => {
  const dir = path.join(SB, 'Downloads', 'trailing');
  fs.mkdirSync(dir, { recursive: true });
  assert.ok(foundFor(dir + '/'), 'a trailing slash must not lose the transcript');
});

test('#2406: a case-variant recorded folder resolves (Josh’s "Work")',
  { skip: !CASE_INSENSITIVE && 'case-sensitive filesystem' }, () => {
    // On disk the folder is "Work"; the recorded spelling is lowercase "work".
    fs.mkdirSync(path.join(SB, 'Work', 'agentx'), { recursive: true });
    const lower = path.join(SB, 'work', 'agentx');
    assert.ok(fs.existsSync(lower), 'fixture precondition: the FS is case-insensitive');
    assert.notEqual(canonOf(lower), lower, 'fixture is vacuous: no case divergence recovered');
    assert.ok(foundFor(lower), 'the "Work" vs "work" divergence Josh hit must resolve');
  });

test('#2406: the collision guard survives INSIDE one flattened folder — belongs() refuses the foreign cwd and picks the matching one', () => {
  // 🛑 THE HARD CASE, and the whole reason the cwd VERIFY exists: two DISTINCT
  // real directories that flatten to the SAME projects folder. `mine.x` and
  // `mine-x` both flatten to `...-mine-x`, so both transcripts land in one
  // folder and the search physically encounters BOTH — folder-name isolation
  // cannot save us here, so this exercises belongs() itself rather than the
  // directory lookup. A weaker fixture (two folders that do not collide) passes
  // even with belongs() broken, which is the gap this replaces.
  const mine = path.join(SB, 'Downloads', 'mine.x');
  const other = path.join(SB, 'Downloads', 'mine-x');
  fs.mkdirSync(mine, { recursive: true });
  fs.mkdirSync(other, { recursive: true });
  assert.equal(flatten(canonOf(mine)), flatten(canonOf(other)),
    'fixture is vacuous unless both real dirs flatten to one projects folder');
  reset();
  store.writeProfile(NAME, { dir: mine });
  const shared = path.join(PROJECTS, flatten(canonOf(mine)));
  fs.mkdirSync(shared, { recursive: true });
  // A FOREIGN transcript (belongs to the other real dir) sitting in the very
  // folder the search reads — must be refused, not used.
  fs.writeFileSync(path.join(shared, 'foreign.jsonl'),
    JSON.stringify({ cwd: canonOf(other), message: { usage: { input_tokens: 9 } } }) + '\n', 'utf8');
  assert.equal(status.transcriptFor(NAME), null,
    'a foreign transcript sharing the flattened folder must be refused — the one outcome worse than none');
  // Now the agent's OWN transcript in the SAME folder must be chosen over the
  // foreign one, proving belongs() discriminates rather than merely rejecting.
  fs.writeFileSync(path.join(shared, 'ours.jsonl'),
    JSON.stringify({ cwd: canonOf(mine), message: { usage: { input_tokens: 9 } } }) + '\n', 'utf8');
  const got = status.transcriptFor(NAME);
  assert.ok(got && got.endsWith('ours.jsonl'),
    'the transcript whose cwd matches must win over a foreign one in the same folder');
});
