'use strict';

/**
 * #3296: the context ring read "Not yet read" for a launched Gemini agent, the
 * same #2257 symptom Codex had. A Gemini agent does not write a Claude `.jsonl`;
 * its context lives in the Gemini session transcript, which `geminisession.read`
 * reads and `readGeminiContext` maps into the standard ring shape.
 *
 * These tests drive the STATUS WIRING (readGeminiContext + the runner gate in
 * readGeminiSession). The deep transcript parsing is covered separately by
 * geminisession.runner-3296.test.js against the real captured 0.61 shape; here
 * the session fixture only needs to be real-SHAPED enough that geminisession.read
 * returns found:true with contextUsed + model, so the wiring's mapping is what is
 * under test.
 *
 * ⚠️ A SANDBOXED GEMINI HOME + LAUNCH dir, set before the modules load (the
 * openai-ring-2257 discipline) so nothing reads the operator's real ~/.gemini or
 * writes a plist into the real ~/Library/LaunchAgents.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gemring3296-')));
const GEMINI_HOME = path.join(SB, '.gemini');
fs.mkdirSync(GEMINI_HOME, { recursive: true });
const CONFIG_ROOT = path.join(SB, '.claude');
fs.mkdirSync(path.join(CONFIG_ROOT, 'projects'), { recursive: true });
const STORE = path.join(SB, 'Library', 'Application Support', 'AgentWorkforce');
fs.mkdirSync(STORE, { recursive: true });
process.env.AGENT_WORKFORCE_GEMINI_HOME = GEMINI_HOME;
process.env.AGENT_WORKFORCE_CONFIG_ROOT = CONFIG_ROOT;
process.env.AGENT_WORKFORCE_HOME = SB;
process.env.AGENT_WORKFORCE_DATA = STORE;
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'LaunchAgents');
fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });

const store = require('./store');
const status = require('./status');
const create = require('./create');

const NAME = 'gizmo-the-gremlin';
const WORKDIR = path.join(SB, 'work', 'gizmo');
fs.mkdirSync(WORKDIR, { recursive: true });

/* A real-SHAPED Gemini session (header + a gemini turn carrying tokens.input),
   the shape geminisession.runner-3296.test.js verifies in full against the real
   capture. `input` is the window occupancy contextUsed reads. */
