'use strict';

/**
 * #3391: the context ring read "Not yet read" for a launched Grok agent, the
 * same #2257 symptom Codex/Gemini had. A Grok Build agent does not write a Claude
 * `.jsonl`; its context lives in the Grok session (summary.json + signals.json),
 * which `groksession.read` reads and `readGrokContext` maps into the standard ring
 * shape.
 *
 * These tests drive the STATUS WIRING (readGrokContext + the runner gate in
 * readGrokSession). The deep on-disk parsing is covered separately by
 * groksession.test.js against the authoritative xai-org/grok-build serde shape;
 * here the session fixture only needs to be real-SHAPED enough that groksession.read
 * returns found:true with contextUsed (+ window/model), so the wiring's mapping is
 * what is under test.
 *
 * ⭐ UNLIKE GEMINI, Grok states a real window (signals.json contextWindowTokens), so
 * the MEASURED-with-percentage ring path is genuinely reachable -- the first test
 * exercises it, where the gemini sibling could only ever reach no-ceiling.
 *
 * ⚠️ A SANDBOXED GROK HOME + LAUNCH dir, set before the modules load (the
 * openai-ring-2257 / gemini-ring-3296 discipline) so nothing reads the operator's
 * real ~/.grok or writes a plist into the real ~/Library/LaunchAgents.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grokring3391-')));
const GROK_HOME = path.join(SB, '.grok');
fs.mkdirSync(GROK_HOME, { recursive: true });
const CONFIG_ROOT = path.join(SB, '.claude');
fs.mkdirSync(path.join(CONFIG_ROOT, 'projects'), { recursive: true });
const STORE = path.join(SB, 'Library', 'Application Support', 'AgentWorkforce');
fs.mkdirSync(STORE, { recursive: true });
process.env.AGENT_WORKFORCE_GROK_HOME = GROK_HOME;
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

/* A real-SHAPED Grok session on disk: sessions/<encDir>/<sessionId>/summary.json
   (snake_case, carrying info.cwd the reader matches on) + signals.json (camelCase,
   carrying the token counts). groksession.test.js verifies this shape in full
   against the authoritative serde structs; here it only needs to be found:true with
   the fields the ring maps. Pass windowTokens:null to omit signals.json's window
   (the no-ceiling case) or omit tokensUsed entirely to omit signals.json (early
   first turn -> contextUsed null). Returns the session dir. */
function writeSession({ encDir, sessionId, cwd, model, numMessages, lastActive, lastTurn, tokensUsed, windowTokens }) {
  const dir = path.join(GROK_HOME, 'sessions', encDir, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const summary = {
    info: { id: sessionId, cwd },
    last_active_at: lastActive,
    num_messages: numMessages,
    current_model_id: model,
    last_turn_summary: lastTurn,
  };
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary));
  if (typeof tokensUsed === 'number') {
    const signals = { contextTokensUsed: tokensUsed };
    if (typeof windowTokens === 'number') signals.contextWindowTokens = windowTokens;
    fs.writeFileSync(path.join(dir, 'signals.json'), JSON.stringify(signals));
  }
  return dir;
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
  fs.rmSync(path.join(GROK_HOME, 'sessions'), { recursive: true, force: true });
  try { fs.rmSync(create.plistPath(NAME), { force: true }); } catch { /* none */ }
}

test('#3391: readGrokContext maps a found session to a MEASURED, ceilinged ring (Grok states a real window)', () => {
  // sess-injection seam (same pre-read contract as readCodex/GeminiContext): pass
  // the object groksession.read would return, so this asserts the MAPPING directly.
  // 12000 / 256000 = 4.6875% -> rounds to 5. This is the path Gemini can never reach.
  const ctx = status.readGrokContext(NAME, {
    found: true, contextUsed: 12000, contextWindow: 256000, model: 'grok-4.6',
  });
  assert.equal(ctx.tokens, 12000, 'tokens is the measured occupancy (grok contextTokensUsed)');
  assert.equal(ctx.ceiling, 256000, 'Grok WATCHES its window -> a real ceiling, not assumed');
  assert.equal(ctx.ceilingAssumed, false, 'the window is measured from signals.json, never assumed');
  assert.equal(ctx.percent, 5, '12000/256000 rounds to 5 percent');
  assert.equal(ctx.overCeiling, false);
  assert.equal(ctx.notYet, false, 'a turn with usage is not "not yet"');
  assert.equal(ctx.confidence, 'structured', 'a read from the session is STRUCTURED confidence');
});

test('#3391: a found session with a used-count but NO window reads MEASURED, no-ceiling (names the model)', () => {
  // signals.json can carry contextTokensUsed without contextWindowTokens (partial),
  // so contextWindow is null while contextUsed is set -> the no-ceiling branch, which
  // (unlike measuredResult) names the model, exactly as the Gemini arm does.
  const ctx = status.readGrokContext(NAME, {
    found: true, contextUsed: 500, contextWindow: null, model: 'grok-4.6',
  });
  assert.equal(ctx.tokens, 500);
  assert.equal(ctx.noCeiling, true, 'no window -> no ceiling');
  assert.equal(ctx.ceiling, null);
  assert.equal(ctx.percent, null, 'no window -> no percentage, never a fabricated one');
  assert.equal(ctx.notYet, false);
  assert.match(ctx.because, /grok-4\.6/, 'the model is named (Grok carries it, like Gemini, unlike Codex)');
});

