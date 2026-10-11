'use strict';
/* #5811: the #5804 "(set to X)" decision reads nothing the snapshot has not already read: no second job read and no
   second session parse per running Gemini agent per poll. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const create = require('./create');
const status = require('./status');
const { settingModelName, settingModelNameOfRow } = require('./geminimodelswitch');

const START = Date.parse('2026-10-10T19:00:00Z');
const row = (o) => Object.assign({
  sessionName: 'a', runner: 'gemini', model: 'gemini-3.5-flash',
  geminiSeen: { modelAt: START + 60000, planned: { id: 'gemini-2.5-flash', isDefault: false } },
}, o);
const rest = { startedAt: () => START, display: (id) => ({ 'gemini-2.5-flash': 'Gemini 2.5 Flash' }[id] || id) };

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

test('#5811: the row decision reads neither the job nor the session again (and the control does)', () => {
  const viaRow = counting(() => settingModelNameOfRow(row()));
  assert.equal(viaRow.out, 'Gemini 2.5 Flash');
  assert.deepEqual(viaRow.n, { planned: 0, session: 0 });
  // CONTROL: the same decision with no row data reads both, so the counters can see a read.
  const direct = counting(() => settingModelName('a'));
  assert.equal(direct.out, 'Gemini 2.5 Flash');
  assert.deepEqual(direct.n, { planned: 1, session: 1 });
});

test('#5811: the row decision gives #5804\'s answers from the row data', () => {
  assert.equal(settingModelNameOfRow(row(), rest), 'Gemini 2.5 Flash');
  assert.equal(settingModelNameOfRow(row({ geminiSeen: null }), rest), null, 'session not read by the snapshot: nothing to say');
  assert.equal(settingModelNameOfRow(row({ model: 'gemini-2.5-flash-001' }), rest), null, 'same model');
  assert.equal(settingModelNameOfRow(row({ geminiSeen: { modelAt: START - 1, planned: { id: 'gemini-2.5-flash' } } }), rest), null, 'an earlier run');
  assert.equal(settingModelNameOfRow(row({ geminiSeen: { modelAt: null, planned: { id: 'gemini-2.5-flash' } } }), rest), null, 'reply time unknown');
  assert.equal(settingModelNameOfRow(row({ geminiSeen: { modelAt: START + 60000, planned: null } }), rest), null, 'no job');
  assert.equal(settingModelNameOfRow(row({ geminiSeen: { modelAt: START + 60000, planned: { id: 'auto' } } }), rest), null, 'an alias');
  assert.equal(settingModelNameOfRow(row({ model: null }), rest), null, 'no model named');
  assert.equal(settingModelNameOfRow(null, rest), null);
});

test('#5811: partial deps override the real ones and keep the rest', () => {
  const r = counting(() => settingModelName('a', { planned: () => ({ id: 'gemini-2.5-pro', isDefault: false }) }));
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

test('#5811: the snapshot carries what the decision needs from its one session read, on both row builders', () => {
  const src = fs.readFileSync(path.join(__dirname, 'status.js'), 'utf8');
  assert.match(src, /geminiSeen: \(tied && isGeminiPane && geminiSess && geminiSess\.found\)\s*\? \{ modelAt: [^}]*planned: geminiSess\.planned \|\| null \}\s*: null,/);
  assert.match(src, /geminiSeen: null,\s*\/\/ #5811/);
  assert.match(src, /planned = create\.plannedModelOfJob\(job\);[\s\S]{0,60}return \{ \.\.\.sess, planned \};/);
});