function writeSession(cwd, slug, inputTokens, model) {
  fs.writeFileSync(path.join(GEMINI_HOME, 'projects.json'), JSON.stringify({ projects: { [cwd]: slug } }));
  const dir = path.join(GEMINI_HOME, 'tmp', slug, 'chats');
  fs.mkdirSync(dir, { recursive: true });
  const rows = [
    { sessionId: 'gem-3296', projectHash: 'h', startTime: '2026-09-22T02:37:08.325Z', lastUpdated: '2026-09-22T02:37:10.586Z', kind: 'main' },
    { id: 'u1', timestamp: '2026-09-22T02:37:08.330Z', type: 'user', content: [{ text: 'go' }] },
    { id: 'g1', timestamp: '2026-09-22T02:37:10.586Z', type: 'gemini', content: 'DONE',
      tokens: { input: inputTokens, output: 5, cached: 0, thoughts: 0, tool: 0, total: inputTokens + 5 }, model },
  ];
  fs.writeFileSync(path.join(dir, 'session-2026-09-22T02-37-gem3296x.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

// Write an agent plist with the given runner so create.readJob resolves it.
function writePlist(runner, configDir) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.writeFileSync(
    create.plistPath(NAME),
    create.plistFor(NAME, path.join(SB, 'claude'), path.join(SB, 'tmux'), null, configDir, runner),
    'utf8',
  );
}

function reset() {
  try { for (const f of fs.readdirSync(path.join(STORE, 'profiles'))) fs.rmSync(path.join(STORE, 'profiles', f)); } catch { /* first run */ }
  fs.rmSync(path.join(GEMINI_HOME, 'tmp'), { recursive: true, force: true });
  fs.rmSync(path.join(GEMINI_HOME, 'projects.json'), { force: true });
  try { fs.rmSync(create.plistPath(NAME), { force: true }); } catch { /* none */ }
}

test('#3296: readGeminiContext maps a found session to a MEASURED-usage, no-ceiling ring', () => {
  // sess-injection seam (same pre-read contract as readCodexContext): pass the
  // object geminisession.read would return, so this asserts the MAPPING directly.
  const ctx = status.readGeminiContext(NAME, {
    found: true, contextUsed: 6937, contextWindow: null, model: 'gemini-2.5-flash', because: undefined,
  });
  assert.equal(ctx.tokens, 6937, 'tokens is the measured occupancy (gemini tokens.input)');
  assert.equal(ctx.noCeiling, true, 'Gemini states no window in the transcript -> no ceiling (the Claude case)');
  assert.equal(ctx.ceiling, null);
  assert.equal(ctx.percent, null, 'no window -> no percentage, never a fabricated one');
  assert.equal(ctx.notYet, false, 'a turn with usage is not "not yet"');
  assert.equal(ctx.confidence, 'structured', 'a read from the transcript is STRUCTURED confidence');
  assert.match(ctx.because, /gemini-2\.5-flash/, 'the model is named (Gemini carries it, unlike Codex)');
});

test('#3296: a found session with no usage yet reads notYet, not a missing transcript (#2803-analog)', () => {
  const ctx = status.readGeminiContext(NAME, { found: true, contextUsed: null, contextWindow: null, model: null });
  assert.equal(ctx.notYet, true, 'found but no usage yet -> notYet (working agent early in turn 1)');
  assert.equal(ctx.tokens, null);
});

test('#3296: an unreadable transcript is admitted, not collapsed into notYet', () => {
  const ctx = status.readGeminiContext(NAME, { found: false, because: status.NO_READING.UNREADABLE });
  assert.equal(ctx.notYet, false);
  assert.equal(ctx.because, status.NO_READING.UNREADABLE);
});

test('#3296: readGeminiContext reads a real-shaped session end-to-end via the plist + profile', () => {
  reset();
  writePlist('gemini', null); // default-account gemini agent -> defaultAgentGeminiHome() = GEMINI_HOME
  store.writeProfile(NAME, { dir: WORKDIR, provider: 'google' });
  writeSession(WORKDIR, 'gizmo-slug', 6937, 'gemini-2.5-flash');
  const ctx = status.readGeminiContext(NAME);
  assert.equal(ctx.tokens, 6937, 'end-to-end: workerDir -> session -> tokens.input');
  assert.equal(ctx.noCeiling, true);
  assert.equal(ctx.confidence, 'structured');
});

test('#3296: readGeminiContext returns no readout for a folder with no session (never a wrong number)', () => {
  reset();
  writePlist('gemini', null);
  store.writeProfile(NAME, { dir: WORKDIR, provider: 'google' });
  // No session written for WORKDIR.
  const ctx = status.readGeminiContext(NAME);
  assert.equal(ctx.tokens, null, 'no session -> no token count');
  assert.equal(ctx.percent, null);
});

test('#3296: the runner gate -- readGeminiContext gives no readout for a NON-gemini agent', () => {
  reset();
  writePlist('codex', null); // a codex agent, NOT gemini
  store.writeProfile(NAME, { dir: WORKDIR, provider: 'openai' });
  writeSession(WORKDIR, 'gizmo-slug', 6937, 'gemini-2.5-flash'); // even with a gemini session on disk
  const ctx = status.readGeminiContext(NAME);
  // readGeminiSession gates on job.runner === 'gemini' -> {found:false} for a codex agent,
  // so the ring falls through to the no-transcript answer rather than reading the session.
  assert.equal(ctx.tokens, null, 'a non-gemini agent must not read a gemini session');
});
