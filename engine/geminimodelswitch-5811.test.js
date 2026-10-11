'use strict';
/* #5811: the #5804 "(set to X)" decision reads nothing the snapshot has not already read: no second job read and no
   second session parse per running Gemini agent per poll. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* The whole sandbox (status.geminiseen-5811's set): snapshot() reads the job and the Gemini home, never the real ones. */
const SANDBOX = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-gemread-5811-test-')));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_GEMINI_HOME = path.join(SANDBOX, '.gemini');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SANDBOX, '.claude');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
for (const d of [process.env.AGENT_WORKFORCE_DATA, process.env.AGENT_WORKFORCE_GEMINI_HOME, path.join(process.env.AGENT_WORKFORCE_CONFIG_ROOT, 'projects'), process.env.AGENT_WORKFORCE_LAUNCH]) {
  fs.mkdirSync(d, { recursive: true });
}
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const create = require('./create');
const status = require('./status');
const fleet = require('../test-support/fleet');
const { settingModelName, settingModelNameOfRow } = require('./geminimodelswitch');

const START = Date.parse('2026-10-10T19:00:00Z');
const SEEN = { model: 'gemini-3.5-flash', modelAt: START + 60000, planned: { id: 'gemini-2.5-flash', isDefault: false } };
const rest = { startedAt: () => START, display: (id) => ({ 'gemini-2.5-flash': 'Gemini 2.5 Flash' }[id] || id) };

/* A REAL Gemini card from the producer (fixture-discipline: never a hand-built card), with the model a Gemini session
   would have put on it laid over it, as server.whoami-grok-4603 does for Grok. The decision reads `seen`, not the card's
   model: the card's is only what the page shows. */
function geminiCard(t, over) {
  const board = fleet.install([fleet.agent('gem', { state: 'idle', runner: 'gemini', command: 'node' })]);
  t.after(() => board.restore());
  const real = board.agents.find((a) => a.name === 'gem');
  assert.ok(real, 'the fleet produced no card for the Gemini agent');
  return { real, card: Object.assign({}, real, { model: 'gemini-3.5-flash' }, over) };
}

/* Counts every call to the real job and session readers (realDeps calls them through the module objects). */
function counting(fn) {
  const saved = { planned: create.plannedModelOf, session: status.readGeminiSession, started: status.sessionStartedAtFromTmux };
  const n = { planned: 0, session: 0 };
  create.plannedModelOf = () => { n.planned++; return { id: 'gemini-2.5-flash', isDefault: false }; };
  status.readGeminiSession = () => { n.session++; return { found: true, model: 'gemini-3.5-flash', modelAt: START + 60000 }; };
  status.sessionStartedAtFromTmux = () => START;
  try { return { out: fn(), n }; }
  finally { create.plannedModelOf = saved.planned; status.readGeminiSession = saved.session; status.sessionStartedAtFromTmux = saved.started; }
}

test('#5811: the row decision reads neither the job nor the session again (and the control does)', (t) => {
  const { card } = geminiCard(t);
  const viaRow = counting(() => settingModelNameOfRow(card, SEEN, { display: rest.display }));
  assert.equal(viaRow.out, 'Gemini 2.5 Flash');
  assert.deepEqual(viaRow.n, { planned: 0, session: 0 });
  // CONTROL: the same decision with no row data reads both, so the counters can see a read.
  const direct = counting(() => settingModelName('gem', { display: rest.display }));
  assert.equal(direct.out, 'Gemini 2.5 Flash');
  assert.deepEqual(direct.n, { planned: 1, session: 1 });
});

test('#5811: the producer emits geminiSeen on a real card (null with no session to read)', (t) => {
  const { real } = geminiCard(t);
  assert.ok('geminiSeen' in real, 'status.snapshot() no longer emits geminiSeen');
  assert.equal(real.geminiSeen, null, 'no Gemini session file in the sandbox, so nothing was seen');
  assert.equal(settingModelNameOfRow(real, real.geminiSeen, rest), null);
});

test('#5811: the row decision gives #5804\'s answers from the row data', (t) => {
  const { card } = geminiCard(t);
  assert.equal(settingModelNameOfRow(card, SEEN, rest), 'Gemini 2.5 Flash');
  assert.equal(settingModelNameOfRow(card, null, rest), null, 'session not read by the snapshot: nothing to say');
  assert.equal(settingModelNameOfRow(card, { ...SEEN, model: 'gemini-2.5-flash-001' }, rest), null, 'same model');
  assert.equal(settingModelNameOfRow(card, { modelAt: START - 1, planned: { id: 'gemini-2.5-flash' } }, rest), null, 'an earlier run');
  assert.equal(settingModelNameOfRow(card, { modelAt: null, planned: { id: 'gemini-2.5-flash' } }, rest), null, 'reply time unknown');
  assert.equal(settingModelNameOfRow(card, { modelAt: START + 60000, planned: null }, rest), null, 'no job');
  assert.equal(settingModelNameOfRow(card, { modelAt: START + 60000, planned: { id: 'auto' } }, rest), null, 'an alias');
  assert.equal(settingModelNameOfRow(card, { ...SEEN, model: null }, rest), null, 'no model named');
  assert.equal(settingModelNameOfRow(null, SEEN, rest), null);
});

test('#5811: partial deps override the real ones and keep the rest', () => {
  const r = counting(() => settingModelName('gem', { planned: () => ({ id: 'gemini-2.5-pro', isDefault: false }) }));
  assert.equal(r.out, status.modelDisplayName('gemini-2.5-pro'));
  assert.deepEqual(r.n, { planned: 0, session: 1 });
});

test('#5811: create.plannedModelOfJob is plannedModelOf without the read', () => {
  assert.equal(create.plannedModelOfJob(null), null);
  assert.deepEqual(create.plannedModelOfJob({ runner: 'gemini', model: 'gemini-2.5-flash' }), { id: 'gemini-2.5-flash', isDefault: false });
  const pinned = require('./win32keyed').DEFAULT_MODEL.gemini;
  assert.ok(pinned, 'a Gemini default exists to test against');
  assert.deepEqual(create.plannedModelOfJob({ runner: 'gemini' }), { id: pinned, isDefault: true });
  assert.equal(create.plannedModelOfJob({ runner: 'no-such-runner' }), null);
  const src = fs.readFileSync(path.join(__dirname, 'create.js'), 'utf8');
  assert.match(src, /function plannedModelOf\(name\) \{[\s\S]{0,200}?return plannedModelOfJob\(job\);\s*\}/, 'plannedModelOf delegates, one rule');
});

test('#5811: the snapshot carries what the decision needs, on both row builders, and the page map takes it off', () => {
  const src = fs.readFileSync(path.join(__dirname, 'status.js'), 'utf8');
  assert.match(src, /geminiSeen: \(tied && isGeminiPane && geminiSess && geminiSess\.found\)\s*\? \{ model: sessModel\(geminiSess\), modelAt: [^}]*planned: geminiSess\.planned \|\| null \}\s*: null,/);
  assert.match(src, /geminiSeen: null,\s*\/\/ #5811/);
  assert.match(src, /planned = create\.plannedModelOfJob\(job\);[\s\S]{0,60}return \{ \.\.\.sess, planned \};/);
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /snap\.agents\.filter\(\(a\) => !gone\.has\(a\.sessionName\)\)\.map\(\(\{ geminiSeen, \.\.\.a \}\) => \(\{/, 'the page row would carry geminiSeen');
  assert.match(server, /settingModelName: settingGeminiModel\(a, geminiSeen\),/);
});
