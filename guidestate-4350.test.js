'use strict';
/*
 * kosmos#4350: the setup guide's outcome, recorded and sent as ONE WORD on the existing
 * install ping, so /admin can say whether an install got the guide and, if not, which gate
 * stopped it. And the auto-created guide is not counted as an agent the person created.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Every root sandboxed BEFORE the modules resolve them (store.ROOT is read at require time).
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-guidestate-4350-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const test = require('node:test');
const assert = require('node:assert/strict');
const guidestate = require('./engine/guidestate');
const beacon = require('./engine/createdbeacon');
const setupAssistant = require('./engine/setup-assistant');
const create = require('./engine/create');

function clearState() { try { fs.rmSync(guidestate.file(), { force: true }); } catch { /* ok */ } }
function arm(on) {
  if (on) setupAssistant.armSetupAssistant();
  else try { fs.rmSync(setupAssistant.armPath(), { force: true }); } catch { /* ok */ }
}
function unseed() { try { fs.rmSync(setupAssistant.flagPath(), { force: true }); } catch { /* ok */ } }
const MODELS = (rows) => ({ enabled: true, listFor: (mod) => rows[mod] || [], connectable: async () => ({ ok: true }), liveDefault: async () => true });
const CLAUDE = MODELS({ './accounts': [{ dir: '/h/.claude', isDefault: true }] });
const NONE = MODELS({});
const createdOk = (calls) => (opts) => { calls.push(opts); return { outcome: create.OUTCOME.CREATED, name: opts.name }; };
const refused = (because) => () => ({ outcome: create.OUTCOME.REFUSED, because });

test.beforeEach(() => { clearState(); arm(false); unseed(); setupAssistant.resetEnsureGuideForTests(); });

test('#4350 the install ping carries the recorded state, and "unknown" before any', () => {
  assert.equal(beacon.payload(0).guide, 'unknown', 'no record yet must read unknown, not a guess');
  guidestate.record({ state: 'no-model', reason: 'no model connected yet' });
  const p = beacon.payload(0);
  assert.equal(p.guide, 'no-model');
  assert.equal(p.reason, undefined, 'the reason must stay on the Mac');
  assert.ok(!JSON.stringify(p).includes('no model connected yet'), 'the reason text left the Mac');
});

test('#4350 record() reports a change only when the STATE changes, and ignores a wait', () => {
  assert.equal(guidestate.record({ state: 'no-model', reason: 'a' }).changed, true, 'first state is a change');
  const firstAt = guidestate.read().at;
  const mtime = fs.statSync(guidestate.file()).mtimeMs;
  assert.equal(guidestate.record({ state: 'no-model', reason: 'a' }).changed, false);
  assert.equal(fs.statSync(guidestate.file()).mtimeMs, mtime, 'an unchanged outcome rewrote the file (the sweep asks every minute)');
  assert.equal(guidestate.record({ state: 'no-model', reason: 'b' }).changed, false, 'same state, new reason is not');
  assert.equal(guidestate.read().reason, 'b', 'but the newest reason is kept locally');
  assert.equal(guidestate.read().at, firstAt, '`at` must stay when the state first appeared');
  assert.equal(guidestate.record({ seeded: false, reason: 'waiting before trying again' }).changed, false,
    'a retry wait (no state) must record nothing');
  assert.equal(guidestate.current(), 'no-model', 'a wait overwrote the state');
  assert.equal(guidestate.record({ state: 'bogus' }).changed, false, 'an unknown state was recorded');
  assert.equal(guidestate.current(), 'no-model', 'an unknown state reached the file');
  assert.equal(guidestate.record({ state: 'seeded', reason: 'x' }).changed, true);
  assert.equal(guidestate.current(), 'seeded');
});

test('#4350 ensureGuide names the gate that stopped it, for each gate', async () => {
  let r = await setupAssistant.ensureGuide({ createAgent: createdOk([]), deps: CLAUDE });
  assert.equal(r.state, 'not-armed', r.reason);
  arm(true);
  r = await setupAssistant.ensureGuide({ createAgent: createdOk([]), deps: NONE });
  assert.equal(r.state, 'no-model', r.reason);
  r = await setupAssistant.ensureGuide({ createAgent: createdOk([]), deps: { ...CLAUDE, settings: { setupAssistant: { on: false } } } });
  assert.equal(r.state, 'off', r.reason);
  r = await setupAssistant.ensureGuide({ createAgent: refused('we could not find Claude Code on this computer'), deps: CLAUDE, via: 'first-run' });
  assert.equal(r.state, 'refused', r.reason);
  setupAssistant.resetEnsureGuideForTests();
  // A model is listed but none can run (a dead sign-in): its own gate, not a refusal.
  r = await setupAssistant.ensureGuide({ createAgent: createdOk([]), deps: { ...CLAUDE, connectable: async () => ({ ok: false }) }, via: 'first-run' });
  assert.equal(r.state, 'no-usable-model', r.reason);
  setupAssistant.resetEnsureGuideForTests();
  r = await setupAssistant.ensureGuide({ createAgent: refused('there is already an agent called that'), deps: CLAUDE, via: 'first-run' });
  assert.equal(r.state, 'names-taken', r.reason);
  setupAssistant.resetEnsureGuideForTests();
  const calls = [];
  r = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), deps: CLAUDE, via: 'first-run' });
  assert.equal(r.seeded, true, r.reason || '');
  assert.equal(r.state, 'seeded');
  r = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), deps: CLAUDE });
  assert.equal(r.state, 'seeded', 'an already-seeded install must still read seeded');
  r = await setupAssistant.ensureGuide({ createAgent: createdOk([]), deps: { ...CLAUDE, enabled: false } });
  assert.equal(r.state, 'disabled', r.reason);
});