test('#3391: a found session with no usage yet reads notYet, not a missing transcript (#2803-analog)', () => {
  const ctx = status.readGrokContext(NAME, { found: true, contextUsed: null, contextWindow: null, model: null });
  assert.equal(ctx.notYet, true, 'found but no usage yet -> notYet (working agent early in turn 1)');
  assert.equal(ctx.tokens, null);
});

test('#3391: the UNREADABLE branch maps correctly, kept for sibling-symmetry though groksession never emits it', () => {
  // groksession.read never returns UNREADABLE (its header explains why -- an
  // unparseable summary is simply not matched -> NO_TRANSCRIPT, a bad signals.json
  // degrades to null halves). This asserts the defensive branch's MAPPING via
  // injection, so a future groksession that DID gain an UNREADABLE path would map
  // through the same honest admission the codex/gemini arms use.
  const ctx = status.readGrokContext(NAME, { found: false, because: status.NO_READING.UNREADABLE });
  assert.equal(ctx.notYet, false, 'an unreadable transcript is admitted, not collapsed into notYet');
  assert.equal(ctx.because, status.NO_READING.UNREADABLE);
});

test('#3391: readGrokContext reads a real-shaped session end-to-end via the plist + profile', () => {
  reset();
  writePlist('grok', null); // default-account grok agent -> defaultAgentGrokHome() = GROK_HOME
  store.writeProfile(NAME, { dir: WORKDIR, provider: 'xai' });
  writeSession({ encDir: 'enc-cwd', sessionId: 'sess-e2e', cwd: WORKDIR, model: 'grok-4.6',
    numMessages: 3, lastActive: '2026-09-22T02:37:10.586Z', lastTurn: 'DONE', tokensUsed: 12000, windowTokens: 256000 });
  const ctx = status.readGrokContext(NAME);
  assert.equal(ctx.tokens, 12000, 'end-to-end: workerDir -> session -> contextTokensUsed');
  assert.equal(ctx.ceiling, 256000, 'end-to-end: the measured window becomes the ring ceiling');
  assert.equal(ctx.percent, 5);
  assert.equal(ctx.confidence, 'structured');
});

test('#3391: end-to-end, a signals.json with a used-count but NO window reads MEASURED, no-ceiling', () => {
  // The Grok-specific measured-with-ceiling path is proven e2e above; this closes the
  // sibling gap -- a real on-disk signals.json that carries contextTokensUsed but omits
  // contextWindowTokens (a partial write) must reach the noCeiling branch through the
  // full workerDir -> read chain, not only via injection.
  reset();
  writePlist('grok', null);
  store.writeProfile(NAME, { dir: WORKDIR, provider: 'xai' });
  writeSession({ encDir: 'enc-noceil', sessionId: 'sess-noceil', cwd: WORKDIR, model: 'grok-4.6',
    numMessages: 2, lastActive: '2026-09-22T02:37:10.586Z', lastTurn: 'DONE', tokensUsed: 500 }); // windowTokens omitted
  const ctx = status.readGrokContext(NAME);
  assert.equal(ctx.tokens, 500, 'end-to-end: contextTokensUsed with no window still yields the measured count');
  assert.equal(ctx.noCeiling, true, 'no contextWindowTokens on disk -> no ceiling');
  assert.equal(ctx.ceiling, null);
  assert.equal(ctx.percent, null, 'no window -> no fabricated percentage');
  assert.match(ctx.because, /grok-4\.6/, 'the model is named end-to-end too');
});

test('#3391: readGrokContext returns no readout for a folder with no session (never a wrong number)', () => {
  reset();
  writePlist('grok', null);
  store.writeProfile(NAME, { dir: WORKDIR, provider: 'xai' });
  // No session written for WORKDIR.
  const ctx = status.readGrokContext(NAME);
  assert.equal(ctx.tokens, null, 'no session -> no token count');
  assert.equal(ctx.percent, null);
});

test('#3391: the runner gate -- readGrokContext gives no readout for a NON-grok agent', () => {
  reset();
  writePlist('codex', null); // a codex agent, NOT grok
  store.writeProfile(NAME, { dir: WORKDIR, provider: 'openai' });
  // even with a grok session on disk for this workdir:
  writeSession({ encDir: 'enc-cwd', sessionId: 'sess-x', cwd: WORKDIR, model: 'grok-4.6',
    numMessages: 1, lastActive: '2026-09-22T02:37:10.586Z', lastTurn: 'x', tokensUsed: 12000, windowTokens: 256000 });
  const ctx = status.readGrokContext(NAME);
  // readGrokSession gates on job.runner === 'grok' -> {found:false} for a codex agent,
  // so readGrokContext never reads the grok session on disk. (The {found:false} then
  // resolves through the notYetStarted/neverRecorded ladder -- a codex agent with a job
  // but no Claude transcript hits notYetStarted -> notYetResult -- but the point under
  // test is only that tokens stays null: a MISSING gate would have read the session and
  // returned tokens: 12000.)
  assert.equal(ctx.tokens, null, 'a non-grok agent must not read a grok session');
});
