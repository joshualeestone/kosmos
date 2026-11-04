'use strict';

/**
 * #7931: a held question's dismiss key says it is held ('question-held:<words>'), so dismissing the calm "held until
 * you are back" row on a project does not hide the same words asked for real, nor the reverse.
 *
 *   node --test engine/projects-heldkey-7931.test.js
 *
 * Sandbox first, before any require (see engine/projects.test.js): every root the code writes to.
 */
require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-heldkey-7931-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');
const selfreport = require('./selfreport');
const fleet = require('../test-support/fleet');

const WORK = path.join(SANDBOX, 'work');
fs.mkdirSync(WORK, { recursive: true });
const folder = (name) => { const d = path.join(WORK, name); fs.mkdirSync(d, { recursive: true }); return d; };
function cards(specs) {
  const board = fleet.install(specs);
  try { return board.agents; } finally { board.restore(); }
}
function member(projectId, name) {
  const p = projects.list(cards([fleet.agent(name, { state: 'needs_you' })])).find((x) => x.id === projectId);
  return p.agents.find((a) => a.sessionName === name);
}
const ask = (name, projectId, held) => {
  const r = selfreport.record(name, { state: 'needs_you', because: 'Which sign?', project: projectId, ...(held ? { held: true } : {}) });
  assert.equal(r.recorded, true, 'fixture: the report was refused');
};

test('#7931: a held question is keyed as held, an asked one as before', () => {
  const p = projects.create({ name: 'Keys', folder: folder('keys'), agents: ['hk01'] });
  ask('hk01', p.id, true);
  const held = member(p.id, 'hk01');
  assert.equal(held.stateHeld, true, 'fixture: the member is not held');
  assert.equal(held.needsYouKey, 'question-held:Which sign?');
  ask('hk01', p.id, false);
  assert.equal(member(p.id, 'hk01').needsYouKey, 'question:Which sign?', 'CONTROL: an asked question keeps its old key');
});

test('#7931: a dismissed held row comes back when the same words are asked for real', () => {
  const p = projects.create({ name: 'Held then asked', folder: folder('held-asked'), agents: ['hk02'] });
  ask('hk02', p.id, true);
  projects.dismissNeeds(p.id, 'hk02', member(p.id, 'hk02').needsYouKey);
  assert.equal(member(p.id, 'hk02').needsYouHere, null, 'CONTROL: the held row was not dismissed');
  ask('hk02', p.id, false);
  const m = member(p.id, 'hk02');
  assert.equal(m.needsYouHere, 'question', 'the real question is hidden by the held row\'s dismissal');
  assert.equal(m.needsYouQuiet, null);
});

test('#7931: a dismissed asked question comes back once it is held', () => {
  const p = projects.create({ name: 'Asked then held', folder: folder('asked-held'), agents: ['hk03'] });
  ask('hk03', p.id, false);
  projects.dismissNeeds(p.id, 'hk03', member(p.id, 'hk03').needsYouKey);
  assert.equal(member(p.id, 'hk03').needsYouHere, null, 'CONTROL: the asked row was not dismissed');
  ask('hk03', p.id, true);
  const m = member(p.id, 'hk03');
  assert.equal(m.needsYouHere, 'question');
  assert.equal(m.needsYouQuiet, null);
});

test('#7931: a held agent in a crash loop is not keyed as held (heldOwnQuestion, not the raw report)', () => {
  const p = projects.create({ name: 'Held looping', folder: folder('held-looping'), agents: ['hk06'] });
  ask('hk06', p.id, true);
  const roster = cards([fleet.agent('hk06', { state: 'needs_you' })]).map((c) => ({ ...c, crashLoop: { looping: true } }));
  const m = projects.list(roster).find((x) => x.id === p.id).agents.find((a) => a.sessionName === 'hk06');
  assert.equal(m.stateHeld, false, 'fixture: a crash-looping agent read as calmly held');
  assert.equal(m.needsYouKey, 'question:Which sign?');
});

test('#7931: an unchanged held row stays dismissed', () => {
  const p = projects.create({ name: 'Held stays', folder: folder('held-stays'), agents: ['hk04'] });
  ask('hk04', p.id, true);
  projects.dismissNeeds(p.id, 'hk04', member(p.id, 'hk04').needsYouKey);
  ask('hk04', p.id, true);
  const m = member(p.id, 'hk04');
  assert.equal(m.needsYouHere, null);
  assert.deepEqual(m.needsYouQuiet, { reason: 'question', because: 'dismissed' });
});

test('#7931: dismissNeeds takes a held key under the same cap, and still refuses a bare question', () => {
  const p = projects.create({ name: 'Validate', folder: folder('validate'), agents: ['hk05'] });
  assert.doesNotThrow(() => projects.dismissNeeds(p.id, 'hk05', 'question-held:' + 'a'.repeat(300)));
  assert.throws(() => projects.dismissNeeds(p.id, 'hk05', 'question-held:' + 'a'.repeat(301)), /not a reason/);
  assert.doesNotThrow(() => projects.dismissNeeds(p.id, 'hk05', 'question:' + 'a'.repeat(300)), 'CONTROL: the old key at the cap');
  assert.throws(() => projects.dismissNeeds(p.id, 'hk05', 'question:' + 'a'.repeat(301)), /not a reason/);
  assert.throws(() => projects.dismissNeeds(p.id, 'hk05', 'question'), /not a reason/, 'a bare question is not a key');
  assert.throws(() => projects.dismissNeeds(p.id, 'hk05', 'question-held'), /not a reason/);
});