test('#4350 the auto-created guide is not counted as an agent the person created', () => {
  fs.mkdirSync(path.dirname(create.createdLogFile()), { recursive: true });
  const lines = [
    { outcome: create.OUTCOME.CREATED, name: 'mine', role: 'coder', createdBy: null },
    { outcome: create.OUTCOME.CREATED, name: 'Josh', role: 'setup', createdBy: 'kosmos',
      purpose: "default Kosmos setup guide, Josh's AI (auto-created when a model was connected, #3034/#3660)" },
    // CONTROLS: a person's own setup-role agent counts, and so does a team member whose
    // creator was set to 'kosmos' through the team route, with any other purpose.
    { outcome: create.OUTCOME.CREATED, name: 'helper', role: 'setup', createdBy: null },
    { outcome: create.OUTCOME.CREATED, name: 'teamed', role: 'setup', createdBy: 'kosmos', purpose: 'our launch team' },
    // 0.6.70's guide, born with the older purpose: also not counted.
    { outcome: create.OUTCOME.CREATED, name: 'Kosmos Setup', role: 'setup', createdBy: 'kosmos',
      purpose: 'default Kosmos setup assistant (auto-created on first-run, #3034)' },
    { outcome: create.OUTCOME.REFUSED, name: 'no', role: 'coder', createdBy: null },
  ];
  fs.writeFileSync(create.createdLogFile(), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  try {
    assert.equal(create.createdCount(), 3, 'the auto guide was counted, or a person-made agent was not');
  } finally { fs.rmSync(create.createdLogFile(), { force: true }); }
});

test('#4350 server.js records the outcome at BOTH ensureGuide call sites, and re-pings on a change', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const calls = [...src.matchAll(/setupAssistant\.ensureGuide\(\{[^}]*\}\)\s*\.then\(recordGuideOutcome\)/g)];
  const all = [...src.matchAll(/setupAssistant\.ensureGuide\(/g)];
  assert.equal(all.length, 2, 'expected exactly two ensureGuide call sites; re-read this test if that changed');
  assert.equal(calls.length, all.length, 'an ensureGuide call site drops its outcome');
  assert.match(src, /const recordGuideOutcome = guidestate\.makeRecorder\(\{\s*ping: \(\) => createdbeacon\.pingInstall\(\),\s*delayMs: GUIDE_PING_DELAY_MS,\s*setTimer: createdbeacon\.underTest\(\) \? \(\) => null : setTimeout,/,
    'the board must record through makeRecorder, pinging after GUIDE_PING_DELAY_MS, with no timer under test');
  assert.match(src, /const GUIDE_SEEDED = Object\.freeze\(\{[^}]*state: 'seeded'/, 'the seeded outcome is not defined');
  assert.match(src, /setupAssistantSeeded\(\)\)\s*\{\s*recordGuideOutcome\(GUIDE_SEEDED\)/,
    'an install seeded before the guide state existed must record seeded at the sweep\'s early return');
});

test('#4350 the birth the REAL seed path would record is recognised as the auto guide', () => {
  // Capture the options seedSetupAssistant hands createAgent, and write them to the birth log
  // the way recordBirth does (role, createdBy, purpose sliced to 300), so a change to the seed's
  // purpose text or fields cannot quietly put the guide back in the public count.
  const seen = [];
  const r = setupAssistant.seedSetupAssistant({ createAgent: (o) => { seen.push(o); return { outcome: create.OUTCOME.CREATED, name: o.name }; }, hasConnectedAccount: () => true });
  assert.equal(r.seeded, true, r.reason || '');
  const o = seen[0];
  fs.mkdirSync(path.dirname(create.createdLogFile()), { recursive: true });
  fs.writeFileSync(create.createdLogFile(), JSON.stringify({
    outcome: create.OUTCOME.CREATED, name: o.name, role: String(o.role || '').slice(0, 120),
    createdBy: o.createdBy ? String(o.createdBy).slice(0, 120) : null,
    purpose: o.purpose ? String(o.purpose).slice(0, 300) : null,
  }) + '\n');
  try {
    assert.equal(create.createdCount(), 0, 'the real seed path\'s birth was counted as a person-made agent');
  } finally { fs.rmSync(create.createdLogFile(), { force: true }); unseed(); }
});

test('#4350 makeRecorder: one ping, after the delay, per state change; nothing for no change or a failed write', () => {
  const timers = [];
  const setTimer = (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; };
  let pings = 0;
  let next = { changed: true };
  const rec = guidestate.makeRecorder({ ping: () => { pings += 1; }, delayMs: 30000, setTimer, recordFn: () => next });
  const r = { state: 'no-model' };
  assert.equal(rec(r), r, 'the outcome must pass through (it sits in a promise chain)');
  assert.equal(pings, 0, 'the ping went at once, racing the board-start ping');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 30000);
  rec({ state: 'seeded' });                     // a second change inside the window
  assert.equal(timers.length, 1, 'a second change inside the window started a second ping');
  timers[0].fn();
  assert.equal(pings, 1);
  next = { changed: false };                    // no change, or a write that failed
  rec({ state: 'seeded' });
  assert.equal(timers.length, 1, 'an unchanged (or unwritten) state scheduled a ping');
  next = { changed: true };                     // after the first ping, a new change pings again
  rec({ state: 'off' });
  assert.equal(timers.length, 2);
  timers[1].fn();
  assert.equal(pings, 2);
  // Never throws, even when recording or pinging does.
  const bad = guidestate.makeRecorder({ ping: () => { throw new Error('x'); }, delayMs: 1, setTimer, recordFn: () => { throw new Error('y'); } });
  assert.doesNotThrow(() => bad({ state: 'off' }));
});
