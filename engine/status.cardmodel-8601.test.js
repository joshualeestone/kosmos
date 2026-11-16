'use strict';
/**
 * kosmos#8601 (the first half of #8466, measured on the Windows box 11-16): after a model change the card named the OLD
 * model until the agent's next turn. The change rewrites the job and restarts the agent, and until its next reply the
 * newest transcript still names the OLD model, which readModel returned as current. Now a transcript last written
 * before the job, whose model the job no longer names, is read as an earlier reading (the #6716 shape): `model` stays
 * null and the card shows the job's model.
 *
 * Review 1: the file time alone is not a model change (every Windows start or stop moves the task file's time, and an
 * account move rewrites the job on every platform), so a rewritten job naming the SAME model, no model, or a short name
 * leaves the reading as it was.
 *
 * The job file is the platform's own (plist, systemd unit, Scheduled Task file) and its model comes from
 * create.plannedModelOf; the tests point both at the sandbox, so the same assertions hold on every platform.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cardmodel-8601-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'config');
process.env.AGENT_WORKFORCE_HOME = path.join(SB, 'home');

const create = require('./create');
const status = require('./status');
const JOBS = path.join(SB, 'jobs');
fs.mkdirSync(JOBS, { recursive: true });

/* The platform's job-file lookup and the job's model, pointed at the sandbox for the whole file and put back after. */
const lookup = process.platform === 'linux' ? [require('./linuxjob'), 'unitPath']
  : process.platform === 'win32' ? [require('./win32job'), 'taskFilePath']
    : [create, 'plistPath'];
const realLookup = lookup[0][lookup[1]];
const realPlanned = create.plannedModelOf;
const jobModel = new Map();   // name -> the model its job names (absent: none)
lookup[0][lookup[1]] = (name) => path.join(JOBS, `job-${name}`);
create.plannedModelOf = (name) => (jobModel.has(name) ? { id: jobModel.get(name), isDefault: false } : null);
test.after(() => {
  lookup[0][lookup[1]] = realLookup;
  create.plannedModelOf = realPlanned;
  fs.rmSync(SB, { recursive: true, force: true });
});

function session(name, file, rows, ageSec) {
  const dir = create.workerDir(name);
  fs.mkdirSync(dir, { recursive: true });
  const real = fs.realpathSync(dir);
  const proj = path.join(SB, 'config', 'projects', real.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(proj, { recursive: true });
  const full = path.join(proj, file);
  fs.writeFileSync(full, rows.map((r) => JSON.stringify({ cwd: real, ...r })).join('\n') + '\n');
  const t = Date.now() / 1000 - ageSec;
  fs.utimesSync(full, t, t);
  return full;
}
/* The agent's job, written `ageSec` ago, naming `model` (or none). */
function job(name, ageSec, model) {
  const f = path.join(JOBS, `job-${name}`);
  fs.writeFileSync(f, 'a job\n');
  const t = Date.now() / 1000 - ageSec;
  fs.utimesSync(f, t, t);
  if (model) jobModel.set(name, model); else jobModel.delete(name);
  return f;
}
const replied = (model) => [{ type: 'assistant', message: { model } }];
const current = (model) => ({ model, confidence: 'structured' });

test('kosmos#8601: a job rewritten after the transcript to name ANOTHER model makes the reading an earlier one', () => {
  session('switched', 'old.jsonl', replied('claude-opus-4-8'), 600);
  job('switched', 5, 'claude-haiku-5-5');   // the model change; the agent has not replied since
  assert.deepEqual(status.readModel('switched'), { model: 'claude-opus-4-8', confidence: 'structured', earlierSession: true });
  // The snapshot's call, with its session, reads the same.
  assert.equal(status.readModel('switched', 'switched').earlierSession, true);
  // On the card that is not the model, so the job's model shows (server.js plannedFor reads it when modelName is null).
  assert.deepEqual(status.splitModelReading(status.readModel('switched')), { model: null, earlierModelName: 'Claude Opus 4.8' });
});

test('kosmos#8601 review 1 CONTROL: a restart or account move rewrites the job with the SAME model: the reading stands', () => {
  session('restarted', 'old.jsonl', replied('claude-opus-4-8'), 600);
  job('restarted', 5, 'claude-opus-4-8');
  assert.deepEqual(status.readModel('restarted'), current('claude-opus-4-8'));
});

test('kosmos#8601 review 1 CONTROL: a rewritten job that names no model (an agent from before the picker) leaves the reading', () => {
  session('nomodel', 'old.jsonl', replied('claude-opus-4-8'), 600);
  job('nomodel', 5, null);
  assert.deepEqual(status.readModel('nomodel'), current('claude-opus-4-8'));
});

test('kosmos#8601 review 1 CONTROL: a short name in the job cannot be compared, so the reading stands', () => {
  session('alias', 'old.jsonl', replied('claude-opus-5-5'), 600);
  job('alias', 5, 'opus');
  assert.deepEqual(status.readModel('alias'), current('claude-opus-5-5'));
});

test('kosmos#8601 review 1 CONTROL: the same model spelled with a [1m] suffix or a date is the same model', () => {
  session('wide', 'old.jsonl', replied('claude-opus-5'), 600);
  job('wide', 5, 'claude-opus-5[1m]');
  assert.deepEqual(status.readModel('wide'), current('claude-opus-5'));
  session('dated', 'old.jsonl', replied('claude-haiku-4-5-20251001'), 600);
  job('dated', 5, 'claude-haiku-4-5');
  assert.deepEqual(status.readModel('dated'), current('claude-haiku-4-5-20251001'));
});

/* Review 3: pinned so a later change sees the window is deliberate. An id the name table does not know is shown raw,
   so its dated and undated forms do not match: after a rewrite naming one, a reply naming the other reads as earlier
   until the next reply (the card then shows the job's id, the same model). */
test('kosmos#8601 review 3: an unknown dated id against its undated form reads as another model (accepted)', () => {
  session('unknowndate', 'old.jsonl', replied('claude-zeta-9'), 600);
  job('unknowndate', 5, 'claude-zeta-9-20991231');
  assert.equal(status.readModel('unknowndate').earlierSession, true);
});

test('kosmos#8601 CONTROL: a job older than the transcript leaves the reading, whatever model it names', () => {
  session('steady', 'old.jsonl', replied('claude-opus-5-5'), 5);
  job('steady', 600, 'claude-haiku-5-5');   // a /model switch inside the session after the job was written
  assert.deepEqual(status.readModel('steady'), current('claude-opus-5-5'));
});

test('kosmos#8601 CONTROL: with no job file (a fleet agent, an untied pane) the reading is unchanged', () => {
  session('nojob', 'old.jsonl', replied('claude-opus-5-5'), 600);
  jobModel.set('nojob', 'claude-haiku-5-5');   // even if a model were read, no job file means no rewrite
  assert.deepEqual(status.readModel('nojob'), current('claude-opus-5-5'));
});

test('kosmos#8601: after the first reply on the new model, that reply is the current model again', () => {
  session('replies', 'old.jsonl', replied('claude-opus-4-8'), 600);
  job('replies', 300, 'claude-haiku-5-5');
  session('replies', 'new.jsonl', replied('claude-haiku-5-5'), 5);   // its first reply since the change
  assert.deepEqual(status.readModel('replies'), current('claude-haiku-5-5'));
});
