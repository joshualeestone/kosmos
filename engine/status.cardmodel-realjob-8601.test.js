'use strict';
/**
 * kosmos#8601 review 2: the job's model through the REAL reader, nothing stubbed. engine/status.cardmodel-8601.test.js
 * stubs create.plannedModelOf; this file writes the agent's job the way this platform keeps it (a launchd plist, a
 * systemd unit, or on Windows a Scheduled Task definition answered by the stand-in Task Scheduler in
 * test-support/jobfixture.js) with the model the picker writes (setModel's `m.arg`, a full `claude-...` id), and reads
 * it back through create.plannedModelOf / readJob. If a platform's reader ever handed back the picker's key or nothing,
 * the comparison would answer "same" and the card would name the old model again: these tests would fail.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cardmodel-realjob-8601-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'config');
process.env.AGENT_WORKFORCE_HOME = path.join(SB, 'home');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(SB, 'systemd');

const create = require('./create');
const status = require('./status');
const jobfix = require('../test-support/jobfixture');
test.after(() => fs.rmSync(SB, { recursive: true, force: true }));

function session(name, rows, ageSec) {
  const dir = create.workerDir(name);
  fs.mkdirSync(dir, { recursive: true });
  const real = fs.realpathSync(dir);
  const proj = path.join(SB, 'config', 'projects', real.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(proj, { recursive: true });
  const full = path.join(proj, 'old.jsonl');
  fs.writeFileSync(full, rows.map((r) => JSON.stringify({ cwd: real, ...r })).join('\n') + '\n');
  const t = Date.now() / 1000 - ageSec;
  fs.utimesSync(full, t, t);
}
/* The agent's real job naming `model`, written `ageSec` ago. jobPath is asked for again for each write (on Windows it
   forgets win32job's remembered task, so the read below is of this file). */
function job(name, model, ageSec) {
  fs.mkdirSync(path.dirname(jobfix.jobPath(name)), { recursive: true });
  fs.writeFileSync(jobfix.jobPath(name), jobfix.jobFor(name, process.execPath, null, model, null, 'claude'), 'utf8');
  const t = Date.now() / 1000 - ageSec;
  fs.utimesSync(jobfix.jobPath(name), t, t);
}
const replied = (model) => [{ type: 'assistant', message: { model } }];

test('kosmos#8601 review 2: a real job written by a model change names the full model id the comparison needs', () => {
  job('realjob', 'claude-haiku-5-5', 5);
  assert.deepEqual(create.plannedModelOf('realjob'), { id: 'claude-haiku-5-5', isDefault: false },
    'this platform\'s job reader did not hand back the full id setModel wrote');
});

test('kosmos#8601 review 2: with a real job naming another model, written after the transcript, the reading is earlier', () => {
  session('realswitch', replied('claude-opus-4-8'), 600);
  job('realswitch', 'claude-haiku-5-5', 5);
  assert.deepEqual(status.readModel('realswitch'), { model: 'claude-opus-4-8', confidence: 'structured', earlierSession: true });
});

test('kosmos#8601 review 2 CONTROL: a real job rewritten with the SAME model (a restart) leaves the reading', () => {
  session('realsame', replied('claude-opus-4-8'), 600);
  job('realsame', 'claude-opus-4-8', 5);
  assert.deepEqual(status.readModel('realsame'), { model: 'claude-opus-4-8', confidence: 'structured' });
});

test('kosmos#8601 review 2 CONTROL: a real job with no model leaves the reading', () => {
  session('realnone', replied('claude-opus-4-8'), 600);
  job('realnone', null, 5);
  assert.deepEqual(status.readModel('realnone'), { model: 'claude-opus-4-8', confidence: 'structured' });
});
