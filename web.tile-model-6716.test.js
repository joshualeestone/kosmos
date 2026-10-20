'use strict';
/**
 * #6716 review 1: a model read from an agent's EARLIER session (a new one that has not replied yet) gives way to the
 * model the agent is set to run on, as a stopped agent's does: right after a model switch the earlier one is the old
 * model. With nothing planned (the fleet's agents, which no Kosmos job describes), the earlier one is shown.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));
const modelLine = (a) => new Function('a', 'cardStOf', page.lift(SCRIPT, 'modelLine') + '\nreturn modelLine(a);')(a, () => ({ st: 'idle' }));
const base = { state: 'idle', runner: 'claude', isNamedOurs: true };

test('#6716: a borrowed earlier-session model gives way to the planned one', () => {
  assert.match(modelLine({ ...base, modelName: null, earlierModelName: 'Opus 4.8', plannedModelName: 'Opus 5.5' }), /Opus 5\.5/);
});

test('#6716: with nothing planned, the earlier session\'s model is shown, not "Made before Kosmos recorded this"', () => {
  const line = modelLine({ ...base, modelName: null, earlierModelName: 'Opus 5.5', plannedModelName: null, neverRecorded: true });
  assert.match(line, /Opus 5\.5/);
  assert.doesNotMatch(line, /Made before/);
});

test('#6716 CONTROL: a model the running session read itself still wins over the planned and the earlier one', () => {
  assert.match(modelLine({ ...base, modelName: 'Opus 4.8', plannedModelName: 'Opus 5.5', earlierModelName: 'Fable 5' }), /Opus 4\.8/);
});
